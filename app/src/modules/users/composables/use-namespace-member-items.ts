import type { ComputedQuery, ItemsSource, UsableItems } from '@wbce-d9/composables';
import type { Item } from '@wbce-d9/types';
import { computed, onScopeDispose, ref, unref, watch, type Ref } from 'vue';
import { ensureNamespaceRuntime } from '@/namespaces/live';
import { listNamespaceMembers, type NamespaceMember } from '../namespace-members';

const sortableFields = new Set(['id', 'email', 'first_name', 'last_name', 'status']);

function equality(filter: unknown, field: string): string | null {
	if (!filter || typeof filter !== 'object') return null;
	const value = filter as Record<string, any>;
	if (typeof value[field]?._eq === 'string') return value[field]._eq;

	if (Array.isArray(value._and)) {
		for (const child of value._and) {
			const found = equality(child, field);
			if (found) return found;
		}
	}

	return null;
}

function memberItem(member: NamespaceMember): Item {
	return {
		id: member.user_id,
		email: member.email,
		first_name: member.first_name,
		last_name: member.last_name,
		status: member.status,
		role: member.role?.name ?? null,
		local_role_id: member.role?.id ?? null,
	};
}

/** Native layouts read this adapter only in a virtual namespace User Directory. */
export const namespaceMemberItemsSource: ItemsSource = (
	collection: Ref<string | null>,
	query: ComputedQuery
): UsableItems | null => {
	if (collection.value !== 'directus_users') return null;
	const runtime = ensureNamespaceRuntime();
	const items = ref<Item[]>([]);
	const loading = ref(false);
	const error = ref<unknown>(null);
	const itemCount = ref<number | null>(null);
	const totalCount = ref<number | null>(null);
	const totalPages = computed(() => Math.max(1, Math.ceil((itemCount.value ?? 0) / Number(unref(query.limit) || 25))));
	let controller: AbortController | null = null;
	let pending: Promise<void> | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;

	watch(
		[
			collection,
			query.limit,
			query.sort,
			query.search,
			query.filter,
			query.page,
			() => runtime.state.active?.namespaceId,
		],
		() => {
			controller?.abort();
			pending = null;
			if (timer) clearTimeout(timer);
			items.value = [];
			itemCount.value = null;
			loading.value = true;
			if (Number(unref(query.page) || 1) < 1) query.page.value = 1;
			timer = setTimeout(() => void getItems(), 250);
		},
		{ deep: true, immediate: true }
	);

	onScopeDispose(() => {
		controller?.abort();
		if (timer) clearTimeout(timer);
	});

	return {
		items,
		loading,
		error,
		itemCount,
		totalCount,
		totalPages,
		getItems,
		getItemCount: getItems,
		getTotalCount: getItems,
		changeManualSort: async () => undefined,
	};

	function getItems(): Promise<void> {
		if (pending) return pending;
		const run = load();
		pending = run;

		void run.finally(() => {
			if (pending === run) pending = null;
		});

		return run;
	}

	async function load(): Promise<void> {
		controller?.abort();
		const request = new AbortController();
		controller = request;
		loading.value = true;
		error.value = null;
		const role = equality(unref(query.filter), 'role');
		const status = equality(unref(query.filter), 'status');
		const search = String(unref(query.search) ?? '').trim();
		const page = Math.max(1, Number(unref(query.page) || 1));
		const limit = Math.max(1, Number(unref(query.limit) || 25));
		const requestedSort = unref(query.sort)?.[0] ?? 'email';
		const sortField = String(requestedSort).replace(/^-/, '');
		const localSort = sortableFields.has(sortField) && (sortField !== 'email' || String(requestedSort).startsWith('-'));

		try {
			if (role || status || localSort) {
				// The backend has search and paging, but no role/status/sort parameters.
				// Enumerate this namespace's authorized member list before applying them.
				const all: NamespaceMember[] = [];
				let offset = 0;
				let total = 0;

				do {
					const result = await listNamespaceMembers(search, 250, offset, request.signal);
					if (request.signal.aborted) return;
					all.push(...result.data);
					total = result.meta.total_count;
					offset += result.data.length;
					if (result.data.length === 0) break;
				} while (offset < total);

				const filtered = all.filter(
					(member) => (!role || member.role?.id === role) && (!status || member.status === status)
				);

				if (localSort) {
					const direction = String(requestedSort).startsWith('-') ? -1 : 1;

					filtered.sort((a, b) => {
						const left = sortField === 'id' ? a.user_id : a[sortField as keyof NamespaceMember];
						const right = sortField === 'id' ? b.user_id : b[sortField as keyof NamespaceMember];
						return String(left ?? '').localeCompare(String(right ?? '')) * direction;
					});
				}

				if (request.signal.aborted) return;
				items.value = filtered.slice((page - 1) * limit, page * limit).map(memberItem);
				itemCount.value = filtered.length;
				totalCount.value = total;
			} else {
				const result = await listNamespaceMembers(search, limit, (page - 1) * limit, request.signal);
				if (request.signal.aborted) return;
				items.value = result.data.map(memberItem);
				itemCount.value = result.meta.total_count;
				if (!search) totalCount.value = result.meta.total_count;
			}

			if (items.value.length === 0 && page > 1) query.page.value = 1;
		} catch (cause) {
			if (!request.signal.aborted) error.value = cause;
		} finally {
			if (!request.signal.aborted) loading.value = false;
		}
	}
};
