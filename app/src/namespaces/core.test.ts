import { describe, expect, it, vi } from 'vitest';
import { createNamespaceState } from './context';
import { createNamespaceLifecycle } from './lifecycle';
import { createOperationLedger } from './requests';
import { createNamespaceCoordinator, type TokenAuthority } from './coordinator';
import { createMockNamespaceAdapter } from './mock';
import type { NamespaceSnapshot, TokenGrant } from './types';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;

	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});

	return { promise, resolve, reject };
}

function setup() {
	const state = createNamespaceState();
	const adapter = createMockNamespaceAdapter();
	const lifecycle = createNamespaceLifecycle();
	let token: string | null = null;
	let snapshot: NamespaceSnapshot | null = null;

	const auth: TokenAuthority = {
		mint: (id, signal) => adapter.mintTargetToken(id, signal),
		install: (grant) => {
			token = grant.accessToken;
		},
		clear: () => {
			token = null;
		},
		token: () => token,
	};

	const ledger = createOperationLedger(state, auth.token);
	const confirmDiscard = vi.fn(async () => true);
	const navigation = { commit: vi.fn(async () => {}), finish: vi.fn(async () => {}) };

	const coordinator = createNamespaceCoordinator({
		state,
		adapter,
		auth,
		lifecycle,
		ledger,
		navigation,
		confirmDiscard,
		publish: (value) => {
			snapshot = value;
		},
	});

	return { state, adapter, lifecycle, ledger, coordinator, confirmDiscard, navigation, snapshot: () => snapshot };
}

describe('namespace coordinator and real settlement ledger', () => {
	it('retains source drafts and token on Stay, including query-only switches', async () => {
		const x = setup();
		await x.coordinator.requestSwitch({ namespaceId: 'main', source: 'bootstrap' });
		const reset = vi.fn();
		x.lifecycle.register({ id: 'item', dirty: () => true, reset });
		x.confirmDiscard.mockResolvedValue(false);
		const active = x.state.active;

		expect(
			await x.coordinator.requestSwitch({
				namespaceId: 'tracking',
				source: 'history',
				destination: '/content/articles?ns=tracking',
			})
		).toEqual({ status: 'stayed' });

		expect(x.state.active).toBe(active);
		expect(reset).not.toHaveBeenCalled();
		expect(x.state.phase).toBe('ready');
	});

	it('cancels reads promptly and waits for a real slow source write before minting', async () => {
		const x = setup();
		await x.coordinator.requestSwitch({ namespaceId: 'main', source: 'bootstrap' });
		const write = deferred<void>();
		const read = deferred<string>();
		let captured = '';

		const writing = x.ledger.run('write', async (context) => {
			captured = context.namespaceId;
			await write.promise;
		});

		const reading = x.ledger.run('read', () => read.promise);
		const cancelled = expect(reading).rejects.toMatchObject({ kind: 'cancelled' });
		const switching = x.coordinator.requestSwitch({ namespaceId: 'tracking', source: 'picker' });
		await vi.waitFor(() => expect(x.state.phase).toBe('quiescing'));
		await cancelled;
		expect(captured).toBe('main');
		expect(x.state.active?.namespaceId).toBe('main');
		expect(await x.coordinator.requestSwitch({ namespaceId: 'aaa', source: 'picker' })).toEqual({ status: 'busy' });
		write.resolve();
		await writing;
		await switching;
		read.resolve('late');
		expect(x.state.active?.namespaceId).toBe('tracking');
		expect(x.snapshot()?.collections[0]?.name).toBe('tracking articles');
	});

	it('resumes source once after mint rejection without resetting drafts', async () => {
		const x = setup();
		await x.coordinator.requestSwitch({ namespaceId: 'main', source: 'bootstrap' });
		const resume = vi.fn();
		const reset = vi.fn();
		x.lifecycle.register({ id: 'form', resume, reset });
		await x.coordinator.requestSwitch({ namespaceId: 'pending', source: 'picker' });
		expect(resume).toHaveBeenCalledTimes(1);
		expect(reset).not.toHaveBeenCalled();
		expect(x.state.active?.namespaceId).toBe('main');
		expect(x.state.phase).toBe('ready');
	});

	it('blocks failed writes until explicit source reconciliation', async () => {
		const x = setup();
		await x.coordinator.requestSwitch({ namespaceId: 'main', source: 'bootstrap' });

		await expect(
			x.ledger.run('write', async () => {
				throw new Error('unknown');
			})
		).rejects.toThrow();

		expect((await x.coordinator.requestSwitch({ namespaceId: 'tracking', source: 'picker' })).status).toBe('blocked');
		expect(x.state.active?.namespaceId).toBe('main');
		x.ledger.acknowledgeWriteFailures();
		expect((await x.coordinator.requestSwitch({ namespaceId: 'tracking', source: 'picker' })).status).toBe('ready');
	});

	it('clears partial hydration, retains target identity and safely recovers', async () => {
		const x = setup();
		await x.coordinator.requestSwitch({ namespaceId: 'main', source: 'bootstrap' });
		const reset = vi.fn();
		x.lifecycle.register({ id: 'cache', reset });
		const original = x.adapter.hydrate;

		x.adapter.hydrate = async () => {
			throw new Error('hydrate failed');
		};

		await x.coordinator.requestSwitch({ namespaceId: 'tracking', source: 'picker' });
		expect(x.state.phase).toBe('blocked');
		expect(x.state.active?.namespaceId).toBe('tracking');
		expect(x.snapshot()).toBeNull();
		expect(reset).toHaveBeenCalledTimes(2);
		x.adapter.hydrate = original;
		await x.coordinator.requestSwitch({ namespaceId: 'tracking', source: 'recovery' });
		expect(x.state.phase).toBe('ready');
	});

	it('never resurrects context after logout during mint', async () => {
		const x = setup();
		const pending = deferred<TokenGrant>();
		x.adapter.mintTargetToken = () => pending.promise;
		const switching = x.coordinator.requestSwitch({ namespaceId: 'main', source: 'bootstrap' });
		await vi.waitFor(() => expect(x.state.phase).toBe('minting'));
		x.state.sessionGeneration++;
		x.coordinator.invalidate();
		x.state.active = null;
		x.state.phase = 'idle';
		pending.resolve(await createMockNamespaceAdapter().mintTargetToken('main'));
		await switching;
		expect(x.state.active).toBeNull();
		expect(x.state.phase).toBe('idle');
	});

	it('supports inherited admins without a child role and suppresses stale callbacks', async () => {
		const x = setup();
		await x.coordinator.requestSwitch({ namespaceId: 'tracking', source: 'bootstrap' });
		expect(x.state.active?.access.localRole).toBeNull();
		expect(x.state.active?.platform.isGlobalAdmin).toBe(true);
		const old = x.state.active!;
		await x.coordinator.requestSwitch({ namespaceId: 'aaa', source: 'picker' });
		const effect = vi.fn();
		x.ledger.effect(old, effect);
		expect(effect).not.toHaveBeenCalled();
	});
});
