import { afterEach, describe, expect, test, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import { createNamespaceUserLookupSource, hasMeaningfulSearch } from './namespace-user-lookup';

const lookup = vi.hoisted(() => vi.fn());

vi.mock('@/namespaces/live', () => ({
	ensureNamespaceRuntime: () => ({ state: { active: { namespaceId: 'tracking' } } }),
}));

vi.mock('@/modules/users/namespace-members', () => ({ lookupExistingUsers: lookup }));

afterEach(() => {
	lookup.mockReset();
});

describe('role user picker data source', () => {
	test('does not list any users until a meaningful search is entered', async () => {
		const search = ref('');

		const query = {
			fields: ref(['id', 'email']),
			limit: ref(500),
			sort: ref(['email']),
			search,
			page: ref(1),
			filter: ref(null),
		};

		const scope = effectScope();

		const source = scope.run(() =>
			createNamespaceUserLookupSource(ref(true), ref([]), vi.fn())(ref('directus_users'), query as any)
		)!;

		await source!.getItems();
		search.value = '%_';
		await nextTick();
		await source!.getItems();
		search.value = 'a';
		await nextTick();
		await source!.getItems();

		expect(source!.items.value).toEqual([]);
		expect(lookup).not.toHaveBeenCalled();
		expect(hasMeaningfulSearch(' a% ')).toBe(false);
		scope.stop();
	});

	test('does not prefetch a saved search while the drawer is closed', async () => {
		const query = {
			fields: ref(['id', 'email']),
			limit: ref(500),
			sort: ref(['email']),
			search: ref('admin'),
			page: ref(1),
			filter: ref(null),
		};

		const scope = effectScope();

		const source = scope.run(() =>
			createNamespaceUserLookupSource(ref(false), ref([]), vi.fn())(ref('directus_users'), query as any)
		)!;

		await source!.getItems();

		expect(lookup).not.toHaveBeenCalled();
		scope.stop();
	});

	test('uses the bounded namespace lookup and preserves candidates for membership assignment', async () => {
		lookup.mockResolvedValue({
			data: [
				{
					user_id: 'new-user',
					email: 'ad@example.com',
					first_name: 'Ad',
					last_name: null,
					status: 'active',
					role_id: null,
				},
				{
					user_id: 'in-role',
					email: 'admin@example.com',
					first_name: 'Admin',
					last_name: null,
					status: 'active',
					role_id: 'role',
				},
			],
		});

		const onResults = vi.fn();

		const query = {
			fields: ref(['id', 'email']),
			limit: ref(500),
			sort: ref(['email']),
			search: ref('ad'),
			page: ref(1),
			filter: ref(null),
		};

		const scope = effectScope();

		const source = scope.run(() =>
			createNamespaceUserLookupSource(ref(true), ref(['in-role']), onResults)(ref('directus_users'), query as any)
		)!;

		await source!.getItems();

		expect(lookup).toHaveBeenCalledWith('ad', expect.any(AbortSignal));
		expect(source!.items.value.map((item) => item.id)).toEqual(['new-user']);
		expect(onResults.mock.calls[0]![0][0].role_id).toBeNull();
		expect(source!.totalPages.value).toBe(1);
		scope.stop();
	});
});
