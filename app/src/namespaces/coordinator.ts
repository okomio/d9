import { NamespaceError, type NamespaceAdapter } from './adapter';
import { contextFromGrant, sameContext, validateGrant } from './context';
import type { NamespaceLifecycle } from './lifecycle';
import type { OperationLedger } from './requests';
import type {
	ContextStamp,
	NamespaceCoordinator,
	NamespaceSnapshot,
	NamespaceState,
	SwitchIntent,
	SwitchResult,
	TokenGrant,
} from './types';

export interface TokenAuthority {
	mint(target: string, signal: AbortSignal): Promise<TokenGrant>;
	install(grant: TokenGrant, stamp: ContextStamp): void;
	clear(): void;
	token(): string | null;
}
export interface NamespaceNavigation {
	commit(intent: SwitchIntent): Promise<void>;
	finish(destination: string): Promise<void>;
}
export interface CoordinatorOptions {
	state: NamespaceState;
	adapter: NamespaceAdapter;
	auth: TokenAuthority;
	lifecycle: NamespaceLifecycle;
	ledger: OperationLedger;
	navigation: NamespaceNavigation;
	confirmDiscard(dirtyParticipants: readonly string[]): Promise<boolean>;
	publish(snapshot: NamespaceSnapshot | null): void;
	/** Await actual view unmount before installing target context. */
	unmountSource?(): Promise<void>;
}
export function createNamespaceCoordinator(options: CoordinatorOptions): NamespaceCoordinator & { invalidate(): void } {
	const { state, adapter, auth, lifecycle, ledger, navigation } = options;
	let running = false;
	let transaction: AbortController | null = null;
	return {
		invalidate() {
			transaction?.abort();
		},
		async requestSwitch(intent): Promise<SwitchResult> {
			if (running) return { status: 'busy' };
			if (state.active?.namespaceId === intent.namespaceId && state.phase === 'ready') return { status: 'ready' };
			running = true;
			transaction = new AbortController();
			const signal = transaction.signal;
			const generation = state.sessionGeneration;
			const source = state.active;
			const sourcePhase = state.phase;
			let committed = false;
			let paused = false;
			let mintStarted = false;

			const check = () => {
				if (signal.aborted || generation !== state.sessionGeneration)
					throw new NamespaceError('cancelled', 'Switch invalidated');
			};

			try {
				state.phase = 'preflight';
				state.error = null;
				const dirty = await lifecycle.dirty();
				check();

				if (dirty.length && !(await options.confirmDiscard(dirty))) {
					check();
					state.phase = sourcePhase;
					return { status: 'stayed' };
				}

				check();
				state.pending = intent.namespaceId;
				state.phase = 'quiescing';
				ledger.closeAdmission();
				paused = true;
				await lifecycle.pause();
				check();
				ledger.cancelReads();
				await ledger.drainWrites();
				check();
				state.phase = 'minting';
				mintStarted = true;
				const grant = await auth.mint(intent.namespaceId, signal);
				check();
				validateGrant(grant, intent.namespaceId);
				// Source drafts survive until this point. Render barrier unmounts source before install.
				state.phase = 'resetting';
				await options.unmountSource?.();
				check();
				state.epoch++;
				state.active = contextFromGrant(grant, state);
				committed = true;
				auth.install(grant, state.active);
				if (state.session) state.session = { ...state.session, platform: grant.platform };
				options.publish(null);
				await navigation.commit(intent);
				check();
				await lifecycle.reset();
				check();
				state.phase = 'hydrating';
				const target = state.active;
				const snapshot = await adapter.hydrate(target, auth.token()!, signal);
				check();
				if (!sameContext(target, state.active) || snapshot.namespaceId !== target.namespaceId)
					throw new NamespaceError('contract', 'Hydration returned a different namespace');
				const destination = adapter.validateDestination(intent.destination ?? '/content', snapshot);
				check();
				options.publish(snapshot);
				// Resume only after complete checked hydration; failing consumers remain blocked.
				await lifecycle.resume(state.active);
				check();
				state.phase = 'ready';
				ledger.openAdmission();
				// Native module landing routes can redirect to a collection. The target
				// must be ready before that second router guard runs.
				await navigation.finish(destination);
				check();
				return { status: 'ready', destination };
			} catch (error) {
				if (generation !== state.sessionGeneration || signal.aborted) return { status: 'blocked', error };
				state.error = error;

				if (committed) {
					// Clear every partial consumer even if the legacy app never marked itself hydrated.
					signal.throwIfAborted();
					ledger.closeAdmission();
					ledger.cancelReads();
					options.publish(null);

					try {
						await lifecycle.reset();
					} catch {
						/* Retain blocked state on reset failure. */
					}

					state.phase = 'blocked';
				} else {
					state.active = source;
					state.phase = source ? sourcePhase : 'no-access';
					if (mintStarted && error instanceof NamespaceError && error.kind === 'ambiguous') state.phase = 'blocked';

					if (paused) {
						try {
							await lifecycle.resume(source);
						} catch (resumeError) {
							state.error = resumeError;
							state.phase = 'blocked';
						}
					}

					if (source && state.phase === 'ready') ledger.openAdmission();
				}

				return { status: 'blocked', error };
			} finally {
				if (generation === state.sessionGeneration) state.pending = null;
				running = false;
				transaction = null;
			}
		},
	};
}
