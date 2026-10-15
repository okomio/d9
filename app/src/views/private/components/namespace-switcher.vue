<template>
	<div class="namespace-switcher">
		<v-menu placement="bottom-start" show-arrow :disabled="!canOpen">
			<template #activator="{ toggle, active }">
				<button
					ref="trigger"
					class="namespace-trigger"
					type="button"
					aria-label="Switch virtual namespace"
					aria-haspopup="menu"
					:aria-expanded="active"
					:disabled="!canOpen"
					@click="toggle"
				>
					<span class="namespace-name">{{ activeName }}</span>
					<v-icon name="expand_more" small />
				</button>
			</template>

			<v-list class="namespace-menu" role="menu" aria-label="Virtual namespaces">
				<v-list-item
					v-for="choice in choices"
					:key="choice.namespace.id"
					clickable
					role="menuitem"
					:tabindex="isEnterableChild(choice) ? 0 : -1"
					:active="choice.namespace.id === activeId"
					:disabled="!isEnterableChild(choice)"
					@click="selectNamespace(choice.namespace.id)"
					@keydown.enter="selectNamespace(choice.namespace.id)"
					@keydown.space.prevent="selectNamespace(choice.namespace.id)"
				>
					<v-list-item-icon><v-icon :name="choice.namespace.id === activeId ? 'check' : 'layers'" /></v-list-item-icon>
					<v-list-item-content>{{ optionLabel(choice) }}</v-list-item-content>
				</v-list-item>
			</v-list>
		</v-menu>
		<span class="namespace-status" role="status" aria-live="polite">{{ status }}</span>
		<button v-if="listError" class="retry" type="button" @click="refresh">Retry</button>
	</div>
</template>

<script lang="ts">
// The native private view remounts after a committed switch.
let restoreFocusAfterSwitch = false;
</script>

<script setup lang="ts">
import { getNamespaceRuntime } from '@/namespaces/live';
import { isEnterableChild } from '@/namespaces/choices';
import type { AuthorizedNamespaceChoice } from '@/namespaces/types';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const runtime = getNamespaceRuntime();
const trigger = ref<HTMLButtonElement | null>(null);
const loading = computed(() => runtime?.state.choicesLoading ?? false);
const listError = computed(() => !!runtime?.state.choicesError);
const switchError = ref(false);
const switching = ref(false);
let mounted = true;

const choices = computed(() => runtime?.state.choices.filter((choice) => choice.namespace.kind === 'virtual') ?? []);
const activeId = computed(() => runtime?.state.active?.namespaceId ?? null);
const activeName = computed(() => runtime?.state.active?.namespace.name ?? 'Choose a namespace');
const eligibleCount = computed(() => choices.value.filter(isEnterableChild).length);
const busy = computed(() => switching.value || (!!runtime && !['ready', 'no-access'].includes(runtime.state.phase)));
const canOpen = computed(() => !loading.value && !listError.value && !busy.value && choices.value.length > 0);
const status = computed(() => {
	if (loading.value) return 'Loading virtual namespaces…';
	if (listError.value) return 'Could not load virtual namespaces.';
	if (busy.value) {
		const target = choices.value.find((choice) => choice.namespace.id === runtime?.state.pending);
		return target ? `Switching to ${target.namespace.name}…` : 'Switching namespace…';
	}
	if (switchError.value) return 'Could not switch namespace. Your current namespace is still selected.';
	if (!eligibleCount.value) return 'No virtual namespace is available to open.';
	return '';
});

function optionLabel(choice: AuthorizedNamespaceChoice): string {
	if (choice.namespace.readiness === 'provisioning') return `${choice.namespace.name} (provisioning)`;
	if (choice.namespace.readiness === 'failed') return `${choice.namespace.name} (unavailable)`;
	if (!choice.access.canUseApp)
		return `${choice.namespace.name} (${
			choice.access.source === 'inherited' ? 'app access unavailable' : 'API access only'
		})`;
	return choice.namespace.name;
}

async function refresh() {
	if (!runtime) return;
	try {
		await runtime.refreshChoices();
	} catch {
		// The shared runtime publishes the listing error for all namespace surfaces.
	}
}

async function selectNamespace(id: string) {
	if (
		!runtime ||
		!canOpen.value ||
		!choices.value.some((choice) => choice.namespace.id === id && isEnterableChild(choice))
	)
		return;
	if (id === activeId.value) return;

	switching.value = true;
	switchError.value = false;
	restoreFocusAfterSwitch = true;
	try {
		const result = await runtime.coordinator.requestSwitch({
			namespaceId: id,
			source: 'picker',
			destination: '/content',
		});
		if (result.status !== 'ready' && result.status !== 'stayed' && mounted) switchError.value = true;
	} catch {
		if (mounted) switchError.value = true;
	} finally {
		if (mounted) {
			switching.value = false;
			await nextTick();
			trigger.value?.focus();
			restoreFocusAfterSwitch = false;
		}
	}
}

watch(
	() => [runtime?.state.phase, loading.value],
	async () => {
		if (!restoreFocusAfterSwitch || runtime?.state.phase !== 'ready' || loading.value) return;
		await nextTick();
		if (!trigger.value || loading.value) return;
		trigger.value.focus();
		restoreFocusAfterSwitch = false;
	},
	{ immediate: true }
);

onMounted(() => void refresh());

onBeforeUnmount(() => {
	mounted = false;
});
</script>

<style lang="scss" scoped>
.namespace-switcher {
	min-width: 0;
	color: var(--foreground-normal-alt);
}
.namespace-trigger {
	display: flex;
	align-items: center;
	justify-content: space-between;
	width: 100%;
	min-width: 0;
	padding: 0;
	border: 0;
	background: transparent;
	color: inherit;
	font-family: inherit;
	font-size: 13px;
	line-height: 18px;
	text-align: left;
	cursor: pointer;
	&:hover:not(:disabled) {
		color: var(--foreground-normal);
	}
	&:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}
	&:disabled {
		cursor: default;
	}
}
.namespace-name {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.namespace-trigger .v-icon {
	flex: none;
	margin-left: 8px;
}
.namespace-menu {
	--v-list-min-width: 220px;
	--v-list-max-width: 320px;
}
.namespace-menu .v-list-item-icon {
	margin-right: 8px;
}
.namespace-status {
	display: block;
	overflow: hidden;
	font-size: 11px;
	line-height: 1.2;
	color: var(--foreground-subdued);
	text-overflow: ellipsis;
	white-space: nowrap;
	&:empty {
		display: none;
	}
}
.retry {
	padding: 0;
	border: 0;
	background: transparent;
	color: var(--primary);
	font-size: 11px;
	cursor: pointer;
}
</style>
