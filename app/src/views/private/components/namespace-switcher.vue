<template>
	<div class="namespace-switcher">
		<v-dialog v-model="dialogOpen" @esc="close">
			<template #activator="{ on }">
				<v-button
					v-tooltip.right="'Switch area'"
					tile
					icon
					x-large
					class="switch-trigger"
					:disabled="!canOpen"
					@click="open(on)"
				>
					<v-icon name="swap_horiz" />
					<span class="visually-hidden">Switch area</span>
				</v-button>
			</template>
			<v-card class="chooser-dialog-card">
				<area-chooser
					:choices="choices"
					:active-id="activeId"
					:global-admin="globalAdmin"
					:loading="loading"
					:busy="switching"
					:error="listError"
					@refresh="refresh"
					@select="selectArea"
				/>
				<p v-if="switchError" class="switch-error" role="alert">
					Could not complete the area switch. Please try again.
				</p>
				<v-card-actions>
					<v-button secondary :disabled="switching" @click="close">Cancel</v-button>
				</v-card-actions>
			</v-card>
		</v-dialog>
	</div>
</template>

<script setup lang="ts">
import { ensureNamespaceRuntime } from '@/namespaces/live';
import { isEnterableChild } from '@/namespaces/choices';
import AreaChooser from '@/namespaces/chooser-content.vue';
import { computed, ref } from 'vue';

const runtime = ensureNamespaceRuntime();
const dialogOpen = ref(false);
const switching = ref(false);
const switchError = ref(false);
const canOpen = computed(() => !switching.value && runtime.state.phase === 'ready');
const choices = computed(() => runtime?.state.choices.filter((choice) => choice.namespace.kind === 'virtual') ?? []);
const activeId = computed(() => runtime?.state.active?.namespaceId ?? null);
const globalAdmin = computed(() => runtime?.state.session?.platform.isGlobalAdmin ?? false);
const loading = computed(() => runtime?.state.choicesLoading ?? false);
const listError = computed(() => !!runtime?.state.choicesError);

function open(activate: () => void) {
	if (!canOpen.value) return;
	switchError.value = false;
	activate();
	void refresh();
}

function close() {
	if (!switching.value) dialogOpen.value = false;
}

async function refresh() {
	if (!runtime || switching.value) return;

	try {
		await runtime.refreshChoices();
	} catch {
		// The shared runtime publishes the listing error for the chooser.
	}
}

async function selectArea(id: string) {
	if (
		!runtime ||
		switching.value ||
		id === activeId.value ||
		!choices.value.some((choice) => choice.namespace.id === id && isEnterableChild(choice))
	)
		return;

	switching.value = true;
	switchError.value = false;

	try {
		const result = await runtime.coordinator.requestSwitch({
			namespaceId: id,
			source: 'picker',
			destination: '/content',
		});

		if (result.status === 'ready') return; // The browser reloads at the selected area URL.
		if (result.status !== 'stayed') switchError.value = true;
	} catch {
		switchError.value = true;
	} finally {
		switching.value = false;
	}
}
</script>

<style lang="scss" scoped>
.namespace-switcher {
	width: 60px;
	height: 60px;
}

.switch-trigger {
	--v-button-color: var(--module-icon);
	--v-button-color-hover: var(--white);
	--v-button-background-color: var(--module-background);
	--v-button-background-color-hover: var(--module-background);
}

.switch-error {
	padding: 0 32px;
	color: var(--danger);
}

:global(.chooser-dialog-card) {
	--v-card-min-width: min(680px, calc(100vw - 40px));
	--v-card-max-width: min(680px, calc(100vw - 40px));
}

.visually-hidden {
	position: absolute;
	width: 1px;
	height: 1px;
	overflow: hidden;
	clip-path: inset(50%);
	white-space: nowrap;
}
</style>
