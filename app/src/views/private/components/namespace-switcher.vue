<template>
	<div class="namespace-switcher">
		<div class="namespace-row">
			<select
				ref="selector"
				class="namespace-select"
				aria-label="Virtual namespace"
				:value="activeId ?? ''"
				:disabled="!canSelect"
				@change="selectNamespace"
			>
				<option v-if="!activeInChoices" :value="activeId ?? ''" disabled>
					{{ activeId ? 'Namespace access unavailable' : 'Choose a namespace' }}
				</option>
				<option
					v-for="choice in choices"
					:key="choice.namespace.id"
					:value="choice.namespace.id"
					:disabled="!isEnterableChild(choice)"
				>
					{{ optionLabel(choice) }}
				</option>
			</select>
			<button
				ref="refreshButton"
				class="refresh"
				type="button"
				aria-label="Refresh virtual namespaces"
				:disabled="loading || switching"
				@click="refresh"
			>
				<v-icon name="refresh" small />
			</button>
		</div>
		<span class="namespace-status" role="status" aria-live="polite">{{ status }}</span>
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
const selector = ref<HTMLSelectElement | null>(null);
const refreshButton = ref<HTMLButtonElement | null>(null);
const loading = computed(() => runtime?.state.choicesLoading ?? false);
const listError = computed(() => !!runtime?.state.choicesError);
const switchError = ref(false);
const switching = ref(false);
let mounted = true;

const choices = computed(() => runtime?.state.choices.filter((choice) => choice.namespace.kind === 'virtual') ?? []);
const activeId = computed(() => runtime?.state.active?.namespaceId ?? null);
const activeInChoices = computed(() => choices.value.some((choice) => choice.namespace.id === activeId.value));
const eligibleCount = computed(() => choices.value.filter(isEnterableChild).length);
const busy = computed(() => switching.value || (!!runtime && !['ready', 'no-access'].includes(runtime.state.phase)));
const canSelect = computed(
	() =>
		!loading.value &&
		!listError.value &&
		!busy.value &&
		choices.value.some((choice) => isEnterableChild(choice) && choice.namespace.id !== activeId.value)
);
const status = computed(() => {
	if (loading.value) return 'Loading virtual namespaces…';
	if (listError.value) return 'Could not load virtual namespaces. Refresh to retry.';
	if (busy.value) {
		const target = choices.value.find((choice) => choice.namespace.id === runtime?.state.pending);
		return target ? `Switching to ${target.namespace.name}…` : 'Switching namespace…';
	}
	if (switchError.value) return 'Could not switch namespace. Your current namespace is still selected.';
	if (!eligibleCount.value) return 'No virtual namespace is available to open.';
	if (eligibleCount.value === 1) return 'Only one virtual namespace is available.';
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

async function selectNamespace(event: Event) {
	const select = event.target as HTMLSelectElement;
	const id = select.value;
	select.value = activeId.value ?? '';
	if (
		!runtime ||
		!canSelect.value ||
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
			if (selector.value?.disabled) refreshButton.value?.focus();
			else selector.value?.focus();
			restoreFocusAfterSwitch = false;
		}
	}
}

watch(
	() => [runtime?.state.phase, loading.value],
	async () => {
		if (!restoreFocusAfterSwitch || runtime?.state.phase !== 'ready' || loading.value) return;
		await nextTick();
		if (!selector.value || loading.value) return;
		if (selector.value.disabled) refreshButton.value?.focus();
		else selector.value.focus();
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
.namespace-row {
	display: flex;
	align-items: center;
	gap: 4px;
}
.namespace-select {
	width: 100%;
	min-width: 0;
	padding: 0;
	border: 0;
	background: transparent;
	color: inherit;
	font: inherit;
	font-weight: 600;
	text-overflow: ellipsis;
	cursor: pointer;
	&:disabled {
		cursor: default;
		opacity: 1;
	}
}
.refresh {
	flex: none;
	padding: 0;
	border: 0;
	background: transparent;
	color: var(--foreground-subdued);
	cursor: pointer;
	&:disabled {
		cursor: default;
		opacity: 0.5;
	}
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
</style>
