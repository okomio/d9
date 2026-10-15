import { nextTick, reactive, readonly, shallowRef } from 'vue';
import { NamespaceError, type NamespaceAdapter } from './adapter';
import { createNamespaceAuth } from './auth';
import { allowedDestination, isEnterableChild } from './choices';
import { createNamespaceState } from './context';
import { createNamespaceCoordinator, type NamespaceNavigation } from './coordinator';
import { createNamespaceLifecycle } from './lifecycle';
import { createNamespaceRegistrySignal } from './registry';
import { runAuthenticatedOperation } from './request-auth';
import { createOperationLedger, type OperationContext, type OperationKind } from './requests';
import type { NamespaceSnapshot } from './types';
import { requestedNamespace } from './url';

export interface NamespaceRuntimeOptions {
	adapter: NamespaceAdapter;
	navigation: NamespaceNavigation;
	confirmDiscard(dirty: readonly string[]): Promise<boolean>;
	onInstall?(grant: import('./types').TokenGrant): void;
	onLogout?(): void;
}
/** One instance per tab/application. No shared localStorage or cookie namespace authority. */
export function createNamespaceRuntime(options: NamespaceRuntimeOptions) {
	const state = reactive(createNamespaceState());
	const snapshot = shallowRef<NamespaceSnapshot | null>(null);
	const lifecycle = createNamespaceLifecycle();
	const registry = createNamespaceRegistrySignal();
	let registryRevision = 0;
	let registryController: AbortController | null = null;
	let sessionController: AbortController | null = null;
	let bootstrapPromise: Promise<void> | null = null;
	let sessionPromise: Promise<void> | null = null;
	let disposed = false;

	const auth = createNamespaceAuth({
		state,
		adapter: options.adapter,
		onAccessError: async (error) => {
			if (error.kind === 'session-expired') {
				await logout(true);
				return;
			}

			coordinator.invalidate();
			ledger.closeAdmission();
			ledger.cancelReads();
			auth.clear();
			state.epoch++;

			const platform = {
				isGlobalAdmin: false,
				canManageNamespaces: false,
				canManageSharedUsers: false,
				canManageSharedSettings: false,
			};

			if (state.session) state.session = { ...state.session, platform };
			if (state.active)
				state.active = {
					...state.active,
					epoch: state.epoch,
					platform,
					access: { ...state.active.access, canUseApp: false },
				};
			snapshot.value = null;
			state.phase = 'no-access';
			state.error = error;
			await lifecycle.reset();
			registry.invalidate({ reason: 'entitlement' });
		},
		onReauthorized: () => registry.invalidate({ reason: 'entitlement' }),
		onInstall: options.onInstall,
	});

	const ledger = createOperationLedger(state, auth.token);

	const coordinator = createNamespaceCoordinator({
		state,
		adapter: options.adapter,
		auth,
		lifecycle,
		ledger,
		navigation: options.navigation,
		confirmDiscard: options.confirmDiscard,
		unmountSource: nextTick,
		publish: (value) => {
			snapshot.value = value;
		},
	});

	async function refreshChoices() {
		const generation = state.sessionGeneration;
		const revision = ++registryRevision;
		registryController?.abort();
		const controller = new AbortController();
		registryController = controller;
		state.choicesLoading = true;
		state.choicesError = null;
		let choices;

		try {
			choices = await options.adapter.listAvailable(controller.signal);
		} catch (error) {
			if (
				disposed ||
				controller.signal.aborted ||
				generation !== state.sessionGeneration ||
				revision !== registryRevision
			)
				return;
			state.choicesLoading = false;
			state.choicesError = error;
			throw error;
		}

		if (
			disposed ||
			controller.signal.aborted ||
			generation !== state.sessionGeneration ||
			revision !== registryRevision
		)
			return;
		if (new Set(choices.map((choice) => choice.namespace.id)).size !== choices.length) {
			const error = new NamespaceError('contract', 'Duplicate namespace identity');
			state.choicesLoading = false;
			state.choicesError = error;
			throw error;
		}
		state.choices = choices;
		state.choicesLoading = false;
		state.choicesError = null;
		// A registry/membership refresh can revoke the active child while its native view is open.
		// Reuse the foundation's access-loss reset instead of leaving that view mounted.
		if (
			state.phase === 'ready' &&
			state.active &&
			!allowedDestination(choices, state.active.namespaceId, state.active.platform.isGlobalAdmin)
		) {
			await auth.rejectContext(state.active, new NamespaceError('namespace-denied', 'Active namespace access lost'));
		}
	}

	const unsubscribe = registry.subscribe(() => {
		void refreshChoices().catch((error) => {
			if (!disposed) state.error = error;
		});
	});

	async function ensureSession() {
		if (state.session) return;
		if (sessionPromise) return sessionPromise;
		const generation = state.sessionGeneration;

		sessionPromise = (async () => {
			sessionController = new AbortController();
			const session = await options.adapter.readSessionContext(sessionController.signal);
			if (disposed || generation !== state.sessionGeneration) return;
			state.session = session;
			await refreshChoices();
		})();

		try {
			await sessionPromise;
		} finally {
			sessionPromise = null;
		}
	}

	async function bootstrap(destination: string) {
		if (bootstrapPromise) return bootstrapPromise;
		const target = requestedNamespace(destination); // Explicit identity is validated BEFORE bootstrap/protected reads.
		const generation = state.sessionGeneration;

		bootstrapPromise = (async () => {
			await ensureSession();
			const session = state.session;
			if (!session) return;
			if (disposed || generation !== state.sessionGeneration) return;

			const eligibleChildren = state.choices.filter(isEnterableChild);

			const id = target ?? (eligibleChildren.length === 1 ? eligibleChildren[0]!.namespace.id : null);

			// Do not choose the first unauthorized/unready option or silently ignore an explicit target.
			if (!id || !allowedDestination(state.choices, id, session.platform.isGlobalAdmin)) {
				state.phase = 'no-access';
				return;
			}

			await coordinator.requestSwitch({ namespaceId: id, source: 'bootstrap', destination });
		})();

		try {
			await bootstrapPromise;
		} finally {
			bootstrapPromise = null;
		}
	}

	async function logout(expired = false) {
		state.sessionGeneration++;
		state.epoch++;
		coordinator.invalidate();
		sessionController?.abort();
		registryController?.abort();
		ledger.closeAdmission();
		ledger.cancelReads();
		auth.clear();
		state.active = null;
		state.pending = null;
		state.session = null;
		state.choices = [];
		state.choicesLoading = false;
		state.choicesError = null;
		state.phase = 'idle';
		state.error = null;
		snapshot.value = null;
		await lifecycle.reset();
		if (expired) options.onLogout?.();
	}

	return {
		state: readonly(state),
		snapshot: readonly(snapshot),
		adapter: options.adapter,
		auth,
		coordinator,
		lifecycle,
		ledger,
		registry,
		ensureSession,
		bootstrap,
		refreshChoices,
		async recoverSource() {
			if (state.phase !== 'blocked' || !state.active || !snapshot.value)
				throw new NamespaceError('contract', 'No preserved source context to recover');
			await auth.refresh(state.active);
			await lifecycle.resume(state.active);
			state.error = null;
			state.phase = 'ready';
			ledger.openAdmission();
		},
		logout,
		request<T>(
			kind: OperationKind,
			operation: (context: OperationContext) => Promise<T>,
			requestOptions?: { signal?: AbortSignal; replaySafeWrite?: boolean }
		) {
			return runAuthenticatedOperation(ledger, auth, kind, operation, requestOptions);
		},
		async dispose() {
			disposed = true;
			unsubscribe();
			await logout();
			await lifecycle.dispose();
		},
	};
}
export type NamespaceRuntime = ReturnType<typeof createNamespaceRuntime>;
