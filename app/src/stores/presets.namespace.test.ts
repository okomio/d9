import api from '@/api';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUserStore } from './user';
import { usePresetsStore } from './presets';

vi.mock('@/api', () => ({ default: { get: vi.fn() } }));

beforeEach(() => {
	setActivePinia(createPinia());
	vi.mocked(api.get).mockReset();
	vi.mocked(api.get).mockResolvedValue({ data: { data: [] } });
});

describe('namespace preset role selection', () => {
	it('does not query a main role for an inherited Global Admin without a child role', async () => {
		const user = useUserStore();
		user.currentUser = { id: 'global-admin', role: null } as typeof user.currentUser;
		const presets = usePresetsStore();

		await presets.hydrate();

		expect(api.get).toHaveBeenCalledTimes(2);

		expect(vi.mocked(api.get).mock.calls.map(([, config]) => config?.params)).toEqual([
			{ 'filter[user][_eq]': 'global-admin', limit: -1 },
			{ 'filter[role][_null]': true, 'filter[user][_null]': true, limit: -1 },
		]);

		presets.collectionPresets = [
			{ id: 1, collection: 'articles', user: null, role: 'main-admin', bookmark: null },
			{ id: 2, collection: 'articles', user: null, role: null, bookmark: null },
		] as typeof presets.collectionPresets;

		expect(presets.getPresetForCollection('articles')?.id).toBe(2);
	});

	it('uses only the assigned child Administrator role for role presets', async () => {
		const user = useUserStore();

		user.currentUser = {
			id: 'child-admin',
			role: { id: 'tracking-admin', admin_access: true },
		} as typeof user.currentUser;

		const presets = usePresetsStore();

		await presets.hydrate();

		expect(api.get).toHaveBeenCalledTimes(3);

		expect(vi.mocked(api.get).mock.calls[1]?.[1]?.params).toEqual({
			'filter[role][_eq]': 'tracking-admin',
			'filter[user][_null]': true,
			limit: -1,
		});
	});
});
