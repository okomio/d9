<template>
	<div class="namespace-state" role="status" aria-live="polite">
		<h1 v-if="mode === 'loading'">Loading namespace</h1>
		<h1 v-else-if="mode === 'recover'">Namespace unavailable</h1>
		<h1 v-else-if="mode === 'choose'">Choose a namespace</h1>
		<h1 v-else>Namespace ready</h1>
		<p v-if="mode === 'recover'">The selected namespace could not be loaded. Your login is still available.</p>
		<p v-if="mode === 'choose' && !enterable.length">{{ noAccessMessage }}</p>
		<p v-if="mode === 'landing'">Open a Directus module to continue.</p>
		<router-link v-if="mode === 'landing' && active" :to="contentDestination">Content</router-link>
		<div v-if="mode !== 'loading'" class="actions">
			<button v-for="choice in enterable" :key="choice.namespace.id" type="button" @click="enter(choice.namespace.id)">
				{{ choice.namespace.name }}
			</button>
			<button v-if="mode === 'recover' && active" type="button" @click="retry">Retry</button>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { ensureNamespaceRuntime } from './live';
import { withNamespace, internalDestination } from './url';

defineProps<{ mode: 'loading' | 'choose' | 'recover' | 'landing' }>();
const runtime = ensureNamespaceRuntime();
const route = useRoute();
const active = computed(() => runtime.state.active);

const contentDestination = computed(() =>
	active.value ? withNamespace('/content', active.value.namespaceId) : '/namespace/choose'
);

const enterable = computed(() =>
	runtime.state.choices.filter(
		(choice) => choice.namespace.kind === 'virtual' && choice.namespace.readiness === 'ready' && choice.access.canUseApp
	)
);

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

function enter(namespaceId: string) {
	void runtime.coordinator.requestSwitch({ namespaceId, source: 'picker', destination: '/content' });
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
</style>
