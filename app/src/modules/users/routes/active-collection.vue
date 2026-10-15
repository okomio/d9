<template>
	<users-collection :key="directoryKey" :role="role" :bookmark="isVirtual ? null : bookmark" :virtual="isVirtual" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { getNamespaceRuntime } from '@/namespaces/live';
import UsersCollection from './collection.vue';

defineProps<{ role?: string | null; bookmark?: string | null }>();
const isVirtual = computed(() => getNamespaceRuntime()?.state.active?.namespace.kind === 'virtual');

const directoryKey = computed(
	() => `${isVirtual.value ? 'virtual' : 'native'}:${getNamespaceRuntime()?.state.active?.namespaceId ?? 'main'}`
);
</script>
