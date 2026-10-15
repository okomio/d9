<template>
	<users-item v-if="!isVirtual" :primary-key="primaryKey" :role="role" />
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { getNamespaceRuntime } from '@/namespaces/live';
import { useRouter } from 'vue-router';
import UsersItem from './item.vue';

defineProps<{ primaryKey: string; role?: string | null }>();
const isVirtual = computed(() => getNamespaceRuntime()?.state.active?.namespace.kind === 'virtual');
const router = useRouter();

// A child membership is not a shared user profile; direct item/create links must never mount the native editor.
watch(
	isVirtual,
	(value) => {
		if (value) void router.replace('/users');
	},
	{ immediate: true }
);
</script>
