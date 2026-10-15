import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope, ref } from 'vue';
import { namespaceMemberItemsSource } from './use-namespace-member-items';

const memberList = vi.hoisted(() => vi.fn());

vi.mock('@/namespaces/live', () => ({
	ensureNamespaceRuntime: () => ({ state: { active: { namespaceId: 'child-a' } } }),
}));

vi.mock('../namespace-members', () => ({ listNamespaceMembers: memberList }));

afterEach(() => {
	vi.useRealTimers();
	memberList.mockReset();
});

describe('native directory member reader', () => {
	it('uses server search and page offsets when no local filter is selected', async () => {
		vi.useFakeTimers();

		memberList.mockResolvedValue({
			data: [
				{
					user_id: 'second',
					email: 'match@example.com',
					first_name: 'Match',
					last_name: null,
					status: 'active',
					role: null,
				},
			],
			meta: { total_count: 3, role_counts: {} },
		});

		const query = {
			fields: ref(['id', 'email']),
			limit: ref(1),
			sort: ref(['email']),
			search: ref('match'),
			page: ref(2),
			filter: ref(null),
		};

		const scope = effectScope();
		const source = scope.run(() => namespaceMemberItemsSource(ref('directus_users'), query as any))!;

		await source!.getItems();
		expect(memberList).toHaveBeenCalledWith('match', 1, 1, expect.any(AbortSignal));
		expect(source!.items.value[0]?.id).toBe('second');
		expect(source!.totalPages.value).toBe(3);

		scope.stop();
	});

	it('pages through only the namespace member endpoint and applies local role and status filters', async () => {
		vi.useFakeTimers();

		const members = [
			{
				user_id: 'a',
				email: 'a@example.com',
				first_name: 'A',
				last_name: null,
				status: 'active',
				role: { id: 'editor', name: 'Editor', admin_access: false },
			},
			{
				user_id: 'b',
				email: 'b@example.com',
				first_name: 'B',
				last_name: null,
				status: 'suspended',
				role: { id: 'editor', name: 'Editor', admin_access: false },
			},
			{
				user_id: 'c',
				email: 'c@example.com',
				first_name: 'C',
				last_name: null,
				status: 'active',
				role: { id: 'admin', name: 'Admin', admin_access: true },
			},
		];

		memberList.mockImplementation(async (_search: string, limit: number, offset: number) => ({
			data: members.slice(offset, offset + limit),
			meta: { total_count: members.length, role_counts: {} },
		}));

		const query = {
			fields: ref(['id', 'email']),
			limit: ref(1),
			sort: ref(['email']),
			search: ref(''),
			page: ref(1),
			filter: ref({ _and: [{ role: { _eq: 'editor' } }, { status: { _eq: 'active' } }] }),
		};

		const scope = effectScope();
		const source = scope.run(() => namespaceMemberItemsSource(ref('directus_users'), query as any))!;

		await source!.getItems();

		expect(source!.items.value).toEqual([
			{
				id: 'a',
				email: 'a@example.com',
				first_name: 'A',
				last_name: null,
				status: 'active',
				role: 'Editor',
				local_role_id: 'editor',
			},
		]);

		expect(source!.itemCount.value).toBe(1);
		expect(memberList).toHaveBeenCalledWith('', 250, 0, expect.any(AbortSignal));
		expect(memberList).toHaveBeenCalledTimes(1);

		scope.stop();
	});
});
