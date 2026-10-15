<template>
	<v-dialog v-model="addOpen" @esc="addOpen = false">
		<v-card class="member-dialog">
			<v-card-title>Add existing user</v-card-title>
			<v-card-text>
				<div class="dialog-fields">
					<label>Search an existing account</label>
					<v-input v-model="candidateSearch" placeholder="Name or email" />
					<p v-if="candidateSearch.trim().length < 2" class="hint">Enter at least two characters.</p>
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
				<v-button :loading="saving" :disabled="!canAdd || saving" @click="addMember">Add user</v-button>
			</v-card-actions>
		</v-card>
	</v-dialog>

	<v-dialog v-model="roleOpen" @esc="roleOpen = false">
		<v-card class="member-dialog">
			<v-card-title>Change local role</v-card-title>
			<v-card-text>
				<div class="dialog-fields">
					<p>{{ selection.length === 1 ? 'Selected user' : `${selection.length} selected users` }}</p>
					<v-select v-model="editRoleId" :items="roleOptions" :disabled="rolesLoading || roles.length === 0" />
					<p v-if="rolesError" class="error">{{ rolesError }}</p>
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
				Only this namespace membership will be removed. The shared account and other memberships remain.
				<p v-if="mutationError" class="error">{{ mutationError }}</p>
			</v-card-text>
			<v-card-actions>
				<v-button secondary @click="removeOpen = false">{{ t('cancel') }}</v-button>
				<v-button kind="danger" :loading="saving" :disabled="saving" @click="removeMember">Remove access</v-button>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ensureNamespaceRuntime } from '@/namespaces/live';
import {
	addNamespaceMember,
	changeNamespaceMemberRole,
	listNamespaceRoles,
	lookupExistingUsers,
	removeNamespaceMember,
	type MemberCandidate,
	type NamespaceRole,
} from '../namespace-members';

const props = defineProps<{ selection: string[]; selectedRoleId?: string | null }>();
const emit = defineEmits<{ (event: 'refresh'): void; (event: 'clear-selection'): void }>();
const { t } = useI18n();
const runtime = ensureNamespaceRuntime();
const namespaceId = computed(() => runtime.state.active?.namespaceId ?? null);
const namespaceName = computed(() => runtime.state.active?.namespace.name ?? 'this namespace');
const roles = ref<NamespaceRole[]>([]);
const rolesLoading = ref(false);
const rolesError = ref<string | null>(null);
const candidates = ref<MemberCandidate[]>([]);
const candidatesLoading = ref(false);
const candidatesError = ref<string | null>(null);
const candidateSearch = ref('');
const candidateId = ref<string | null>(null);
const addRoleId = ref<string | null>(null);
const editRoleId = ref<string | null>(null);
const mutationError = ref<string | null>(null);
const saving = ref(false);
const addOpen = ref(false);
const roleOpen = ref(false);
const removeOpen = ref(false);
const roleOptions = computed(() => roles.value.map((role) => ({ text: role.name, value: role.id })));

const candidateOptions = computed(() =>
	candidates.value.map((user) => ({
		text: `${[user.first_name, user.last_name].filter(Boolean).join(' ') || user.email || 'Unnamed user'}${
			user.email ? ` · ${user.email}` : ''
		}${user.status !== 'active' ? ` (${user.status})` : ''}`,
		value: user.user_id,
		disabled: user.status !== 'active',
	}))
);

const canAdd = computed(
	() =>
		candidates.value.some((user) => user.user_id === candidateId.value && user.status === 'active') && !!addRoleId.value
);

let rolesController: AbortController | null = null;
let candidateController: AbortController | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let unregisterLifecycle: (() => void) | null = null;

watch(
	namespaceId,
	() => {
		close();
		roles.value = [];
		candidates.value = [];
		rolesController?.abort();
		candidateController?.abort();
		if (namespaceId.value) void loadRoles();
	},
	{ immediate: true }
);

watch(candidateSearch, () => {
	candidateId.value = null;
	candidates.value = [];
	candidateController?.abort();
	if (timer) clearTimeout(timer);
	if (candidateSearch.value.trim().length >= 2) timer = setTimeout(() => void loadCandidates(), 300);
});

onMounted(() => {
	unregisterLifecycle = runtime.lifecycle.register({
		id: 'namespace-member-dialogs',
		dirty: () =>
			(addOpen.value && !!(candidateId.value || addRoleId.value)) ||
			(roleOpen.value && editRoleId.value !== (props.selectedRoleId ?? null)),
		pause: () => {
			rolesController?.abort();
			candidateController?.abort();
		},
		reset: () => {
			close();
			candidates.value = [];
			candidateSearch.value = '';
			candidateId.value = null;
			addRoleId.value = null;
			editRoleId.value = null;
		},
	});
});

onBeforeUnmount(() => {
	unregisterLifecycle?.();
	rolesController?.abort();
	candidateController?.abort();
	if (timer) clearTimeout(timer);
});

function close() {
	addOpen.value = roleOpen.value = removeOpen.value = false;
}

function openAdd() {
	candidateSearch.value = '';
	candidateId.value = null;
	addRoleId.value = null;
	mutationError.value = null;
	addOpen.value = true;
}

function openRole() {
	if (!props.selection.length) return;
	editRoleId.value = props.selection.length === 1 ? props.selectedRoleId ?? null : null;
	mutationError.value = null;
	roleOpen.value = true;
}

function openRemove() {
	if (!props.selection.length) return;
	mutationError.value = null;
	removeOpen.value = true;
}

defineExpose({ openAdd, openRole, openRemove });

async function loadRoles() {
	rolesController?.abort();
	const controller = new AbortController();
	rolesController = controller;
	rolesLoading.value = true;
	rolesError.value = null;

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

async function finish(userIds: string[]) {
	close();
	emit('clear-selection');
	emit('refresh');
	runtime.registry.invalidate({ reason: 'membership', namespaceId: namespaceId.value ?? undefined });
	if (userIds.includes(runtime.state.session?.user.id ?? '')) await runtime.refreshChoices();
}

async function addMember() {
	if (!canAdd.value || !candidateId.value || !addRoleId.value) return;
	saving.value = true;
	mutationError.value = null;

	try {
		await addNamespaceMember(candidateId.value, addRoleId.value);
		await finish([candidateId.value]);
	} catch {
		mutationError.value = 'Could not confirm the assignment. Refresh before trying again.';
	} finally {
		saving.value = false;
	}
}

async function changeRole() {
	if (!props.selection.length || !editRoleId.value) return;
	const ids = [...props.selection];
	saving.value = true;
	mutationError.value = null;

	try {
		for (const id of ids) await changeNamespaceMemberRole(id, editRoleId.value);
		await finish(ids);
	} catch {
		mutationError.value = 'Could not confirm every role change. Refresh before trying again.';
	} finally {
		saving.value = false;
	}
}

async function removeMember() {
	if (!props.selection.length) return;
	const ids = [...props.selection];
	saving.value = true;
	mutationError.value = null;

	try {
		for (const id of ids) await removeNamespaceMember(id);
		await finish(ids);
	} catch {
		mutationError.value = 'Could not confirm every removal. Refresh before trying again.';
	} finally {
		saving.value = false;
	}
}
</script>

<style scoped>
.member-dialog {
	min-width: min(540px, 90vw);
}
.dialog-fields {
	display: grid;
	gap: 12px;
	width: min(440px, calc(90vw - 64px));
}
.hint {
	color: var(--foreground-subdued);
}
.error {
	color: var(--danger);
}
</style>
