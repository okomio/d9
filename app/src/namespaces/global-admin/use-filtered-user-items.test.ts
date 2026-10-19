import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope, reactive, ref } from 'vue';
import { filteredUserItemsSource } from './use-filtered-user-items';

const get = vi.hoisted(() => vi.fn());
const route = reactive({ query: { admin_ns: 'tracking', admin_role: 'viewer' } as Record<string, string> });

vi.mock('@/api', () => ({ default: { get } }));
vi.mock('vue-router', () => ({ useRoute: () => route }));

afterEach(() => {
	vi.useRealTimers();
	get.mockReset();
	route.query = { admin_ns: 'tracking', admin_role: 'viewer' };
});

describe('Global Administration native directory reader', () => {
	it('uses the selected namespace and role before server pagination', async () => {
		vi.useFakeTimers();
		get.mockImplementation(async (path: string) =>
			path === '/users'
				? { data: { data: [{ id: 'user-2', email: 'b@example.com', language: 'en-US' }] } }
				: {
						data: {
							data: [
								{
									user_id: 'user-2',
									email: 'b@example.com',
									first_name: 'B',
									last_name: null,
									status: 'active',
									role: { id: 'viewer', name: 'Viewer' },
								},
							],
							meta: { total_count: 3 },
						},
				  }
		);
		const query = {
			fields: ref(['id', 'email', 'language']),
			limit: ref(1),
			sort: ref(['email']),
			search: ref('b'),
			page: ref(2),
			filter: ref(null),
		};
		const scope = effectScope();
		const source = scope.run(() => filteredUserItemsSource(ref('directus_users'), query as any))!;
		await source!.getItems();
		expect(get).toHaveBeenCalledWith('/namespaces/tracking/members', {
			params: { search: 'b', role_id: 'viewer', limit: 1, offset: 1 },
			signal: expect.any(AbortSignal),
		});
		expect(source!.items.value[0]?.id).toBe('user-2');
		expect(source!.items.value[0]?.language).toBe('en-US');
		expect(source!.items.value[0]?.role).toEqual({ id: 'viewer', name: 'Viewer' });
		expect(source!.itemCount.value).toBe(3);
		scope.stop();
	});

	it('reports unsupported native filters instead of returning an unfiltered page', async () => {
		vi.useFakeTimers();
		const query = {
			fields: ref(['id']),
			limit: ref(25),
			sort: ref(['email']),
			search: ref(''),
			page: ref(1),
			filter: ref({ language: { _eq: 'en-US' } }),
		};
		const scope = effectScope();
		const source = scope.run(() => filteredUserItemsSource(ref('directus_users'), query as any))!;
		await source!.getItems();
		expect(source!.error.value).toBeInstanceOf(Error);
		expect(get).not.toHaveBeenCalled();
		scope.stop();
	});

	it('refreshes when the URL selects a different namespace without switching content context', async () => {
		vi.useFakeTimers();
		get.mockResolvedValue({ data: { data: [], meta: { total_count: 0 } } });
		const query = {
			fields: ref(['id']),
			limit: ref(25),
			sort: ref(['email']),
			search: ref(''),
			page: ref(1),
			filter: ref(null),
		};
		const scope = effectScope();
		const source = scope.run(() => filteredUserItemsSource(ref('directus_users'), query as any))!;
		await source!.getItems();
		route.query = { admin_ns: 'accounts' };
		await Promise.resolve();
		await vi.runAllTimersAsync();
		expect(get).toHaveBeenLastCalledWith('/namespaces/accounts/members', {
			params: { search: undefined, role_id: undefined, limit: 25, offset: 0 },
			signal: expect.any(AbortSignal),
		});
		scope.stop();
	});
});
