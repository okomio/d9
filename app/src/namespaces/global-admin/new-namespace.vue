<template>
	<private-view title="Create Namespace">
		<template #headline>
			<v-breadcrumb :items="[{ name: 'Virtual Namespaces', to: '/global-admin/namespaces' }]" />
		</template>
		<template #navigation><global-navigation /></template>
		<template #sidebar>
			<sidebar-detail icon="info" title="Backend dependency" close>
				D06 must provide platform namespace creation, status, validation, and recovery. Creating a namespace will not
				switch the active content namespace.
			</sidebar-detail>
		</template>
		<div class="form">
			<v-notice type="warning">Submission is unavailable until D06. No namespace will be created.</v-notice>
			<div class="field">
				<label>Namespace name</label>
				<v-input v-model="name" />
			</div>
			<div class="field">
				<label>Namespace ID</label>
				<v-input v-model="id" />
			</div>
			<div class="actions">
				<v-button to="/global-admin/namespaces" secondary>Cancel</v-button>
				<v-button disabled>Create Namespace</v-button>
			</div>
		</div>
	</private-view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import GlobalNavigation from './navigation.vue';

const name = ref('');
const id = ref('');
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
