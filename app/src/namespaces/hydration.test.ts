import { describe, expect, it, vi } from 'vitest';
import { hydrateNamespaceSnapshot } from './hydration';
import { canManageNamespaceResource, canManagePlatformResource } from './capabilities';
import { contextFromGrant, createNamespaceState } from './context';
import { createMockNamespaceAdapter } from './mock';

const stamp = { namespaceId: 'tracking', epoch: 1, sessionGeneration: 0 };

describe('checked hydration and resource capabilities', () => {
	it('aborts siblings after failure and awaits their settlement without publishing partial state', async () => {
		let settle!: () => void;
		let siblingSignal!: AbortSignal;

		const hydration = hydrateNamespaceSnapshot(stamp, 'token', new AbortController().signal, {
			collections: async () => {
				throw new Error('Required metadata failed');
			},
			permissions: async (_context, _token, signal) => {
				siblingSignal = signal;

				await new Promise<void>((resolve) => {
					settle = resolve;
				});

				return [];
			},
		});

		let finished = false;
		const rejected = expect(hydration).rejects.toThrow('Required metadata failed');

		void hydration
			.finally(() => {
				finished = true;
			})
			.catch(() => {});

		await vi.waitFor(() => expect(siblingSignal.aborted).toBe(true));
		expect(finished).toBe(false);
		settle();
		await rejected;
	});

	it('returns a target snapshot only after both checked reads succeed', async () => {
		expect(
			await hydrateNamespaceSnapshot(stamp, 'token', new AbortController().signal, {
				collections: async () => [{ collection: 'articles', name: 'Tracking' }],
				permissions: async () => [],
			})
		).toMatchObject({ namespaceId: 'tracking', collections: [{ collection: 'articles' }] });
	});

	it('local admin capability never grants shared-user/settings/namespace administration', async () => {
		const grant = await createMockNamespaceAdapter('local-admin').mintTargetToken('tracking');
		const state = createNamespaceState();
		const context = contextFromGrant(grant, state);
		expect(canManageNamespaceResource(context, 'schema')).toBe(true);
		expect(canManageNamespaceResource(context, 'members')).toBe(true);
		expect(canManagePlatformResource(context.platform, 'users')).toBe(false);
		expect(canManagePlatformResource(context.platform, 'settings')).toBe(false);
		expect(canManagePlatformResource(context.platform, 'namespaces')).toBe(false);
	});

	it('inherited Global Admin authority permits platform views without a local role', async () => {
		const grant = await createMockNamespaceAdapter('global-admin').mintTargetToken('tracking');
		const context = contextFromGrant(grant, createNamespaceState());

		expect(context.access.localRole).toBeNull();
		expect(canManagePlatformResource(context.platform, 'users')).toBe(true);
		expect(canManagePlatformResource(context.platform, 'namespaces')).toBe(true);
	});

	it('preserves ordinary permission filters and different local roles across namespaces', async () => {
		const adapter = createMockNamespaceAdapter('multi-role');
		const tracking = await adapter.mintTargetToken('tracking');
		const aaa = await adapter.mintTargetToken('aaa');
		expect(tracking.access.localRole?.id).not.toBe(aaa.access.localRole?.id);
		const snapshot = await adapter.hydrate(stamp, tracking.accessToken, new AbortController().signal);
		expect(snapshot.permissions[0]?.filter).toEqual({ owner: 'member' });
		expect(tracking.platform.isGlobalAdmin).toBe(false);
	});
});
