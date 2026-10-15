<template>
	<private-view :title="t('user_directory')">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="people_alt" />
			</v-button>
		</template>
		<template #navigation>
			<v-list nav>
				<v-list-item to="/users" exact>
					<v-list-item-icon><v-icon name="folder_shared" /></v-list-item-icon>
					<v-list-item-content>{{ t('all_users') }}</v-list-item-content>
				</v-list-item>
				<v-divider v-if="roles.length || rolesLoading" />
				<v-list-item v-for="localRole in roles" :key="localRole.id" :to="`/users/roles/${localRole.id}`">
					<v-list-item-icon>
						<v-icon :name="localRole.admin_access ? 'verified_user' : 'people_alt'" />
					</v-list-item-icon>
					<v-list-item-content>{{ localRole.name }}</v-list-item-content>
				</v-list-item>
				<v-list-item v-if="rolesError">
					<v-list-item-content>{{ rolesError }}</v-list-item-content>
				</v-list-item>
			</v-list>
		</template>
		<template #actions:prepend>
			<span v-if="total" class="item-count">{{ pageStart }}–{{ pageEnd }} of {{ total }} items</span>
		</template>
		<template #actions>
			<namespace-member-search v-model="search" v-model:status="statusFilter" />
			<v-button
				v-if="selection.length"
				v-tooltip.bottom="'Change local role'"
				rounded
				icon
				secondary
				@click="openRoleEditor"
			>
				<v-icon name="edit" />
			</v-button>
			<v-button
				v-if="selection.length"
				v-tooltip.bottom="'Remove from namespace'"
				rounded
				icon
				secondary
				@click="openRemove"
			>
				<v-icon name="person_remove" />
			</v-button>
			<v-button v-tooltip.bottom="'Add existing user'" rounded icon @click="openAdd">
				<v-icon name="add" />
			</v-button>
		</template>
		<template #sidebar>
			<sidebar-detail icon="info" :title="t('information')" close>
				{{ total }} users in {{ namespaceName }}. Select a user to change their local role or remove their access.
			</sidebar-detail>
			<sidebar-detail icon="layers" :title="t('layout_options')">
				<div class="sidebar-fields">
					<label>{{ t('layout') }}</label>
					<v-select :model-value="'cards'" :items="[{ text: 'Cards', value: 'cards' }]" disabled />
					<label>{{ t('card_size') }}</label>
					<v-select v-model="cardSize" :items="[2, 3, 4, 5]" />
				</div>
			</sidebar-detail>
			<refresh-sidebar-detail v-model="refreshInterval" @refresh="loadMembers" />
		</template>

		<div class="member-directory">
			<v-notice v-if="error" type="danger">
				{{ error }}
				<v-button secondary @click="loadMembers">Retry</v-button>
			</v-notice>
			<div v-if="!error && loading && members.length === 0" class="state">Loading users…</div>
			<v-info
				v-else-if="!loading && !error && members.length === 0"
				icon="people_alt"
				center
				:title="t('user_count', 0)"
			>
				{{
					search || role || statusFilter ? 'No users match these filters.' : 'This namespace has no explicit members.'
				}}
				<template v-if="!search && !role && !statusFilter" #append>
					<v-button @click="openAdd">Add existing user</v-button>
				</template>
			</v-info>
			<template v-else-if="!error">
				<cards-header
					:selection="selectedMembers"
					:size="cardSize"
					:sort="sort"
					:fields="sortFields"
					@update:selection="selection = []"
					@update:size="cardSize = $event"
					@update:sort="sort = $event"
					@select-all="selectVisible"
				/>
				<div class="member-grid" :style="{ '--size': `${cardSize * 40}px` }">
					<member-card
						v-for="member in members"
						:key="member.user_id"
						:model-value="selection"
						:item="member"
						item-key="user_id"
						icon="account_circle"
						select-mode
						@update:model-value="selection = $event as string[]"
					>
						<template #title>{{ displayName(member) }}</template>
						<template #subtitle>{{ member.email }}</template>
					</member-card>
				</div>
				<div class="directory-footer">
					<v-pagination
						v-if="total > pageSize"
						:model-value="page"
						:length="Math.ceil(total / pageSize)"
						:total-visible="7"
						show-first-last
						@update:model-value="page = $event"
					/>
					<div v-if="total >= 25" class="per-page">
						<span>{{ t('per_page') }}</span>
						<v-select
							:model-value="String(pageSize)"
							:items="['25', '50', '100', '250']"
							inline
							@update:model-value="pageSize = Number($event)"
						/>
					</div>
				</div>
			</template>
		</div>

		<v-dialog v-model="addOpen" @esc="addOpen = false">
			<v-card class="member-dialog">
				<v-card-title>Add existing user</v-card-title>
				<v-card-text>
					<div class="dialog-fields">
						<label>Search an existing account</label>
						<v-input v-model="candidateSearch" placeholder="Name or email" />
						<p v-if="candidateSearch.trim().length < 2" class="hint">
							Enter at least two characters. The full user directory is not shown here.
						</p>
						<p v-else-if="candidatesLoading" class="hint">Searching…</p>
						<p v-else-if="candidatesError" class="error">{{ candidatesError }}</p>
						<v-select
							v-if="candidateSearch.trim().length >= 2 && candidates.length"
							v-model="candidateId"
							:items="candidateOptions"
							placeholder="Select user"
						/>
						<p v-else-if="candidateSearch.trim().length >= 2 && !candidatesLoading && !candidatesError" class="hint">
							No matching users.
						</p>
						<label>Role in {{ namespaceName }}</label>
						<v-select
							v-model="addRoleId"
							:items="roleOptions"
							:disabled="rolesLoading || roles.length === 0"
							placeholder="Select local role"
						/>
						<p v-if="rolesError" class="error">{{ rolesError }}</p>
						<p v-if="mutationError" class="error">{{ mutationError }}</p>
					</div>
				</v-card-text>
				<v-card-actions>
					<v-button secondary @click="addOpen = false">{{ t('cancel') }}</v-button>
					<v-button :loading="saving" :disabled="!canAdd || saving" @click="addMember">Add User</v-button>
				</v-card-actions>
			</v-card>
		</v-dialog>

		<v-dialog v-model="roleOpen" @esc="roleOpen = false">
			<v-card class="member-dialog">
				<v-card-title>Change local role</v-card-title>
				<v-card-text>
					<div class="dialog-fields">
						<p>
							{{
								selection.length === 1 && selectedMember
									? displayName(selectedMember)
									: `${selection.length} selected users`
							}}
						</p>
						<v-select v-model="editRoleId" :items="roleOptions" :disabled="rolesLoading || roles.length === 0" />
						<p v-if="mutationError" class="error">{{ mutationError }}</p>
					</div>
				</v-card-text>
				<v-card-actions>
					<v-button secondary @click="roleOpen = false">{{ t('cancel') }}</v-button>
					<v-button :loading="saving" :disabled="!editRoleId || saving" @click="changeRole">Save</v-button>
				</v-card-actions>
			</v-card>
		</v-dialog>

		<v-dialog v-model="removeOpen" @esc="removeOpen = false">
			<v-card class="member-dialog">
				<v-card-title>Remove from {{ namespaceName }}?</v-card-title>
				<v-card-text>
					Only this namespace membership will be removed. The shared account and other namespace memberships remain.
					<p v-if="mutationError" class="error">{{ mutationError }}</p>
				</v-card-text>
				<v-card-actions>
					<v-button secondary @click="removeOpen = false">{{ t('cancel') }}</v-button>
					<v-button kind="danger" :loading="saving" :disabled="saving" @click="removeMember">Remove access</v-button>
				</v-card-actions>
			</v-card>
		</v-dialog>
	</private-view>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Field } from '@wbce-d9/types';
import { ensureNamespaceRuntime } from '@/namespaces/live';
import MemberCard from '@/layouts/cards/components/card.vue';
import CardsHeader from '@/layouts/cards/components/header.vue';
import RefreshSidebarDetail from '@/views/private/components/refresh-sidebar-detail.vue';
import NamespaceMemberSearch from '../components/namespace-member-search.vue';
import {
	addNamespaceMember,
	changeNamespaceMemberRole,
	listNamespaceMembers,
	listNamespaceRoles,
	lookupExistingUsers,
	removeNamespaceMember,
	type MemberCandidate,
	type NamespaceMember,
	type NamespaceRole,
} from '../namespace-members';

const props = defineProps<{ role?: string | null }>();
const { t } = useI18n();
const runtime = ensureNamespaceRuntime();
const namespaceId = computed(() => runtime.state.active?.namespaceId ?? null);
const namespaceName = computed(() => runtime.state.active?.namespace.name ?? 'this namespace');
const members = ref<NamespaceMember[]>([]);
const roles = ref<NamespaceRole[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(25);
const cardSize = ref(4);
const sort = ref(['email']);
const statusFilter = ref<string | null>(null);
const refreshInterval = ref<number | null>(null);
const search = ref('');
const loading = ref(false);
const error = ref<string | null>(null);
const rolesLoading = ref(false);
const rolesError = ref<string | null>(null);
const selection = ref<string[]>([]);
const selectedMember = computed(() => members.value.find((member) => member.user_id === selection.value[0]) ?? null);
const selectedMembers = computed(() => members.value.filter((member) => selection.value.includes(member.user_id)));
const pageStart = computed(() => (total.value ? (page.value - 1) * pageSize.value + 1 : 0));
const pageEnd = computed(() => Math.min(page.value * pageSize.value, total.value));

const sortFields = [
	{ field: 'email', name: 'Email', type: 'string' },
	{ field: 'first_name', name: 'First Name', type: 'string' },
	{ field: 'last_name', name: 'Last Name', type: 'string' },
	{ field: 'status', name: 'Status', type: 'string' },
	{ field: 'role', name: 'Role', type: 'string' },
] as Field[];

const addOpen = ref(false);
const roleOpen = ref(false);
const removeOpen = ref(false);
const candidateSearch = ref('');
const candidateId = ref<string | null>(null);
const candidates = ref<MemberCandidate[]>([]);
const candidatesLoading = ref(false);
const candidatesError = ref<string | null>(null);
const addRoleId = ref<string | null>(null);
const editRoleId = ref<string | null>(null);
const originalEditRoleId = ref<string | null>(null);
const saving = ref(false);
const mutationError = ref<string | null>(null);
const roleOptions = computed(() => roles.value.map((role) => ({ text: role.name, value: role.id })));

const candidateOptions = computed(() =>
	candidates.value.map((user) => ({
		text: `${displayName(user)}${user.email ? ` · ${user.email}` : ''}${
			user.status !== 'active' ? ` (${user.status})` : ''
		}`,
		value: user.user_id,
		disabled: user.status !== 'active',
	}))
);

const selectedCandidate = computed(() => candidates.value.find((user) => user.user_id === candidateId.value));
const canAdd = computed(() => selectedCandidate.value?.status === 'active' && !!addRoleId.value);

let listController: AbortController | null = null;
let rolesController: AbortController | null = null;
let candidateController: AbortController | null = null;
let searchTimer: number | null = null;
let candidateTimer: number | null = null;
let unregisterLifecycle: (() => void) | null = null;

watch([namespaceId, page, pageSize, statusFilter, sort, () => props.role], () => void loadMembers(), {
	immediate: true,
});

watch([pageSize, statusFilter, sort, () => props.role], () => {
	page.value = 1;
});

watch(
	namespaceId,
	() => {
		selection.value = [];
		search.value = '';
		statusFilter.value = null;
		sort.value = ['email'];
		refreshInterval.value = null;
		page.value = 1;
		closeDialogs();
		void loadRoles();
	},
	{ immediate: true }
);

watch(search, () => {
	page.value = 1;
	if (searchTimer) clearTimeout(searchTimer);
	searchTimer = window.setTimeout(() => void loadMembers(), 300);
});

watch(candidateSearch, () => {
	candidateId.value = null;
	candidates.value = [];
	candidateController?.abort();
	if (candidateTimer) clearTimeout(candidateTimer);
	if (candidateSearch.value.trim().length >= 2) candidateTimer = window.setTimeout(() => void loadCandidates(), 300);
});

onMounted(() => {
	unregisterLifecycle = runtime.lifecycle.register({
		id: 'namespace-member-directory',
		dirty: () =>
			(addOpen.value && !!(candidateId.value || addRoleId.value)) ||
			(roleOpen.value && editRoleId.value !== originalEditRoleId.value),
		pause: () => {
			listController?.abort();
			rolesController?.abort();
			candidateController?.abort();
		},
		reset: () => {
			closeDialogs();
			selection.value = [];
			members.value = [];
			candidates.value = [];
			search.value = '';
			candidateSearch.value = '';
			candidateId.value = null;
			addRoleId.value = null;
			editRoleId.value = null;
			originalEditRoleId.value = null;
			page.value = 1;
			statusFilter.value = null;
			sort.value = ['email'];
			refreshInterval.value = null;
			total.value = 0;
		},
	});
});

onBeforeUnmount(() => {
	unregisterLifecycle?.();
	listController?.abort();
	rolesController?.abort();
	candidateController?.abort();
	if (searchTimer) clearTimeout(searchTimer);
	if (candidateTimer) clearTimeout(candidateTimer);
});

function displayName(user: Pick<NamespaceMember, 'first_name' | 'last_name' | 'email'>) {
	return [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email || 'Unnamed user';
}

function selectVisible() {
	selection.value = members.value.map((member) => member.user_id);
}

function closeDialogs() {
	addOpen.value = false;
	roleOpen.value = false;
	removeOpen.value = false;
}

function openAdd() {
	selection.value = [];
	candidateSearch.value = '';
	candidateId.value = null;
	addRoleId.value = null;
	mutationError.value = null;
	addOpen.value = true;
}

function openRoleEditor() {
	if (!selection.value.length) return;
	editRoleId.value = selection.value.length === 1 ? selectedMember.value?.role?.id ?? null : null;
	originalEditRoleId.value = editRoleId.value;
	mutationError.value = null;
	roleOpen.value = true;
}

function openRemove() {
	mutationError.value = null;
	removeOpen.value = true;
}

async function loadMembers() {
	listController?.abort();
	const controller = new AbortController();
	listController = controller;
	members.value = [];
	selection.value = [];
	error.value = null;

	if (!namespaceId.value) {
		loading.value = false;
		return;
	}

	loading.value = true;

	try {
		const query = search.value.trim();
		const needsLocalFiltering = !!props.role || !!statusFilter.value || sort.value[0] !== 'email';

		if (needsLocalFiltering) {
			// The membership endpoint has no role/status/sort parameters. Enumerate only this
			// namespace's authorized members so filtering and pagination stay truthful.
			const all: NamespaceMember[] = [];
			const batchSize = 250;
			let offset = 0;
			let count = 0;

			do {
				const result = await listNamespaceMembers(query, batchSize, offset, controller.signal);
				if (controller.signal.aborted) return;
				all.push(...result.data);
				count = result.meta.total_count;
				offset += result.data.length;
				if (!result.data.length) break;
			} while (offset < count);

			const filtered = all.filter(
				(member) =>
					(!props.role || member.role?.id === props.role) &&
					(!statusFilter.value || member.status === statusFilter.value)
			);

			const key = sort.value[0]?.replace(/^-/, '') ?? 'email';
			const direction = sort.value[0]?.startsWith('-') ? -1 : 1;

			filtered.sort(
				(a, b) =>
					String(key === 'role' ? a.role?.name ?? '' : a[key as keyof NamespaceMember] ?? '').localeCompare(
						String(key === 'role' ? b.role?.name ?? '' : b[key as keyof NamespaceMember] ?? '')
					) * direction
			);

			if (controller.signal.aborted) return;
			total.value = filtered.length;
			members.value = filtered.slice((page.value - 1) * pageSize.value, page.value * pageSize.value);
		} else {
			const result = await listNamespaceMembers(
				query,
				pageSize.value,
				(page.value - 1) * pageSize.value,
				controller.signal
			);

			if (controller.signal.aborted) return;
			members.value = result.data;
			total.value = result.meta.total_count;
		}
	} catch (cause) {
		if (!controller.signal.aborted) error.value = 'Could not load namespace members.';
	} finally {
		if (!controller.signal.aborted) loading.value = false;
	}
}

async function loadRoles() {
	rolesController?.abort();
	const controller = new AbortController();
	rolesController = controller;
	roles.value = [];
	rolesError.value = null;
	if (!namespaceId.value) return;
	rolesLoading.value = true;

	try {
		const result = await listNamespaceRoles(controller.signal);
		if (!controller.signal.aborted) roles.value = result.data;
	} catch {
		if (!controller.signal.aborted) rolesError.value = 'Could not load local roles.';
	} finally {
		if (!controller.signal.aborted) rolesLoading.value = false;
	}
}

async function loadCandidates() {
	candidateController?.abort();
	const controller = new AbortController();
	candidateController = controller;
	candidatesLoading.value = true;
	candidatesError.value = null;

	try {
		const result = await lookupExistingUsers(candidateSearch.value.trim(), controller.signal);
		if (!controller.signal.aborted) candidates.value = result.data;
	} catch {
		if (!controller.signal.aborted) candidatesError.value = 'Could not search existing users.';
	} finally {
		if (!controller.signal.aborted) candidatesLoading.value = false;
	}
}

async function finishMutation(affectedUserIds: string[]) {
	closeDialogs();
	selection.value = [];
	await loadMembers();
	runtime.registry.invalidate({ reason: 'membership', namespaceId: namespaceId.value ?? undefined });
	if (affectedUserIds.includes(runtime.state.session?.user.id ?? '')) await runtime.refreshChoices();
}

async function addMember() {
	if (!canAdd.value || !candidateId.value || !addRoleId.value) return;
	saving.value = true;
	mutationError.value = null;

	try {
		await addNamespaceMember(candidateId.value, addRoleId.value);
		await finishMutation([candidateId.value]);
	} catch {
		mutationError.value = 'Could not confirm the assignment. Refresh the directory before trying again.';
	} finally {
		saving.value = false;
	}
}

async function changeRole() {
	if (!selection.value.length || !editRoleId.value) return;
	const userIds = [...selection.value];
	saving.value = true;
	mutationError.value = null;

	try {
		for (const userId of userIds) await changeNamespaceMemberRole(userId, editRoleId.value);
		await finishMutation(userIds);
	} catch {
		mutationError.value =
			'Could not confirm every role change. Refresh before trying again; the last admin cannot be demoted.';
	} finally {
		saving.value = false;
	}
}

async function removeMember() {
	if (!selection.value.length) return;
	const userIds = [...selection.value];
	saving.value = true;
	mutationError.value = null;

	try {
		for (const userId of userIds) await removeNamespaceMember(userId);
		await finishMutation(userIds);
	} catch {
		mutationError.value =
			'Could not confirm every removal. Refresh before trying again; the last admin cannot be removed.';
	} finally {
		saving.value = false;
	}
}
</script>

<style scoped lang="scss">
.header-icon {
	--v-button-color-disabled: var(--foreground-normal);
}
.item-count {
	margin: 0 8px;
	color: var(--foreground-subdued);
	white-space: nowrap;
}
.member-directory {
	padding: var(--content-padding);
	padding-top: 0;
}
.member-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(var(--size), 1fr));
	gap: 32px 24px;
}
.directory-footer {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding-top: 40px;
}
.per-page {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	gap: 4px;
	width: 240px;
	color: var(--foreground-subdued);
}
.sidebar-fields {
	display: grid;
	gap: 12px;
}
.state,
.hint {
	color: var(--foreground-subdued);
}
.member-dialog {
	min-width: min(540px, 90vw);
}
.dialog-fields {
	display: grid;
	gap: 12px;
	width: min(440px, calc(90vw - 64px));
}
.error {
	color: var(--danger);
}
</style>
