<template>
	<div class="namespace-state">
		<template v-if="mode === 'choose' || mode === 'recover'">
			<v-card class="chooser-card">
				<area-chooser
					:choices="choices"
					:active-id="active?.namespaceId ?? null"
					:global-admin="runtime.state.session?.platform.isGlobalAdmin ?? false"
					:loading="loading"
					:busy="switching"
					:error="listError"
					:empty-message="noAccessMessage"
					@refresh="refreshChoices"
					@select="enter"
				/>
				<p v-if="mode === 'recover'" class="recovery-message">
					The selected area could not be loaded. Your login is still valid.
				</p>
				<p v-if="switchError" class="recovery-message" role="alert">Could not switch area. Please try again.</p>
				<v-card-actions v-if="mode === 'recover' && active">
					<v-button secondary :disabled="loading || switching" @click="retry">Retry current area</v-button>
				</v-card-actions>
			</v-card>
		</template>
		<template v-else>
			<h1>{{ mode === 'loading' ? 'Loading area' : 'Area ready' }}</h1>
			<p v-if="mode === 'landing'">Open a Directus module to continue.</p>
			<router-link v-if="mode === 'landing' && active" :to="contentDestination">Content</router-link>
		</template>
	</div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import AreaChooser from './chooser-content.vue';
import { ensureNamespaceRuntime } from './live';
import { isEnterableChild } from './choices';
import { withNamespace, internalDestination } from './url';

const props = defineProps<{ mode: 'loading' | 'choose' | 'recover' | 'landing' }>();
const runtime = ensureNamespaceRuntime();
const route = useRoute();
const active = computed(() => runtime.state.active);
const localLoading = ref(false);
const localListError = ref(false);
const loading = computed(() => localLoading.value || runtime.state.choicesLoading);
const listError = computed(() => localListError.value || !!runtime.state.choicesError);
const switchError = ref(false);
const switching = ref(false);
const choices = computed(() => runtime.state.choices.filter((choice) => choice.namespace.kind === 'virtual'));

const contentDestination = computed(() =>
	active.value ? withNamespace('/content', active.value.namespaceId) : '/namespace/choose'
);

const noAccessMessage = computed(() => {
	if (choices.value.some((choice) => choice.access.source === 'inherited' && !choice.access.canUseApp))
		return 'Your Global Admin account cannot currently open these areas. Ask an administrator to check app access.';
	if (choices.value.some((choice) => choice.namespace.readiness === 'ready' && !choice.access.canUseApp))
		return 'Your available area has API access only.';
	if (choices.value.some((choice) => choice.namespace.readiness !== 'ready')) return 'No area is ready to enter yet.';
	return 'No areas available. Ask a global admin to grant you a role.';
});

async function refreshChoices() {
	localLoading.value = true;
	localListError.value = false;

	try {
		const hadSession = !!runtime.state.session;
		await runtime.ensureSession();
		if (hadSession) await runtime.refreshChoices();
	} catch {
		localListError.value = true;
	} finally {
		localLoading.value = false;
	}
}

async function enter(namespaceId: string) {
	if (
		loading.value ||
		listError.value ||
		switching.value ||
		!choices.value.some((choice) => choice.namespace.id === namespaceId && isEnterableChild(choice))
	)
		return;
	switching.value = true;
	switchError.value = false;

	try {
		const result = await runtime.coordinator.requestSwitch({ namespaceId, source: 'picker', destination: '/content' });
		if (result.status === 'blocked') switchError.value = true;
	} catch {
		switchError.value = true;
	} finally {
		switching.value = false;
	}
}

function retry() {
	if (!active.value) return;
	let destination = '/content';

	try {
		if (typeof route.query.next === 'string') destination = internalDestination(route.query.next);
	} catch {
		/* Invalid saved intent uses Content. */
	}

	void runtime.coordinator.requestSwitch({
		namespaceId: active.value.namespaceId,
		source: 'recovery',
		destination,
	});
}

onMounted(() => {
	if (props.mode === 'choose' || props.mode === 'recover') void refreshChoices();
});
</script>

<style scoped>
.namespace-state {
	min-height: 100%;
	display: grid;
	place-content: center;
	padding: 32px;
	text-align: center;
}

.recovery-message {
	padding: 0 32px 16px;
	color: var(--foreground-subdued);
}

.chooser-card {
	--v-card-min-width: min(680px, calc(100vw - 64px));
	--v-card-max-width: min(680px, calc(100vw - 64px));
}
</style>
