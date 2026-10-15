<template>
	<namespace-collection v-if="isVirtual" :role="role" />
	<users-collection v-else :role="role" :bookmark="bookmark" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { getNamespaceRuntime } from '@/namespaces/live';
import UsersCollection from './collection.vue';
import NamespaceCollection from './namespace-collection.vue';

defineProps<{ role?: string | null; bookmark?: string | null }>();
const isVirtual = computed(() => getNamespaceRuntime()?.state.active?.namespace.kind === 'virtual');
</script>
