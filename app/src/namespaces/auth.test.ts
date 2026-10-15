import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNamespaceAuth, namespaceAuthError } from './auth';
import { NamespaceError } from './adapter';
import { contextFromGrant, createNamespaceState } from './context';
import { createMockNamespaceAdapter } from './mock';
import { createNamespaceRuntime } from './runtime';
import type { NamespaceRuntime } from './runtime';
import { createNamespaceScope } from './scope';
import type { TokenGrant } from './types';

const tabs: NamespaceRuntime[] = [];

afterEach(async () => {
	for (const tab of tabs.splice(0)) await tab.dispose();
	vi.useRealTimers();
});

function makeTab(persona: 'global-admin' | 'local-admin' | 'multi-role' = 'global-admin') {
	const adapter = createMockNamespaceAdapter(persona);

	const tab = createNamespaceRuntime({
		adapter,
		navigation: { commit: async () => {}, finish: async () => {} },
		confirmDiscard: async () => true,
	});

	tabs.push(tab);
	return tab;
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;

	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});

	return { promise, resolve, reject };
}

describe('tab token authority and context-bound retry', () => {
	it('serializes mint/refresh and joins concurrent refresh for the same stamp', async () => {
		const tab = makeTab();
		await tab.bootstrap('/namespace?ns=tracking');
		const pending = deferred<TokenGrant>();
		const refresh = vi.fn(() => pending.promise);
		tab.adapter.refreshForNamespace = refresh;
		const a = tab.auth.refresh();
		const b = tab.auth.refresh();
		expect(a).toBe(b);
		await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
		const mint = vi.spyOn(tab.adapter, 'mintTargetToken');
		const switching = tab.coordinator.requestSwitch({ namespaceId: 'aaa', source: 'picker' });
		await vi.waitFor(() => expect(tab.state.phase).toBe('minting'));
		expect(mint).not.toHaveBeenCalled();
		pending.resolve(await createMockNamespaceAdapter().mintTargetToken('tracking'));
		await a;
		await switching;
		expect(tab.state.active?.namespaceId).toBe('aaa');
		expect(mint).toHaveBeenCalledTimes(1);
	});

	it('allows source refresh while draining long writes, then retries in source context only', async () => {
		const tab = makeTab();
		await tab.bootstrap('/namespace?ns=main');
		const pending = deferred<void>();
		const captured: string[] = [];
		let attempt = 0;

		const operation = tab.request(
			'write',
			async (context) => {
				captured.push(context.namespaceId);

				if (++attempt === 1) {
					await pending.promise;
					throw new NamespaceError('invalid-token', 'Expired source token');
				}

				return 204;
			},
			{ replaySafeWrite: true }
		);

		const switching = tab.coordinator.requestSwitch({ namespaceId: 'tracking', source: 'picker' });
		await vi.waitFor(() => expect(tab.state.phase).toBe('quiescing'));
		pending.resolve();
		expect(await operation).toBe(204);
		await switching;
		expect(captured).toEqual(['main', 'main']);
		expect(tab.state.active?.namespaceId).toBe('tracking');
	});

	it('does not replay a mutation automatically and treats 204 as success', async () => {
		const tab = makeTab();
		await tab.bootstrap('/namespace?ns=main');
		expect(await tab.request('write', async () => undefined)).toBeUndefined();
		const refresh = vi.spyOn(tab.auth, 'refresh');

		const operation = vi.fn(async () => {
			throw new NamespaceError('invalid-token', 'Invalid');
		});

		await expect(tab.request('write', operation)).rejects.toMatchObject({ kind: 'invalid-token' });
		expect(operation).toHaveBeenCalledTimes(1);
		expect(refresh).not.toHaveBeenCalled();
	});

	it('refreshes once for 403 INVALID_TOKEN, preserving filters/options in callback closure', async () => {
		const tab = makeTab();
		await tab.bootstrap('/namespace?ns=main');
		const tokens: string[] = [];
		let attempt = 0;

		const result = await tab.request('read', async (context) => {
			tokens.push(context.token);
			if (++attempt === 1)
				throw { response: { status: 403, data: { errors: [{ extensions: { code: 'INVALID_TOKEN' } }] } } };
			return { data: 'source', headers: 'retained' };
		});

		expect(result.data).toBe('source');
		expect(tokens[0]).not.toBe(tokens[1]);
	});

	it('cancels stale source errors without refreshing or logging out target', async () => {
		const tab = makeTab();
		await tab.bootstrap('/namespace?ns=main');
		const pending = deferred<string>();
		const operation = tab.request('read', () => pending.promise);
		const cancelled = expect(operation).rejects.toMatchObject({ kind: 'cancelled' });
		await tab.coordinator.requestSwitch({ namespaceId: 'aaa', source: 'picker' });
		await cancelled;
		const refresh = vi.spyOn(tab.auth, 'refresh');
		pending.reject(new NamespaceError('session-expired', 'Late expiry'));
		await Promise.resolve();
		expect(refresh).not.toHaveBeenCalled();
		expect(tab.state.session).not.toBeNull();
		expect(tab.state.active?.namespaceId).toBe('aaa');
	});

	it('keeps login on local access loss; clears all context on explicit session expiry', async () => {
		const tab = makeTab();
		await tab.bootstrap('/namespace?ns=tracking');

		tab.adapter.refreshForNamespace = async () => {
			throw new NamespaceError('namespace-denied', 'Revoked membership');
		};

		await expect(tab.auth.refresh()).rejects.toMatchObject({ kind: 'namespace-denied' });
		expect(tab.state.session?.user.id).toBe('global');
		expect(tab.state.phase).toBe('no-access');
		expect(tab.snapshot.value).toBeNull();
		expect(tab.auth.token()).toBeNull();
		await tab.coordinator.requestSwitch({ namespaceId: 'main', source: 'picker' });
		const generation = tab.state.sessionGeneration;

		tab.adapter.refreshForNamespace = async () => {
			throw new NamespaceError('session-expired', 'Session expired');
		};

		await expect(tab.auth.refresh()).rejects.toMatchObject({ kind: 'session-expired' });
		expect(tab.state.session).toBeNull();
		expect(tab.state.active).toBeNull();
		expect(tab.state.sessionGeneration).toBe(generation + 1);
	});

	it('does not infer logout from generic 403/network errors', () => {
		const forbidden = { response: { status: 403, data: { errors: [{ extensions: { code: 'FORBIDDEN' } }] } } };
		expect(namespaceAuthError(forbidden)).toBe(forbidden);
		const network = new Error('network');
		expect(namespaceAuthError(network)).toBe(network);
	});

	it('revalidates reduced membership after Global Admin demotion', async () => {
		const tab = makeTab();
		await tab.bootstrap('/namespace?ns=tracking');
		const reduced = await createMockNamespaceAdapter('multi-role').mintTargetToken('tracking');
		tab.adapter.refreshForNamespace = async () => reduced;
		await tab.auth.refresh();
		expect(tab.state.active?.access.localRole?.id).toBe('tracking-editor');
		expect(tab.state.active?.platform.isGlobalAdmin).toBe(false);
		expect(tab.state.phase).toBe('ready');
	});

	it('keeps independent namespaces through refresh in two tab runtimes', async () => {
		const a = makeTab('multi-role');
		const b = makeTab('multi-role');
		await Promise.all([a.bootstrap('/namespace?ns=tracking'), b.bootstrap('/namespace?ns=aaa')]);
		await Promise.all([a.auth.refresh(), b.auth.refresh()]);
		expect(a.state.active?.namespaceId).toBe('tracking');
		expect(b.state.active?.namespaceId).toBe('aaa');
		expect(a.auth.token()).not.toBe(b.auth.token());
	});

	it('never installs a mismatched refresh target or late logout response', async () => {
		const tab = makeTab();
		await tab.bootstrap('/namespace?ns=main');
		const token = tab.auth.token();
		tab.adapter.refreshForNamespace = async () => createMockNamespaceAdapter().mintTargetToken('aaa');
		await expect(tab.auth.refresh()).rejects.toMatchObject({ kind: 'contract' });
		expect(tab.auth.token()).toBe(token);
		const pending = deferred<TokenGrant>();
		tab.adapter.refreshForNamespace = () => pending.promise;
		const refreshing = tab.auth.refresh();
		const cancelled = expect(refreshing).rejects.toMatchObject({ kind: 'cancelled' });
		await vi.waitFor(() => expect(tab.state.active).not.toBeNull());
		await Promise.resolve();
		await tab.logout();
		pending.resolve(await createMockNamespaceAdapter().mintTargetToken('main'));
		await cancelled;
		expect(tab.auth.token()).toBeNull();
		expect(tab.state.session).toBeNull();
	});

	it('replaces expiry timers and honors idle suspend/resume', async () => {
		vi.useFakeTimers();
		const state = createNamespaceState();
		const adapter = createMockNamespaceAdapter();
		const refresh = vi.spyOn(adapter, 'refreshForNamespace');
		const grant = await adapter.mintTargetToken('main');
		state.active = contextFromGrant(grant, state);
		const auth = createNamespaceAuth({ state, adapter, onAccessError: async () => {} });
		auth.install(grant, state.active);
		expect(auth.expiresAt()).toBe(Date.now() + 60_000);
		auth.suspend();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(refresh).not.toHaveBeenCalled();
		auth.resume();
		await vi.advanceTimersByTimeAsync(1_000);
		expect(refresh).toHaveBeenCalledTimes(1);
		auth.clear();
	});

	it('disposes delayed callbacks/polling/listeners on switch and logout', async () => {
		vi.useFakeTimers();
		const tab = makeTab();
		await tab.bootstrap('/namespace?ns=main');
		const callback = vi.fn();
		const cleanup = vi.fn();
		const scope = createNamespaceScope('view', tab.state.active!, tab.lifecycle, tab.ledger);
		scope.timeout(callback, 450);
		scope.poll(callback, 1_000);
		scope.own(cleanup);
		await tab.coordinator.requestSwitch({ namespaceId: 'tracking', source: 'picker' });
		await vi.advanceTimersByTimeAsync(2_000);
		scope.effect(callback);
		expect(callback).not.toHaveBeenCalled();
		expect(cleanup).toHaveBeenCalledTimes(1);
		scope.dispose();
	});

	it('refreshes registry after invalidation without switching', async () => {
		const tab = makeTab('local-admin');
		await tab.bootstrap('/namespace?ns=tracking');
		const active = tab.state.active;
		const token = tab.auth.token();
		const list = vi.spyOn(tab.adapter, 'listAvailable');
		tab.registry.invalidate({ reason: 'created', namespaceId: 'pending' });
		await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(1));
		expect(tab.state.active).toBe(active);
		expect(tab.auth.token()).toBe(token);
		expect(tab.state.active?.platform.canManageNamespaces).toBe(false);
	});
});
