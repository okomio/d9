<template>
	<v-list nav>
		<v-list-item to="/global-admin/users" exact :active="route.path === '/global-admin/users' && !namespaceFilter">
			<v-list-item-icon><v-icon name="people_alt" /></v-list-item-icon>
			<v-list-item-content>All Users</v-list-item-content>
		</v-list-item>
		<v-list-item to="/global-admin/namespaces" :active="route.path.startsWith('/global-admin/namespaces')">
			<v-list-item-icon><v-icon name="account_tree" /></v-list-item-icon>
			<v-list-item-content>Virtual Namespaces</v-list-item-content>
		</v-list-item>
		<v-divider />
		<v-list-item>
			<v-list-item-content>Users by virtual namespace</v-list-item-content>
		</v-list-item>
		<template v-for="choice in choices" :key="choice.namespace.id">
			<v-list-item
				:to="{ path: '/global-admin/users', query: { admin_ns: choice.namespace.id } }"
				:active="namespaceFilter === choice.namespace.id && !roleFilter"
			>
				<v-list-item-icon>
					<v-icon
						:name="expanded === choice.namespace.id ? 'expand_more' : 'chevron_right'"
						clickable
						@click.stop.prevent="toggle(choice.namespace.id)"
					/>
				</v-list-item-icon>
				<v-list-item-content>{{ choice.namespace.name }}</v-list-item-content>
			</v-list-item>
			<template v-if="expanded === choice.namespace.id">
				<v-list-item v-if="loadingRoles"><v-list-item-content>Loading roles…</v-list-item-content></v-list-item>
				<v-list-item v-else-if="roleError">
					<v-list-item-content>{{ roleError }}</v-list-item-content>
				</v-list-item>
				<v-list-item v-else-if="roles.length === 0">
					<v-list-item-content>No roles in this namespace</v-list-item-content>
				</v-list-item>
				<v-list-item
					v-for="role in roles"
					:key="role.id"
					:to="{ path: '/global-admin/users', query: { admin_ns: choice.namespace.id, admin_role: role.id } }"
					:active="namespaceFilter === choice.namespace.id && roleFilter === role.id"
				>
					<v-list-item-icon><v-icon name="badge" /></v-list-item-icon>
					<v-list-item-content>{{ role.name }}</v-list-item-content>
				</v-list-item>
			</template>
		</template>
	</v-list>
</template>

<script setup lang="ts">
import api from '@/api';
import { ensureNamespaceRuntime } from '@/namespaces/live';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

const runtime = ensureNamespaceRuntime();
const route = useRoute();
const choices = computed(() => runtime.state.choices.filter((choice) => choice.namespace.kind === 'virtual'));
const namespaceFilter = computed(() => (typeof route.query.admin_ns === 'string' ? route.query.admin_ns : null));
const roleFilter = computed(() => (typeof route.query.admin_role === 'string' ? route.query.admin_role : null));
const expanded = ref<string | null>(null);
const roles = ref<{ id: string; name: string }[]>([]);
const loadingRoles = ref(false);
const roleError = ref<string | null>(null);
let controller: AbortController | null = null;

watch(
	namespaceFilter,
	(id) => {
		if (id) void toggle(id, true);
	},
	{ immediate: true }
);

onBeforeUnmount(() => controller?.abort());

async function toggle(id: string, keepOpen = false) {
	if (expanded.value === id && !keepOpen) {
		expanded.value = null;
		controller?.abort();
		return;
	}

	controller?.abort();
	const request = new AbortController();
	controller = request;
	expanded.value = id;
	roles.value = [];
	roleError.value = null;
	loadingRoles.value = true;

	try {
		const response = await api.get<{ data: { id: string; name: string }[] }>(
			`/namespaces/${encodeURIComponent(id)}/roles`,
			{
				signal: request.signal,
			}
		);

		if (!request.signal.aborted && expanded.value === id) roles.value = response.data.data;
	} catch {
		if (!request.signal.aborted) roleError.value = 'Could not load roles';
	} finally {
		if (!request.signal.aborted) loadingRoles.value = false;
	}
}
</script>
