<template>
	<private-view title="Virtual Namespaces">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary><v-icon name="account_tree" /></v-button>
		</template>
		<template #navigation><global-navigation /></template>
		<template #actions:prepend>
			<span class="item-count">{{ t('item_count', { count: filteredNamespaces.length }) }}</span>
		</template>
		<template #actions>
			<search-input v-model="search" :filter-count="activeFilterCount">
				<template #filter>
					<div class="namespace-filters">
						<div class="filter-field">
							<label>Readiness</label>
							<v-select v-model="readinessFilter" :items="readinessOptions" />
						</div>
						<div class="filter-field">
							<label>Access</label>
							<v-select v-model="accessFilter" :items="accessOptions" />
						</div>
						<v-button v-if="activeFilterCount" small secondary @click="clearFilters">Clear filters</v-button>
					</div>
				</template>
			</search-input>
			<v-button v-tooltip.bottom="'Create Namespace'" rounded icon to="/global-admin/namespaces/new">
				<v-icon name="add" />
			</v-button>
		</template>
		<template #sidebar>
			<sidebar-detail icon="info" title="Namespace management" close>
				<p>Entering a ready namespace is explicit. Searching and filtering do not change the active namespace.</p>
				<p v-if="selected.length">{{ selected.length }} selected</p>
				<v-button secondary :loading="loading" @click="refresh">Refresh namespaces</v-button>
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
				:items="filteredNamespaces"
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
			<v-info
				v-else-if="!loading && !error && filteredNamespaces.length === 0"
				title="No matching namespaces"
				icon="search"
				center
			/>
			<v-notice v-if="switchError" type="danger">{{ switchError }}</v-notice>
		</div>
	</private-view>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ensureNamespaceRuntime } from '@/namespaces/live';
import { canManagePlatformResource } from '@/namespaces/capabilities';
import type { HeaderRaw } from '@/components/v-table/types';
import SearchInput from '@/views/private/components/search-input.vue';
import GlobalNavigation from './navigation.vue';

const runtime = ensureNamespaceRuntime();
const { t } = useI18n();
const loading = ref(false);
const entering = ref(false);
const error = ref<string | null>(null);
const switchError = ref<string | null>(null);
const selected = ref<{ id: string }[]>([]);
const search = ref<string | null>(null);
const readinessFilter = ref('all');
const accessFilter = ref('all');

const readinessOptions = [
	{ text: 'All statuses', value: 'all' },
	{ text: 'Ready', value: 'ready' },
	{ text: 'Provisioning', value: 'provisioning' },
	{ text: 'Failed', value: 'failed' },
];

const accessOptions = [
	{ text: 'All access', value: 'all' },
	{ text: 'App access', value: 'app' },
	{ text: 'API access only', value: 'api' },
];

const activeFilterCount = computed(
	() => Number(readinessFilter.value !== 'all') + Number(accessFilter.value !== 'all')
);

const namespaces = computed(() =>
	runtime.state.choices
		.filter((choice) => choice.namespace.kind === 'virtual')
		.map((choice) => ({ ...choice.namespace, canUseApp: choice.access.canUseApp }))
);

const filteredNamespaces = computed(() => {
	const query = search.value?.trim().toLocaleLowerCase() ?? '';
	return namespaces.value.filter((namespace) => {
		if (query && !`${namespace.name} ${namespace.id}`.toLocaleLowerCase().includes(query)) return false;
		if (readinessFilter.value !== 'all' && namespace.readiness !== readinessFilter.value) return false;
		if (accessFilter.value === 'app' && !namespace.canUseApp) return false;
		if (accessFilter.value === 'api' && namespace.canUseApp) return false;
		return true;
	});
});

watch([search, readinessFilter, accessFilter], () => {
	selected.value = [];
});

const headers = ref<HeaderRaw[]>([
	{ text: 'Name', value: 'name', width: 280 },
	{ text: 'Readiness', value: 'readiness', width: 160 },
	{ text: 'Access', value: 'access', sortable: false, width: 180 },
]);

onMounted(() => {
	void refresh();
});

function clearFilters() {
	readinessFilter.value = 'all';
	accessFilter.value = 'all';
}

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
.namespace-filters {
	display: grid;
	gap: 12px;
	min-width: 240px;
	margin: 10px 8px;
}
.filter-field {
	display: grid;
	gap: 4px;
}
</style>
