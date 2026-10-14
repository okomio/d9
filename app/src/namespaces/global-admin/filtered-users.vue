<template>
	<private-view :title="namespaceName ? `${namespaceName} Users` : 'Users by namespace'">
		<template #navigation><global-navigation /></template>
		<template #actions>
			<v-button v-tooltip.bottom="'Refresh members'" rounded icon secondary :loading="loading" @click="load">
				<v-icon name="refresh" />
			</v-button>
			<v-button
				v-tooltip.bottom="'Invite Users'"
				rounded
				icon
				secondary
				@click="inviteModalActive = true"
			>
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
				This view lists explicit local memberships. Inherited Global Admin access is separate. Full global user filters
				and counts require D14.
			</sidebar-detail>
		</template>
		<users-invite
			v-model="inviteModalActive"
			platform
			:initial-namespace-id="namespaceId"
			:initial-role-id="roleId"
		/>
		<div class="directory">
			<v-notice v-if="!namespaceId" type="warning">Choose a virtual namespace to filter users.</v-notice>
			<v-notice v-if="roleId" type="warning">
				Filtering by a local role requires the D14 server-side directory API. No client-side partial filter is shown.
			</v-notice>
			<template v-else>
				<div class="toolbar">
					<v-input v-model="search" placeholder="Search members" />
					<span>{{ total }} members</span>
				</div>
				<v-notice v-if="error" type="danger">{{ error }}</v-notice>
				<v-table
					v-model:headers="headers"
					:items="members"
					:loading="loading"
					show-resize
					fixed-header
					item-key="user_id"
					@click:row="openUser"
				>
					<template #[`item.name`]="{ item }">
						{{ [item.first_name, item.last_name].filter(Boolean).join(' ') || item.email }}
					</template>
					<template #[`item.role`]="{ item }">{{ item.role?.name ?? 'No local role' }}</template>
				</v-table>
				<div class="pagination">
					<v-button secondary :disabled="offset === 0 || loading" @click="offset = Math.max(0, offset - pageSize)">
						Previous
					</v-button>
					<span>{{ total ? offset + 1 : 0 }}–{{ Math.min(offset + pageSize, total) }} of {{ total }}</span>
					<v-button secondary :disabled="offset + pageSize >= total || loading" @click="offset += pageSize">
						Next
					</v-button>
				</div>
			</template>
		</div>
	</private-view>
</template>

<script setup lang="ts">
import api from '@/api';
import { ensureNamespaceRuntime } from '@/namespaces/live';
import { canManagePlatformResource } from '@/namespaces/capabilities';
import type { HeaderRaw } from '@/components/v-table/types';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import GlobalNavigation from './navigation.vue';
import UsersInvite from '@/views/private/components/users-invite.vue';

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
const namespaceId = computed(() => (typeof route.query.admin_ns === 'string' ? route.query.admin_ns : null));
const roleId = computed(() => (typeof route.query.admin_role === 'string' ? route.query.admin_role : null));

const namespaceName = computed(
	() => runtime.state.choices.find((choice) => choice.namespace.id === namespaceId.value)?.namespace.name
);

const members = ref<Member[]>([]);
const inviteModalActive = ref(false);
const total = ref(0);
const loading = ref(false);
const error = ref<string | null>(null);
const search = ref('');
const offset = ref(0);
const pageSize = 50;

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

const headers = ref<HeaderRaw[]>([
	{ text: 'Name', value: 'name', width: 240 },
	{ text: 'Email', value: 'email', width: 260 },
	{ text: 'Status', value: 'status', width: 140 },
	{ text: 'Local role', value: 'role', width: 200 },
]);

let controller: AbortController | null = null;
let timer: number | null = null;

watch(
	[namespaceId, roleId, offset],
	() => {
		void load();
	},
	{ immediate: true }
);

watch(search, () => {
	offset.value = 0;
	if (timer) window.clearTimeout(timer);
	timer = window.setTimeout(() => void load(), 300);
});

onBeforeUnmount(() => {
	controller?.abort();
	if (timer) window.clearTimeout(timer);
});

async function load() {
	controller?.abort();
	members.value = [];
	total.value = 0;
	error.value = null;
	if (!namespaceId.value || roleId.value) return;
	if (
		!runtime.state.choices.some(
			(choice) => choice.namespace.id === namespaceId.value && choice.namespace.kind === 'virtual'
		)
	)
		return;
	if (!canManagePlatformResource(runtime.state.session?.platform ?? null, 'users')) return;
	const request = new AbortController();
	controller = request;
	loading.value = true;

	try {
		const response = await api.get<{ data: Member[]; meta: { total_count: number } }>(
			`/namespaces/${encodeURIComponent(namespaceId.value)}/members`,
			{
				params: { search: search.value || undefined, limit: pageSize, offset: offset.value },
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

function openUser({ item }: { item: Member }) {
	void router.push(`/global-admin/users/${encodeURIComponent(item.user_id)}`);
}
</script>

<style scoped>
.directory {
	padding: var(--content-padding);
}
.toolbar,
.pagination {
	display: flex;
	gap: 16px;
	align-items: center;
	margin: 16px 0;
}
.toolbar .v-input {
	max-width: 320px;
}
</style>
