<template>
	<private-view :title="namespaceName ? `${namespaceName} Users` : 'Users by namespace'">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary><v-icon name="people_alt" /></v-button>
		</template>
		<template #navigation><global-navigation /></template>
		<template #actions:prepend>
			<span v-if="total" class="item-count">{{ showingCount }}</span>
		</template>
		<template #actions>
			<search-input v-model="search">
				<template #filter>
					<p class="filter-note">Additional user filters require the D14 global directory API.</p>
				</template>
			</search-input>
			<v-button v-tooltip.bottom="'Invite Users'" rounded icon secondary @click="inviteModalActive = true">
				<v-icon name="person_add" />
			</v-button>
			<v-button
				v-tooltip.bottom="'Create User (D14)'"
				rounded
				icon
				:to="{ path: '/global-admin/users/new', query: { admin_ns: namespaceId, admin_role: roleId } }"
			>
				<v-icon name="add" />
			</v-button>
		</template>
		<template #sidebar>
			<sidebar-detail icon="info" title="Membership filter" close>
				This directory shows explicit local memberships. Inherited Global Admin access is separate. Full global user
				filters and role-filtered counts require D14.
			</sidebar-detail>
			<sidebar-detail icon="layers" title="Layout options">
				<div class="layout-option">
					<label>Layout</label>
					<v-select v-model="layout" :items="layoutOptions" />
				</div>
			</sidebar-detail>
			<refresh-sidebar-detail v-model="refreshInterval" @refresh="load" />
		</template>
		<users-invite v-model="inviteModalActive" platform :initial-namespace-id="namespaceId" :initial-role-id="roleId" />
		<div class="directory" :class="{ cards: layout === 'cards' }">
			<v-notice v-if="!namespaceId || !validNamespace" type="warning">
				Choose an available virtual namespace to filter users.
			</v-notice>
			<v-notice v-else-if="roleId" type="warning">
				Filtering by a local role requires the D14 server-side directory API. No partial result is shown.
			</v-notice>
			<v-notice v-if="error" type="danger">
				{{ error }}
				<v-button secondary @click="load">Retry</v-button>
			</v-notice>
			<template v-if="validNamespace && !roleId && (loading || members.length > 0)">
				<cards-header
					v-if="layout === 'cards'"
					v-model:size="cardSize"
					v-model:selection="selection"
					:fields="cardFields"
					:sort="['email']"
					:sort-disabled="true"
					sort-disabled-tooltip="Sorting namespace members requires D14"
					show-select="multiple"
					@select-all="selectAll"
				/>
				<div v-if="layout === 'cards'" class="grid" :style="{ '--size': `${cardSize * 40}px` }">
					<card
						v-for="member in members"
						:key="member.user_id"
						v-model="selection"
						:item="member"
						item-key="user_id"
						icon="account_circle"
						:select-mode="selection.length > 0"
						:to="userPath(member)"
					>
						<template #title>{{ displayName(member) }}</template>
						<template #subtitle>{{ member.email }}</template>
					</card>
				</div>
				<v-table
					v-else
					v-model="selection"
					v-model:headers="headers"
					:items="members"
					:loading="loading"
					show-select="multiple"
					selection-use-keys
					show-resize
					fixed-header
					item-key="user_id"
					@click:row="openUser"
				>
					<template #[`item.name`]="{ item }">{{ displayName(item) }}</template>
					<template #[`item.role`]="{ item }">{{ item.role?.name ?? 'No local role' }}</template>
				</v-table>
				<div class="footer">
					<v-pagination
						v-if="pageCount > 1"
						:length="pageCount"
						:total-visible="7"
						show-first-last
						:model-value="page"
						@update:model-value="offset = ($event - 1) * pageSize"
					/>
					<div v-if="!loading && members.length >= 25" class="per-page">
						<span>{{ t('per_page') }}</span>
						<v-select
							:model-value="`${pageSize}`"
							:items="['25', '50', '100', '250', '500']"
							inline
							@update:model-value="setPageSize"
						/>
					</div>
				</div>
			</template>
			<v-info
				v-else-if="validNamespace && !roleId && !loading && !error"
				:title="search ? t('no_results') : t('user_count', 0)"
				:icon="search ? 'search' : 'people_alt'"
				center
			/>
		</div>
	</private-view>
</template>

<script setup lang="ts">
import api from '@/api';
import type { HeaderRaw } from '@/components/v-table/types';
import Card from '@/layouts/cards/components/card.vue';
import CardsHeader from '@/layouts/cards/components/header.vue';
import { canManagePlatformResource } from '@/namespaces/capabilities';
import { ensureNamespaceRuntime } from '@/namespaces/live';
import RefreshSidebarDetail from '@/views/private/components/refresh-sidebar-detail.vue';
import SearchInput from '@/views/private/components/search-input.vue';
import UsersInvite from '@/views/private/components/users-invite.vue';
import type { Field } from '@wbce-d9/types';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import GlobalNavigation from './navigation.vue';

type Member = {
	user_id: string;
	email: string | null;
	first_name: string | null;
	last_name: string | null;
	status: string | null;
	role: { id: string; name: string } | null;
};

const runtime = ensureNamespaceRuntime();
const route = useRoute();
const router = useRouter();
const { t, n } = useI18n();
const namespaceId = computed(() => (typeof route.query.admin_ns === 'string' ? route.query.admin_ns : null));
const roleId = computed(() => (typeof route.query.admin_role === 'string' ? route.query.admin_role : null));

const namespaceChoice = computed(() =>
	runtime.state.choices.find(
		(choice) => choice.namespace.id === namespaceId.value && choice.namespace.kind === 'virtual'
	)
);

const namespaceName = computed(() => namespaceChoice.value?.namespace.name);
const validNamespace = computed(() => !!namespaceChoice.value);

const members = ref<Member[]>([]);
const inviteModalActive = ref(false);
const total = ref(0);
const loading = ref(false);
const error = ref<string | null>(null);
const search = ref<string | null>(null);
const offset = ref(0);
const pageSize = ref(25);
const page = computed(() => Math.floor(offset.value / pageSize.value) + 1);
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));
const selection = ref<string[]>([]);
const layout = ref<'cards' | 'tabular'>('cards');
const cardSize = ref(4);
const refreshInterval = ref<number | null>(null);

const layoutOptions = [
	{ text: 'Cards', value: 'cards' },
	{ text: 'Table', value: 'tabular' },
];

const cardFields = [{ field: 'email', name: 'Email', type: 'string' }] as Field[];

const showingCount = computed(() => {
	if (total.value <= pageSize.value) return t('item_count', { count: total.value });
	return t('start_end_of_count_items', {
		start: n(offset.value + 1),
		end: n(Math.min(offset.value + pageSize.value, total.value)),
		count: n(total.value),
	});
});

const headers = ref<HeaderRaw[]>([
	{ text: 'Name', value: 'name', width: 240, sortable: false },
	{ text: 'Email', value: 'email', width: 260, sortable: false },
	{ text: 'Status', value: 'status', width: 140, sortable: false },
	{ text: 'Local role', value: 'role', width: 200, sortable: false },
]);

let controller: AbortController | null = null;
let timer: number | null = null;

watch(
	() => route.query.invite,
	(invite) => {
		if (invite === '1') inviteModalActive.value = true;
	},
	{ immediate: true }
);

watch(inviteModalActive, (open) => {
	if (!open && route.query.invite === '1') {
		const query = { ...route.query };
		delete query.invite;
		void router.replace({ query });
	}
});

watch([namespaceId, roleId], () => {
	offset.value = 0;
	selection.value = [];
});

watch(
	[namespaceChoice, roleId, offset, pageSize],
	() => {
		void load();
	},
	{ immediate: true }
);

watch(search, () => {
	offset.value = 0;
	selection.value = [];
	if (timer) window.clearTimeout(timer);
	timer = window.setTimeout(() => void load(), 300);
});

onBeforeUnmount(() => {
	controller?.abort();
	if (timer) window.clearTimeout(timer);
});

function displayName(member: Member) {
	return [member.first_name, member.last_name].filter(Boolean).join(' ') || member.email || member.user_id;
}

function userPath(member: Member) {
	return `/global-admin/users/${encodeURIComponent(member.user_id)}`;
}

function openUser({ item }: { item: Member }) {
	void router.push(userPath(item));
}

function selectAll() {
	selection.value = members.value.map((member) => member.user_id);
}

function setPageSize(value: string) {
	pageSize.value = Number(value);
	offset.value = 0;
}

async function load() {
	controller?.abort();
	members.value = [];
	total.value = 0;
	error.value = null;
	loading.value = false;
	selection.value = [];
	if (!namespaceId.value || !validNamespace.value || roleId.value) return;
	if (!canManagePlatformResource(runtime.state.session?.platform ?? null, 'users')) return;
	const request = new AbortController();
	controller = request;
	loading.value = true;

	try {
		const response = await api.get<{ data: Member[]; meta: { total_count: number } }>(
			`/namespaces/${encodeURIComponent(namespaceId.value)}/members`,
			{
				params: { search: search.value || undefined, limit: pageSize.value, offset: offset.value },
				signal: request.signal,
			}
		);

		if (!request.signal.aborted) {
			members.value = response.data.data;
			total.value = response.data.meta.total_count;
		}
	} catch {
		if (!request.signal.aborted) error.value = 'Could not load namespace members';
	} finally {
		if (!request.signal.aborted) loading.value = false;
	}
}
</script>

<style scoped>
.header-icon {
	--v-button-color-disabled: var(--foreground-normal);
}
.item-count {
	display: none;
	margin: 0 8px;
	color: var(--foreground-subdued);
	white-space: nowrap;
}
@media (min-width: 600px) {
	.item-count {
		display: inline;
	}
}
.directory {
	--layout-offset-top: 64px;

	padding: var(--content-padding);
}
.directory.cards {
	padding-top: 0;
}
.grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(var(--size), 1fr));
	gap: 32px 24px;
}
.footer {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding-top: 40px;
}
.per-page {
	display: flex;
	gap: 8px;
	align-items: center;
}
.layout-option {
	display: grid;
	gap: 8px;
}
.filter-note {
	min-width: 240px;
	margin: 10px 8px;
}
</style>
