import { NamespaceError, type NamespaceAdapter } from './adapter';
import type { TokenAuthority } from './coordinator';
import { contextFromGrant, sameContext, validateGrant } from './context';
import type { ContextStamp, NamespaceState, TokenGrant } from './types';

/** Only explicit agreed domain errors can invalidate login. Generic 403/network is not expiry. */
export function namespaceAuthError(error: unknown): unknown {
	if (error instanceof NamespaceError) return error;

	const response = (
		error as { response?: { status?: number; data?: { errors?: { extensions?: { code?: string } }[] } } }
	)?.response;

	const code = response?.data?.errors?.[0]?.extensions?.code;
	// Proposed domain codes must be confirmed/mapped by the backend adapter (D02/D03).
	if (code === 'SESSION_EXPIRED') return new NamespaceError('session-expired', 'Login expired');
	if (code === 'NAMESPACE_ACCESS_DENIED') return new NamespaceError('namespace-denied', 'Local namespace access lost');
	if (code === 'APP_ACCESS_DENIED') return new NamespaceError('app-denied', 'Local app access lost');
	if ((response?.status === 401 || response?.status === 403 || response?.status === 200) && code === 'INVALID_TOKEN')
		return new NamespaceError('invalid-token', 'Context token rejected');
	return error;
}
export interface NamespaceAuthOptions {
	state: NamespaceState;
	adapter: NamespaceAdapter;
	onAccessError(error: NamespaceError): void | Promise<void>;
	onReauthorized?(grant: TokenGrant): void;
	onInstall?(grant: TokenGrant): void;
	now?: () => number;
}
export function createNamespaceAuth(options: NamespaceAuthOptions): TokenAuthority & {
	refresh(stamp?: ContextStamp): Promise<string>;
	expiresAt(): number | null;
	suspend(): void;
	resume(): void;
	rejectContext(stamp: ContextStamp, error: NamespaceError): Promise<void>;
} {
	const { state, adapter } = options;
	const now = options.now ?? Date.now;
	let accessToken: string | null = null;
	let expiry: number | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let suspended = false;
	let tail: Promise<unknown> = Promise.resolve();
	const controllers = new Set<AbortController>();
	const refreshes = new Map<string, Promise<string>>();

	const serialized = <T>(run: () => Promise<T>): Promise<T> => {
		const result = tail.then(run);
		tail = result.catch(() => {});
		return result;
	};

	const stopTimer = () => {
		clearTimeout(timer);
		timer = undefined;
	};

	const schedule = (stamp: ContextStamp) => {
		stopTimer();
		if (suspended || expiry === null) return;
		const remaining = expiry - now() - 10_000;

		timer = setTimeout(() => {
			if (!sameContext(stamp, state.active)) return;

			if (expiry !== null && expiry - now() > 10_000) {
				schedule(stamp);
				return;
			}

			void auth.refresh(stamp).catch(() => {
				/* refresh already applies explicit access/expiry errors */
			});
		}, Math.max(1000, Math.min(remaining, 2_100_000_000)));
	};

	const auth = {
		async rejectContext(stamp: ContextStamp, error: NamespaceError) {
			if (!sameContext(stamp, state.active)) throw new NamespaceError('cancelled', 'Stale context denial');
			if (['namespace-denied', 'app-denied', 'session-expired'].includes(error.kind))
				await options.onAccessError(error);
		},
		token: () => accessToken,
		expiresAt: () => expiry,
		suspend() {
			suspended = true;
			stopTimer();
		},
		resume() {
			suspended = false;
			if (state.active) schedule(state.active);
		},
		clear() {
			stopTimer();
			accessToken = null;
			expiry = null;
			for (const controller of controllers) controller.abort();
			controllers.clear();
			refreshes.clear();
		},
		async mint(target: string, signal: AbortSignal) {
			const generation = state.sessionGeneration;
			const source = state.active;
			if (source && expiry !== null && expiry - now() < 10_000) await auth.refresh(source);

			const attempt = () =>
				serialized(async () => {
					if (signal.aborted || generation !== state.sessionGeneration)
						throw new NamespaceError('cancelled', 'Stale token mint');
					const grant = await adapter.mintTargetToken(target, signal);
					if (signal.aborted || generation !== state.sessionGeneration)
						throw new NamespaceError('cancelled', 'Stale token mint response');
					validateGrant(grant, target);
					return grant;
				});

			try {
				return await attempt();
			} catch (error) {
				if (
					!(error instanceof NamespaceError) ||
					error.kind !== 'invalid-token' ||
					!source ||
					!sameContext(source, state.active)
				)
					throw error;
				await auth.refresh(source);
				return attempt();
			}
		},
		install(grant: TokenGrant, stamp: ContextStamp) {
			validateGrant(grant, stamp.namespaceId);
			if (!sameContext(stamp, state.active)) throw new NamespaceError('cancelled', 'Stale token installation');
			accessToken = grant.accessToken;
			expiry = now() + grant.expiresInMs;
			options.onInstall?.(grant);
			schedule(stamp);
		},
		refresh(stamp: ContextStamp | undefined = state.active ?? undefined): Promise<string> {
			if (!stamp || !sameContext(stamp, state.active))
				return Promise.reject(new NamespaceError('cancelled', 'Stale refresh context'));

			// Freeze input even if caller holds a mutable reactive reference.
			const captured = {
				namespaceId: stamp.namespaceId,
				epoch: stamp.epoch,
				sessionGeneration: stamp.sessionGeneration,
			};

			const key = JSON.stringify(captured);
			const existing = refreshes.get(key);
			if (existing) return existing;

			const result = serialized(async () => {
				if (!sameContext(captured, state.active)) throw new NamespaceError('cancelled', 'Stale queued refresh');
				const controller = new AbortController();
				controllers.add(controller);

				try {
					const grant = await adapter.refreshForNamespace(captured, controller.signal);
					if (controller.signal.aborted || !sameContext(captured, state.active))
						throw new NamespaceError('cancelled', 'Stale refresh response');
					validateGrant(grant, captured.namespaceId);
					state.active = contextFromGrant(grant, state);
					if (state.session) state.session = { ...state.session, platform: grant.platform };
					auth.install(grant, captured);
					options.onReauthorized?.(grant);
					return grant.accessToken;
				} catch (error) {
					if (controller.signal.aborted || !sameContext(captured, state.active))
						throw new NamespaceError('cancelled', 'Stale refresh error');
					const normalized = namespaceAuthError(error);
					if (
						normalized instanceof NamespaceError &&
						['namespace-denied', 'app-denied', 'session-expired'].includes(normalized.kind)
					)
						await options.onAccessError(normalized);
					throw normalized;
				} finally {
					controllers.delete(controller);
				}
			});

			refreshes.set(key, result);

			void result
				.finally(() => {
					if (refreshes.get(key) === result) refreshes.delete(key);
				})
				.catch(() => {});

			return result;
		},
	};

	return auth;
}
