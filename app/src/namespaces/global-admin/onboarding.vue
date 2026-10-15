<template>
	<private-view :title="mode === 'invite' ? 'Invite User' : 'Create User'">
		<template #headline>
			<v-breadcrumb :items="[{ name: 'Global Administration', to: '/global-admin/users' }]" />
		</template>
		<template #navigation><global-navigation /></template>
		<template #sidebar>
			<sidebar-detail icon="info" title="Backend dependency" close>
				D14 must provide a complete per-namespace role list and a coherent account or invitation operation with initial
				memberships. This form cannot submit yet.
			</sidebar-detail>
		</template>
		<div class="form">
			<v-notice type="warning">Submission is unavailable until D14. No account or invitation will be created.</v-notice>
			<div class="field">
				<label>Email</label>
				<v-input v-model="email" type="email" />
			</div>
			<template v-if="mode === 'create'">
				<div class="field">
					<label>First name</label>
					<v-input v-model="firstName" />
				</div>
				<div class="field">
					<label>Last name</label>
					<v-input v-model="lastName" />
				</div>
			</template>
			<h2>Namespace access</h2>
			<p>
				Each account may have more than one namespace assignment. Roles are read from the selected namespace where the
				current API permits it.
			</p>
			<div v-for="(row, index) in rows" :key="row.key" class="assignment">
				<div class="field">
					<label>Virtual namespace</label>
					<v-select
						:model-value="row.namespaceId"
						:items="namespaceItems"
						@update:model-value="selectNamespace(row, $event)"
					/>
				</div>
				<div class="field">
					<label>Local role</label>
					<v-select
						v-model="row.roleId"
						:items="row.roles"
						:disabled="!row.namespaceId || row.loading || row.roles.length === 0"
					/>
				</div>
				<v-button secondary icon :disabled="rows.length === 1" @click="removeRow(index)">
					<v-icon name="close" />
				</v-button>
				<p v-if="row.error" class="row-note">{{ row.error }}</p>
			</div>
			<v-notice v-if="duplicate" type="danger">Select each namespace only once.</v-notice>
			<v-button secondary @click="addRow">Add namespace</v-button>
			<div class="actions">
				<v-button to="/global-admin/users" secondary>Cancel</v-button>
				<v-button disabled>{{ mode === 'invite' ? 'Invite User' : 'Create User' }}</v-button>
			</div>
		</div>
	</private-view>
</template>

<script setup lang="ts">
import api from '@/api';
import { ensureNamespaceRuntime } from '@/namespaces/live';
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import GlobalNavigation from './navigation.vue';

type RoleOption = { text: string; value: string };
type Row = {
	key: number;
	namespaceId: string | null;
	roleId: string | null;
	roles: RoleOption[];
	loading: boolean;
	error: string | null;
	controller: AbortController | null;
};
const runtime = ensureNamespaceRuntime();
const route = useRoute();
const mode = computed(() => (route.query.mode === 'invite' ? 'invite' : 'create'));
const email = ref('');
const firstName = ref('');
const lastName = ref('');
let nextKey = 0;
const rows = ref<Row[]>([newRow()]);

const namespaceItems = computed(() =>
	runtime.state.choices
		.filter((choice) => choice.namespace.kind === 'virtual' && choice.namespace.readiness === 'ready')
		.map((choice) => ({ text: choice.namespace.name, value: choice.namespace.id }))
);

const duplicate = computed(() => {
	const ids = rows.value.map((row) => row.namespaceId).filter(Boolean);
	return new Set(ids).size !== ids.length;
});

watch(
	() => route.query.admin_ns,
	(id) => {
		if (typeof id === 'string' && namespaceItems.value.some((item) => item.value === id) && !rows.value[0]?.namespaceId)
			void selectNamespace(rows.value[0]!, id);
	},
	{ immediate: true }
);

onBeforeUnmount(() => rows.value.forEach((row) => row.controller?.abort()));

function newRow(): Row {
	return reactive({
		key: ++nextKey,
		namespaceId: null,
		roleId: null,
		roles: [],
		loading: false,
		error: null,
		controller: null,
	});
}

function addRow() {
	rows.value.push(newRow());
}

function removeRow(index: number) {
	rows.value[index]?.controller?.abort();
	rows.value.splice(index, 1);
}

async function selectNamespace(row: Row, value: string | null) {
	row.controller?.abort();
	row.roleId = null;
	row.roles = [];
	row.error = null;

	if (value && rows.value.some((other) => other !== row && other.namespaceId === value)) {
		row.namespaceId = null;
		row.error = 'This namespace is already selected.';
		return;
	}

	row.namespaceId = value;
	if (!value) return;

	if (runtime.state.active?.namespaceId !== value) {
		row.error = 'The backend cannot list every role in another namespace yet (D14).';
		return;
	}

	const request = new AbortController();
	row.controller = request;
	row.loading = true;

	try {
		const response = await api.get<{ data: { id: string; name: string }[] }>('/roles', {
			params: { fields: ['id', 'name'], sort: 'name', limit: -1 },
			signal: request.signal,
		});

		if (!request.signal.aborted && row.namespaceId === value)
			row.roles = response.data.data.map((role) => ({ text: role.name, value: role.id }));
		if (
			row === rows.value[0] &&
			typeof route.query.admin_role === 'string' &&
			row.roles.some((role) => role.value === route.query.admin_role)
		)
			row.roleId = route.query.admin_role;
	} catch {
		if (!request.signal.aborted) row.error = 'Could not load roles from this namespace';
	} finally {
		if (!request.signal.aborted) row.loading = false;
	}
}
</script>

<style scoped>
.form {
	max-width: 760px;
	padding: 32px;
	display: grid;
	gap: 20px;
}
.assignment {
	display: grid;
	grid-template-columns: 1fr 1fr auto;
	gap: 16px;
	align-items: end;
}
.field {
	display: grid;
	gap: 8px;
}
.row-note {
	grid-column: 1 / -1;
	color: var(--foreground-subdued);
}
.actions {
	display: flex;
	justify-content: flex-end;
	gap: 12px;
}
</style>
