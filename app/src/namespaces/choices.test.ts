import { describe, expect, it } from 'vitest';
import { createMockNamespaceAdapter } from './mock';
import { allowedDestination, isEnterableChild } from './choices';
import { createNamespaceRuntime } from './runtime';

describe('native child destinations', () => {
	it('uses a saved eligible landing, while an explicit namespace takes precedence', async () => {
		const adapter = createMockNamespaceAdapter();
		const original = adapter.readSessionContext.bind(adapter);
		adapter.readSessionContext = async () => ({ ...(await original()), preferredNamespaceId: 'aaa' });

		const runtime = createNamespaceRuntime({
			adapter,
			navigation: { commit: async () => {}, finish: async () => {} },
			confirmDiscard: async () => true,
		});

		try {
			await runtime.bootstrap('/content');
			expect(runtime.state.active?.namespaceId).toBe('aaa');
			await runtime.logout();
			await runtime.bootstrap('/content?ns=tracking');
			expect(runtime.state.active?.namespaceId).toBe('tracking');
		} finally {
			await runtime.dispose();
		}
	});

	it('ignores a revoked saved landing and keeps the chooser for multiple eligible children', async () => {
		const adapter = createMockNamespaceAdapter();
		const original = adapter.readSessionContext.bind(adapter);
		adapter.readSessionContext = async () => ({ ...(await original()), preferredNamespaceId: 'removed' });

		const runtime = createNamespaceRuntime({
			adapter,
			navigation: { commit: async () => {}, finish: async () => {} },
			confirmDiscard: async () => true,
		});

		try {
			await runtime.bootstrap('/content');
			expect(runtime.state.phase).toBe('no-access');
			expect(runtime.state.active).toBeNull();
		} finally {
			await runtime.dispose();
		}
	});

	it('keeps main out of the picker and rejects unready or API-only children', async () => {
		const adapter = createMockNamespaceAdapter();
		const choices = [...(await adapter.listAvailable())];
		const tracking = choices.find((choice) => choice.namespace.id === 'tracking')!;
		expect(choices.filter(isEnterableChild).map((choice) => choice.namespace.id)).toEqual(['tracking', 'aaa']);
		expect(allowedDestination(choices, 'main', false)).toBe(false);
		expect(allowedDestination(choices, 'main', true)).toBe(true);
		expect(allowedDestination(choices, 'pending', true)).toBe(false);

		expect(
			allowedDestination([{ ...tracking, access: { ...tracking.access, canUseApp: false } }], 'tracking', true)
		).toBe(false);
	});

	it('blocks a legacy main deep link when no child app access exists', async () => {
		const adapter = createMockNamespaceAdapter();

		adapter.listAvailable = async () =>
			(await createMockNamespaceAdapter().listAvailable()).filter(
				(choice) => choice.namespace.kind === 'main' || !isEnterableChild(choice)
			);

		const runtime = createNamespaceRuntime({
			adapter,
			navigation: { commit: async () => {}, finish: async () => {} },
			confirmDiscard: async () => true,
		});

		try {
			await runtime.bootstrap('/content?ns=main');
			expect(runtime.state.phase).toBe('no-access');
			expect(runtime.state.active).toBeNull();
		} finally {
			await runtime.dispose();
		}
	});

	it('clears native content when a refreshed listing removes the active child', async () => {
		const runtime = createNamespaceRuntime({
			adapter: createMockNamespaceAdapter('local-admin'),
			navigation: { commit: async () => {}, finish: async () => {} },
			confirmDiscard: async () => true,
		});

		try {
			await runtime.bootstrap('/content?ns=tracking');
			expect(runtime.state.phase).toBe('ready');
			runtime.adapter.listAvailable = async () => [];
			await runtime.refreshChoices();
			expect(runtime.state.phase).toBe('no-access');
			expect(runtime.snapshot.value).toBeNull();
			expect(runtime.state.session).not.toBeNull();
		} finally {
			await runtime.dispose();
		}
	});

	it('publishes a listing failure without replacing the active namespace', async () => {
		const runtime = createNamespaceRuntime({
			adapter: createMockNamespaceAdapter('local-admin'),
			navigation: { commit: async () => {}, finish: async () => {} },
			confirmDiscard: async () => true,
		});

		try {
			await runtime.bootstrap('/content?ns=tracking');

			runtime.adapter.listAvailable = async () => {
				throw new Error('listing unavailable');
			};

			await expect(runtime.refreshChoices()).rejects.toThrow('listing unavailable');
			expect(runtime.state.choicesLoading).toBe(false);
			expect(runtime.state.choicesError).toBeInstanceOf(Error);
			expect(runtime.state.active?.namespaceId).toBe('tracking');
		} finally {
			await runtime.dispose();
		}
	});
});
