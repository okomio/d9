import type { ComputedQuery, ItemsSource, UsableItems } from '@wbce-d9/composables';
import type { Item } from '@wbce-d9/types';
import { computed, onScopeDispose, ref, unref, watch, type Ref } from 'vue';
import { ensureNamespaceRuntime } from '@/namespaces/live';
import { lookupExistingUsers } from '@/modules/users/namespace-members';

export type LookupCandidate = {
	user_id: string;
	email: string | null;
	first_name: string | null;
	last_name: string | null;
	status: string | null;
	role_id: string | null;
};

/** Feed the native Directus collection drawer without reading the shared /users directory. */
export function createNamespaceUserLookupSource(
	active: Ref<boolean>,
	excludedIds: Ref<string[]>,
	onResults: (candidates: LookupCandidate[]) => void
): ItemsSource {
	return (collection: Ref<string | null>, query: ComputedQuery): UsableItems | null => {
		if (collection.value !== 'directus_users') return null;
		const runtime = ensureNamespaceRuntime();
		const items = ref<Item[]>([]);
		const loading = ref(false);
		const error = ref<unknown>(null);
		const itemCount = ref<number | null>(0);
		const totalCount = ref<number | null>(0);
		const totalPages = computed(() => 1);
		let controller: AbortController | null = null;
		let pending: Promise<void> | null = null;
		let timer: ReturnType<typeof setTimeout> | null = null;

		watch(
			[active, query.search, query.sort, excludedIds, () => runtime.state.active?.namespaceId],
			() => {
				controller?.abort();
				pending = null;
				if (timer) clearTimeout(timer);
				items.value = [];
				itemCount.value = 0;
				totalCount.value = 0;
				error.value = null;
				loading.value = false;
				query.page.value = 1;

				if (active.value && hasMeaningfulSearch(String(unref(query.search) ?? ''))) {
					timer = setTimeout(() => void getItems(), 250);
				}
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
			if (!active.value) return Promise.resolve();
			if (pending) return pending;
			const run = load();
			pending = run;

			void run.finally(() => {
				if (pending === run) pending = null;
			});

			return run;
		}

		async function load(): Promise<void> {
			if (!active.value) return;
			controller?.abort();
			const term = String(unref(query.search) ?? '').trim();
			if (!hasMeaningfulSearch(term)) return;

			const request = new AbortController();
			controller = request;
			loading.value = true;
			error.value = null;

			try {
				const response = await lookupExistingUsers(term, request.signal);
				if (request.signal.aborted) return;
				const candidates = response.data as LookupCandidate[];
				onResults(candidates);
				const excluded = new Set(excludedIds.value);
				const sort = String(unref(query.sort)?.[0] ?? 'email');
				const field = sort.replace(/^-/, '');
				const direction = sort.startsWith('-') ? -1 : 1;

				items.value = candidates
					.filter((candidate) => candidate.status === 'active' && !excluded.has(candidate.user_id))
					.map((candidate) => ({ ...candidate, id: candidate.user_id }))
					.sort((left, right) => String(left[field] ?? '').localeCompare(String(right[field] ?? '')) * direction);

				itemCount.value = items.value.length;
				totalCount.value = items.value.length;
			} catch (cause) {
				if (!request.signal.aborted) error.value = cause;
			} finally {
				if (!request.signal.aborted) loading.value = false;
			}
		}
	};
}

export function hasMeaningfulSearch(search: string): boolean {
	const term = search.trim();
	return term.length <= 100 && [...term.matchAll(/[\p{L}\p{N}]/gu)].length >= 2;
}
