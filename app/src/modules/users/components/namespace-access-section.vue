<template>
	<section class="namespace-access">
		<div class="heading">
			<h2>Namespace Access</h2>
			<v-button v-tooltip.bottom="t('add_existing')" rounded icon @click="openAdd">
				<v-icon name="playlist_add" />
			</v-button>
		</div>
		<v-notice v-if="access.inherited_global_admin" type="info">
			Global Admin access is inherited from the main role. The rows below are explicit local assignments.
		</v-notice>
		<v-table v-model:headers="headers" :items="access.memberships" item-key="namespace_id" show-resize>
			<template #[`item.namespace_name`]="{ item }">{{ item.namespace_name }}</template>
			<template #[`item.role_name`]="{ item }">{{ item.role_name || 'No local role' }}</template>
			<template #item-append="{ item }">
				<v-menu placement="left-start" show-arrow>
					<template #activator="{ toggle }"><v-icon name="more_vert" clickable @click="toggle" /></template>
					<v-list>
						<v-list-item clickable @click="openEdit(item)">
							<v-list-item-icon><v-icon name="edit" /></v-list-item-icon>
							<v-list-item-content>Change local role</v-list-item-content>
						</v-list-item>
						<v-list-item clickable @click="openRemove(item)">
							<v-list-item-icon><v-icon name="link_off" /></v-list-item-icon>
							<v-list-item-content>Remove access</v-list-item-content>
						</v-list-item>
					</v-list>
				</v-menu>
			</template>
		</v-table>
		<v-notice v-if="access.memberships.length === 0">No explicit namespace assignments.</v-notice>

		<v-dialog v-model="editorOpen" @esc="editorOpen = false">
			<v-card class="access-dialog">
				<v-card-title>{{ editing ? 'Change local role' : t('add_existing') }}</v-card-title>
				<v-card-text>
					<label>Virtual Namespace</label>
					<v-select v-model="selectedNamespace" :items="namespaceOptions" :disabled="editing" />
					<label>Role</label>
					<v-select v-model="selectedRole" :items="roleOptions" :disabled="rolesLoading || !selectedNamespace" />
					<v-notice v-if="rolesError" type="danger">{{ rolesError }}</v-notice>
					<v-notice v-if="mutationError" type="danger">{{ mutationError }}</v-notice>
				</v-card-text>
				<v-card-actions>
					<v-button secondary @click="editorOpen = false">{{ t('cancel') }}</v-button>
					<v-button
						:loading="saving"
						:disabled="!selectedNamespace || !selectedRole || rolesLoading || saving"
						@click="save"
					>
						{{ t('save') }}
					</v-button>
				</v-card-actions>
			</v-card>
		</v-dialog>

		<v-dialog v-model="removeOpen" @esc="removeOpen = false">
			<v-card>
				<v-card-title>Remove access to {{ removing?.namespace_name }}?</v-card-title>
				<v-card-text>
					Only this local assignment will be removed. The user account and other assignments remain.
					<v-notice v-if="mutationError" type="danger">{{ mutationError }}</v-notice>
				</v-card-text>
				<v-card-actions>
					<v-button secondary @click="removeOpen = false">{{ t('cancel') }}</v-button>
					<v-button kind="danger" :loading="saving" :disabled="saving" @click="remove">Remove access</v-button>
				</v-card-actions>
			</v-card>
		</v-dialog>
	</section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import api from '@/api';
import { ensureNamespaceRuntime } from '@/namespaces/live';
import type { HeaderRaw } from '@/components/v-table/types';
import type { ProfileAccess } from '../profile-access';

type Membership = ProfileAccess['memberships'][number];
const props = defineProps<{ userId: string; access: ProfileAccess }>();
const emit = defineEmits<{ (event: 'refresh'): void }>();
const { t } = useI18n();
const runtime = ensureNamespaceRuntime();

const headers = ref<HeaderRaw[]>([
	{ text: 'Virtual Namespace', value: 'namespace_name', width: 260 },
	{ text: 'Role', value: 'role_name', width: 220 },
]);

const editorOpen = ref(false);
const removeOpen = ref(false);
const editing = ref(false);
const removing = ref<Membership | null>(null);
const selectedNamespace = ref<string | null>(null);
const selectedRole = ref<string | null>(null);
const initialRole = ref<string | null>(null);
const roles = ref<{ id: string; name: string }[]>([]);
const rolesLoading = ref(false);
const rolesError = ref<string | null>(null);
const mutationError = ref<string | null>(null);
const saving = ref(false);
let roleController: AbortController | null = null;

const namespaceOptions = computed(() =>
	runtime.state.choices
		.filter((choice) => choice.namespace.kind === 'virtual' && choice.namespace.readiness === 'ready')
		.filter(
			(choice) => editing.value || !props.access.memberships.some((row) => row.namespace_id === choice.namespace.id)
		)
		.map((choice) => ({ text: choice.namespace.name, value: choice.namespace.id }))
);

const roleOptions = computed(() => roles.value.map((role) => ({ text: role.name, value: role.id })));

watch(selectedNamespace, (id) => {
	roleController?.abort();
	selectedRole.value = null;
	roles.value = [];
	rolesError.value = null;
	if (id) void loadRoles(id, initialRole.value);
	initialRole.value = null;
});

onBeforeUnmount(() => roleController?.abort());

function openAdd() {
	editing.value = false;
	initialRole.value = null;
	selectedNamespace.value = null;
	selectedRole.value = null;
	mutationError.value = null;
	editorOpen.value = true;
}

function openEdit(row: Membership) {
	editing.value = true;
	const sameNamespace = selectedNamespace.value === row.namespace_id;
	initialRole.value = row.role_id;
	selectedNamespace.value = row.namespace_id;
	mutationError.value = null;
	editorOpen.value = true;

	if (sameNamespace) {
		if (roles.value.length) selectedRole.value = row.role_id;
		else void loadRoles(row.namespace_id, row.role_id);
	}
}

function openRemove(row: Membership) {
	removing.value = row;
	mutationError.value = null;
	removeOpen.value = true;
}

async function loadRoles(namespaceId: string, initialRole?: string | null) {
	roleController?.abort();
	const controller = new AbortController();
	roleController = controller;
	rolesLoading.value = true;

	try {
		const response = await api.get<{ data: { id: string; name: string }[] }>(
			`/namespaces/${encodeURIComponent(namespaceId)}/roles`,
			{ signal: controller.signal }
		);

		if (controller.signal.aborted || selectedNamespace.value !== namespaceId) return;
		roles.value = response.data.data;
		if (initialRole && roles.value.some((role) => role.id === initialRole)) selectedRole.value = initialRole;
	} catch (error: any) {
		if (!controller.signal.aborted)
			rolesError.value = error.response?.data?.errors?.[0]?.message ?? 'Could not load roles.';
	} finally {
		if (!controller.signal.aborted) rolesLoading.value = false;
	}
}

async function save() {
	const namespaceId = selectedNamespace.value;
	const roleId = selectedRole.value;
	if (!namespaceId || !roleId || !roles.value.some((role) => role.id === roleId)) return;
	mutationError.value = null;
	saving.value = true;

	try {
		const path = `/namespaces/${encodeURIComponent(namespaceId)}/members`;
		if (editing.value) await api.patch(`${path}/${encodeURIComponent(props.userId)}`, { role_id: roleId });
		else await api.post(path, { user_id: props.userId, role_id: roleId });
		editorOpen.value = false;
		emit('refresh');
	} catch (error: any) {
		mutationError.value = error.response?.data?.errors?.[0]?.message ?? 'Could not save namespace access.';
	} finally {
		saving.value = false;
	}
}

async function remove() {
	if (!removing.value) return;
	mutationError.value = null;
	saving.value = true;

	try {
		await api.delete(
			`/namespaces/${encodeURIComponent(removing.value.namespace_id)}/members/${encodeURIComponent(props.userId)}`
		);

		removeOpen.value = false;
		emit('refresh');
	} catch (error: any) {
		mutationError.value = error.response?.data?.errors?.[0]?.message ?? 'Could not remove namespace access.';
	} finally {
		saving.value = false;
	}
}
</script>

<style lang="scss" scoped>
.namespace-access {
	max-width: calc(var(--form-column-max-width) * 2 + var(--form-horizontal-gap));
	margin-top: var(--form-vertical-gap);
	.heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 12px;
	}
	.heading h2 {
		font-size: 16px;
		font-weight: 600;
	}
	.v-notice {
		margin-bottom: 12px;
	}
}
.access-dialog {
	min-width: 440px;
}
.access-dialog label {
	display: block;
	margin: 12px 0 6px;
}
</style>
