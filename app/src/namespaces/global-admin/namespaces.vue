<template>
	<private-view title="Virtual Namespaces">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary><v-icon name="account_tree" /></v-button>
		</template>
		<template #navigation><global-navigation /></template>
		<template #actions>
			<v-button v-tooltip.bottom="'Refresh namespaces'" rounded icon secondary :loading="loading" @click="refresh">
				<v-icon name="refresh" />
			</v-button>
			<v-button v-tooltip.bottom="'Create Namespace requires D06'" disabled>Create Namespace</v-button>
		</template>
		<template #sidebar>
			<sidebar-detail icon="info" title="Namespace management" close>
				<p>
					Create Namespace is awaiting the D06 platform create and status API. Entering a ready namespace is explicit.
				</p>
				<p v-if="selected.length">{{ selected.length }} selected</p>
			</sidebar-detail>
		</template>
		<div class="directory">
			<v-notice v-if="error" type="danger">
				{{ error }}
				<v-button secondary @click="refresh">Retry</v-button>
			</v-notice>
			<v-table
				v-model="selected"
				v-model:headers="headers"
				:items="namespaces"
				:loading="loading"
				show-select="multiple"
				show-resize
				fixed-header
				item-key="id"
			>
				<template #[`item.name`]="{ item }"><v-text-overflow :text="item.name" /></template>
				<template #[`item.readiness`]="{ item }">
					<v-chip small :class="item.readiness">{{ item.readiness }}</v-chip>
				</template>
				<template #[`item.access`]="{ item }">{{ item.canUseApp ? 'App access' : 'API access only' }}</template>
				<template #item-append="{ item }">
					<v-menu placement="left-start" show-arrow>
						<template #activator="{ toggle }"><v-icon name="more_vert" clickable @click="toggle" /></template>
						<v-list>
							<v-list-item clickable :disabled="!canEnter(item) || entering" @click="enter(item.id)">
								<v-list-item-icon><v-icon name="login" /></v-list-item-icon>
								<v-list-item-content>Enter namespace</v-list-item-content>
							</v-list-item>
						</v-list>
					</v-menu>
				</template>
			</v-table>
			<v-info
				v-if="!loading && !error && namespaces.length === 0"
				title="No virtual namespaces"
				icon="account_tree"
				center
			/>
			<v-notice v-if="switchError" type="danger">{{ switchError }}</v-notice>
		</div>
	</private-view>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ensureNamespaceRuntime } from '@/namespaces/live';
import { canManagePlatformResource } from '@/namespaces/capabilities';
import type { HeaderRaw } from '@/components/v-table/types';
import GlobalNavigation from './navigation.vue';

const runtime = ensureNamespaceRuntime();
const loading = ref(false);
const entering = ref(false);
const error = ref<string | null>(null);
const switchError = ref<string | null>(null);
const selected = ref<{ id: string }[]>([]);

const namespaces = computed(() =>
	runtime.state.choices
		.filter((choice) => choice.namespace.kind === 'virtual')
		.map((choice) => ({ ...choice.namespace, canUseApp: choice.access.canUseApp }))
);

const headers = ref<HeaderRaw[]>([
	{ text: 'Name', value: 'name', width: 280 },
	{ text: 'Readiness', value: 'readiness', width: 160 },
	{ text: 'Access', value: 'access', sortable: false, width: 180 },
]);

onMounted(() => {
	void refresh();
});

async function refresh() {
	if (!canManagePlatformResource(runtime.state.session?.platform ?? null, 'namespaces')) return;
	loading.value = true;
	error.value = null;

	try {
		await runtime.refreshChoices();
		selected.value = [];
	} catch {
		error.value = 'Could not load namespaces';
	} finally {
		loading.value = false;
	}
}

function canEnter(row: { id: string; readiness: string; canUseApp: boolean }) {
	return (
		row.readiness === 'ready' &&
		row.canUseApp &&
		canManagePlatformResource(runtime.state.session?.platform ?? null, 'namespaces')
	);
}

async function enter(id: string) {
	const row = namespaces.value.find((choice) => choice.id === id);
	if (!row || !canEnter(row)) return;
	entering.value = true;
	switchError.value = null;

	try {
		const result = await runtime.coordinator.requestSwitch({
			namespaceId: id,
			source: 'platform',
			destination: '/content',
		});

		if (result.status !== 'ready') switchError.value = 'Namespace entry did not complete';
	} catch {
		switchError.value = 'Namespace entry failed';
	} finally {
		entering.value = false;
	}
}
</script>

<style scoped>
.directory {
	padding: var(--content-padding);
}
.v-table {
	--layout-offset-top: 64px;
}
</style>
