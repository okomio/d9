<template>
	<private-view title="Create Namespace">
		<template #headline>
			<v-breadcrumb :items="[{ name: 'Virtual Namespaces', to: '/global-admin/namespaces' }]" />
		</template>
		<template #navigation><global-navigation /></template>
		<template #sidebar>
			<sidebar-detail icon="info" title="Namespace management" close>
				Creating a namespace leaves the active content namespace unchanged.
			</sidebar-detail>
		</template>
		<form class="form" @submit.prevent="create">
			<v-notice v-if="error" type="danger">{{ error }}</v-notice>
			<div class="field">
				<label>Namespace name</label>
				<v-input v-model="name" :disabled="saving" />
			</div>
			<div class="actions">
				<v-button to="/global-admin/namespaces" secondary>Cancel</v-button>
				<v-button type="submit" :loading="saving" :disabled="!name.trim()">Create Namespace</v-button>
			</div>
		</form>
	</private-view>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import api from '@/api';
import { ensureNamespaceRuntime } from '@/namespaces/live';
import { canManagePlatformResource } from '@/namespaces/capabilities';
import GlobalNavigation from './navigation.vue';

const runtime = ensureNamespaceRuntime();
const router = useRouter();
const name = ref('');
const saving = ref(false);
const error = ref<string | null>(null);
let requestKey = crypto.randomUUID();

watch(name, () => {
	requestKey = crypto.randomUUID();
	error.value = null;
});

async function create() {
	if (saving.value || !name.value.trim()) return;
	if (!canManagePlatformResource(runtime.state.session?.platform ?? null, 'namespaces')) return;
	saving.value = true;
	error.value = null;
	try {
		await api.post('/namespaces', { name: name.value.trim() }, { headers: { 'Idempotency-Key': requestKey } });
		await runtime.refreshChoices();
		void router.push('/global-admin/namespaces');
	} catch (cause: any) {
		error.value = cause?.response?.data?.errors?.[0]?.message || 'Could not create namespace';
	} finally {
		saving.value = false;
	}
}
</script>

<style scoped>
.form {
	display: grid;
	gap: 24px;
	max-width: 720px;
	padding: var(--content-padding);
}
.field {
	display: grid;
	gap: 8px;
}
.actions {
	display: flex;
	gap: 8px;
}
</style>
