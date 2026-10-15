<template>
	<div class="namespace-state" role="status" aria-live="polite">
		<h1 v-if="mode === 'loading'">Loading namespace</h1>
		<h1 v-else-if="mode === 'recover'">Namespace unavailable</h1>
		<h1 v-else-if="mode === 'choose'">Choose a namespace</h1>
		<h1 v-else>Namespace ready</h1>
		<p v-if="mode === 'recover'">The selected namespace could not be loaded. Your login is still available.</p>
		<p v-if="loading">Loading available namespaces…</p>
		<p v-else-if="listError">Could not load available namespaces.</p>
		<p v-else-if="mode === 'choose' && !enterable.length">{{ noAccessMessage }}</p>
		<p v-if="switchError" role="alert">Could not switch namespace. Please try again.</p>
		<p v-if="mode === 'landing'">Open a Directus module to continue.</p>
		<router-link v-if="mode === 'landing' && active" :to="contentDestination">Content</router-link>
		<div v-if="mode !== 'loading'" class="actions">
			<button
				v-for="choice in enterable"
				:key="choice.namespace.id"
				type="button"
				:disabled="loading || listError || switching"
				@click="enter(choice.namespace.id)"
			>
				{{ choice.namespace.name }}
			</button>
			<button v-if="mode === 'recover' && active" type="button" :disabled="loading || switching" @click="retry">
				Retry
			</button>
			<button
				v-if="mode === 'choose' || mode === 'recover'"
				type="button"
				:disabled="loading || switching"
				@click="refreshChoices"
			>
				Refresh choices
			</button>
		</div>
		<ul v-if="mode === 'choose' && unavailable.length && !loading && !listError" class="unavailable">
			<li v-for="choice in unavailable" :key="choice.namespace.id">
				{{ choice.namespace.name }} — {{ unavailableReason(choice) }}
			</li>
		</ul>
	</div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ensureNamespaceRuntime } from './live';
import { isEnterableChild } from './choices';
import type { AuthorizedNamespaceChoice } from './types';
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

const contentDestination = computed(() =>
	active.value ? withNamespace('/content', active.value.namespaceId) : '/namespace/choose'
);

const enterable = computed(() => runtime.state.choices.filter(isEnterableChild));
const unavailable = computed(() =>
	runtime.state.choices.filter((choice) => choice.namespace.kind === 'virtual' && !isEnterableChild(choice))
);

function unavailableReason(choice: AuthorizedNamespaceChoice) {
	if (choice.namespace.readiness === 'provisioning') return 'Provisioning';
	if (choice.namespace.readiness === 'failed') return 'Unavailable';
	return choice.access.source === 'inherited' ? 'App access unavailable' : 'API access only';
}

const noAccessMessage = computed(() => {
	const virtual = runtime.state.choices.filter((choice) => choice.namespace.kind === 'virtual');
	if (virtual.some((choice) => choice.access.source === 'inherited' && !choice.access.canUseApp))
		return 'Your Global Admin account cannot currently open these namespaces. Ask an administrator to check app access.';
	if (virtual.some((choice) => choice.namespace.readiness === 'ready' && !choice.access.canUseApp))
		return 'Your available namespace has API access only.';
	if (virtual.some((choice) => choice.namespace.readiness !== 'ready'))
		return 'No virtual namespace is ready to enter yet.';
	return 'You do not have access to a virtual namespace.';
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
		!enterable.value.some((choice) => choice.namespace.id === namespaceId)
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
	gap: 16px;
	text-align: center;
	padding: 40px;
}
.actions {
	display: flex;
	gap: 12px;
	justify-content: center;
	flex-wrap: wrap;
}
button {
	padding: 10px 16px;
	border: 1px solid currentColor;
	border-radius: 4px;
}
button:disabled {
	opacity: 0.5;
	cursor: default;
}
.unavailable {
	list-style: none;
	padding: 0;
	color: var(--foreground-subdued);
}
</style>
