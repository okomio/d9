import api from '@/api';
import type { ComputedQuery, ItemsSource, UsableItems } from '@wbce-d9/composables';
import type { Item } from '@wbce-d9/types';
import { computed, onScopeDispose, ref, unref, watch, type Ref } from 'vue';
import { useRoute } from 'vue-router';

type Member = {
	user_id: string;
	email: string | null;
	first_name: string | null;
	last_name: string | null;
	status: string | null;
	role: { id: string; name: string } | null;
};

const sortable = new Set(['id', 'email', 'first_name', 'last_name', 'status']);

function statusFilter(filter: unknown): string | null | undefined {
	if (filter == null) return null;
	if (typeof filter !== 'object') return undefined;
	const value = filter as Record<string, any>;
	if (typeof value.status?._eq === 'string' && Object.keys(value).length === 1) return value.status._eq;
	return undefined;
}

function toItem(member: Member): Item {
	return {
		id: member.user_id,
		email: member.email,
		first_name: member.first_name,
		last_name: member.last_name,
		status: member.status,
		role: member.role,
	};
}

/** Global Administration's filtered view keeps the native Users layouts and never changes content context. */
export const filteredUserItemsSource: ItemsSource = (
	collection: Ref<string | null>,
	query: ComputedQuery
): UsableItems | null => {
	if (collection.value !== 'directus_users') return null;
	const route = useRoute();
	const namespaceId = computed(() => (typeof route.query.admin_ns === 'string' ? route.query.admin_ns : null));
	const roleId = computed(() => (typeof route.query.admin_role === 'string' ? route.query.admin_role : null));
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
		[collection, namespaceId, roleId, query.limit, query.sort, query.search, query.filter, query.page],
		() => {
			controller?.abort();
			pending = null;
			if (timer) clearTimeout(timer);
			items.value = [];
			itemCount.value = null;
			totalCount.value = null;
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
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
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
		const namespace = namespaceId.value;
		const role = roleId.value;
		const status = statusFilter(unref(query.filter));
		const sort = String(unref(query.sort)?.[0] ?? 'email');
		const sortField = sort.replace(/^-/, '');
		const page = Math.max(1, Number(unref(query.page) || 1));
		const limit = Math.max(1, Number(unref(query.limit) || 25));

		try {
			if (!namespace || status === undefined || !sortable.has(sortField)) {
				throw new Error('This filter requires a server-side global user query. No partial result is shown.');
			}

			const path = `/namespaces/${encodeURIComponent(namespace)}/members`;
			const params = { search: unref(query.search) || undefined, role_id: role || undefined };
			const localFilter = status !== null || sort !== 'email';

			if (localFilter) {
				const all: Member[] = [];
				let offset = 0;
				let total = 0;
				do {
					const response = await api.get<{ data: Member[]; meta: { total_count: number } }>(path, {
						params: { ...params, limit: 250, offset },
						signal: request.signal,
					});
					if (request.signal.aborted) return;
					all.push(...response.data.data);
					total = response.data.meta.total_count;
					offset += response.data.data.length;
					if (!response.data.data.length) break;
				} while (offset < total);

				const filtered = all.filter((member) => status === null || member.status === status);
				if (sort !== 'email') {
					const direction = sort.startsWith('-') ? -1 : 1;
					filtered.sort(
						(a, b) =>
							String(sortField === 'id' ? a.user_id : a[sortField as keyof Member] ?? '').localeCompare(
								String(sortField === 'id' ? b.user_id : b[sortField as keyof Member] ?? '')
							) * direction
					);
				}
				items.value = await hydrate(filtered.slice((page - 1) * limit, page * limit), request.signal);
				itemCount.value = filtered.length;
				totalCount.value = total;
			} else {
				const response = await api.get<{ data: Member[]; meta: { total_count: number } }>(path, {
					params: { ...params, limit, offset: (page - 1) * limit },
					signal: request.signal,
				});
				if (request.signal.aborted) return;
				items.value = await hydrate(response.data.data, request.signal);
				itemCount.value = response.data.meta.total_count;
				if (!params.search) totalCount.value = response.data.meta.total_count;
			}
			if (items.value.length === 0 && page > 1) query.page.value = 1;
		} catch (cause) {
			if (!request.signal.aborted) error.value = cause;
		} finally {
			if (!request.signal.aborted) loading.value = false;
		}
	}

	async function hydrate(members: Member[], signal: AbortSignal): Promise<Item[]> {
		if (members.length === 0) return [];
		const ids = members.map((member) => member.user_id);
		const requestedFields = unref(query.fields) ?? ['*'];
		const fields =
			requestedFields.includes('*') || requestedFields.includes('id') ? requestedFields : [...requestedFields, 'id'];
		const response = await api.get<{ data: Item[] }>('/users', {
			params: { filter: { id: { _in: ids } }, fields, limit: -1 },
			signal,
		});
		if (signal.aborted) return [];
		const profiles = new Map(response.data.data.map((item) => [item.id, item]));
		return members.map((member) => ({ ...profiles.get(member.user_id), ...toItem(member) }));
	}
};
