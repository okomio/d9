<template>
	<div class="member-search" :class="{ expanded: focused || !!modelValue, filtered: !!status }" @click="focusInput">
		<v-icon name="search" class="search-icon" />
		<input
			ref="input"
			:value="modelValue"
			:placeholder="t('search_items')"
			@focus="focused = true"
			@blur="focused = false"
			@input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
		/>
		<v-icon v-if="modelValue" name="close" class="clear-icon" clickable @click.stop="$emit('update:modelValue', '')" />
		<v-menu show-arrow placement="bottom-end">
			<template #activator="{ toggle }">
				<v-icon v-tooltip.bottom="t('filter')" name="filter_list" class="filter-icon" clickable @click.stop="toggle" />
			</template>
			<v-list>
				<v-list-item
					v-for="option in statuses"
					:key="option.value ?? 'all'"
					clickable
					:active="status === option.value"
					@click="$emit('update:status', option.value)"
				>
					<v-list-item-content>{{ option.text }}</v-list-item-content>
				</v-list-item>
			</v-list>
		</v-menu>
	</div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

defineProps<{ modelValue: string; status: string | null }>();

defineEmits<{
	(event: 'update:modelValue', value: string): void;
	(event: 'update:status', value: string | null): void;
}>();

const { t } = useI18n();
const input = ref<HTMLInputElement | null>(null);
const focused = ref(false);

const statuses = [
	{ text: 'All statuses', value: null },
	{ text: 'Active', value: 'active' },
	{ text: 'Invited', value: 'invited' },
	{ text: 'Suspended', value: 'suspended' },
];

function focusInput() {
	input.value?.focus();
}
</script>

<style scoped lang="scss">
.member-search {
	display: flex;
	align-items: center;
	width: 72px;
	max-width: 100%;
	height: 44px;
	overflow: hidden;
	border: 2px solid var(--border-normal);
	border-radius: 22px;
	transition: width var(--slow) var(--transition);

	&.expanded {
		width: 300px;
	}
	&.filtered {
		border-color: var(--primary);
	}
	&:hover {
		border-color: var(--border-normal-alt);
	}
	.search-icon {
		margin: 0 4px 0 8px;
	}
	.filter-icon {
		margin: 0 8px 0 0;
	}
	.clear-icon {
		margin: 0 4px;
	}
	input {
		flex: 1;
		width: 0;
		min-width: 0;
		height: 100%;
		color: var(--foreground-normal);
		background: var(--background-page);
		border: 0;
		outline: 0;
		&::placeholder {
			color: var(--foreground-subdued);
		}
	}
}
</style>
