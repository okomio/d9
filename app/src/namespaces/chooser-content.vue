<template>
	<div class="area-chooser">
		<div class="chooser-heading">
			<h1>Choose an area</h1>
			<v-button secondary small :disabled="loading || busy" @click="$emit('refresh')">
				<v-icon name="refresh" small />
				Refresh
			</v-button>
		</div>
		<p class="description">Switching areas changes the whole CMS. Your role may differ in each area.</p>
		<v-input
			v-if="choices.length > 5"
			v-model="search"
			type="search"
			placeholder="Search areas"
			aria-label="Search areas"
		/>
		<p v-if="loading" class="message" role="status">Loading areas…</p>
		<p v-else-if="error" class="message" role="alert">Could not load areas. Use Refresh to try again.</p>
		<p v-else-if="!choices.length" class="message">
			{{ emptyMessage ?? 'No areas available. Ask a global admin to grant you a role.' }}
		</p>
		<p v-else-if="!visibleChoices.length" class="message">No areas match your search.</p>
		<div v-if="!loading && !error && visibleChoices.length" class="area-list" aria-label="Available areas">
			<button
				v-for="choice in visibleChoices"
				:key="choice.namespace.id"
				class="area-card"
				:class="{ current: choice.namespace.id === activeId }"
				type="button"
				:disabled="busy || choice.namespace.id === activeId || !isEnterableChild(choice)"
				:aria-label="`${choice.namespace.name}, ${roleLabel(choice)}${
					choice.namespace.id === activeId ? ', current area' : ''
				}${!isEnterableChild(choice) ? ', unavailable' : ''}`"
				@click="$emit('select', choice.namespace.id)"
			>
				<span class="identity">
					<strong>{{ choice.namespace.name }}</strong>
					<span class="machine-name">{{ choice.namespace.id }}</span>
				</span>
				<span class="role-pill">{{ roleLabel(choice) }}</span>
				<v-icon v-if="choice.namespace.id === activeId" class="current-check" name="check" />
			</button>
		</div>
		<p v-if="!loading && !error && choices.length" class="footer">
			{{ choices.length }} {{ choices.length === 1 ? 'area' : 'areas' }}
			<span v-if="busy">· Switching area…</span>
		</p>
	</div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { isEnterableChild } from './choices';
import type { AuthorizedNamespaceChoice } from './types';

const props = defineProps<{
	choices: readonly AuthorizedNamespaceChoice[];
	activeId: string | null;
	globalAdmin: boolean;
	loading: boolean;
	busy: boolean;
	error: boolean;
	emptyMessage?: string;
}>();

defineEmits<{ (event: 'refresh'): void; (event: 'select', id: string): void }>();

const search = ref('');

const visibleChoices = computed(() => {
	const query = search.value.trim().toLocaleLowerCase();
	if (!query) return props.choices;
	return props.choices.filter((choice) =>
		`${choice.namespace.name} ${choice.namespace.id}`.toLocaleLowerCase().includes(query)
	);
});

function roleLabel(choice: AuthorizedNamespaceChoice): string {
	if (choice.namespace.readiness === 'provisioning') return 'Provisioning';
	if (choice.namespace.readiness === 'failed') return 'Unavailable';
	if (!choice.access.canUseApp) return 'API access only';
	if (props.globalAdmin && choice.access.isNamespaceAdmin) return 'Global Admin';
	return choice.access.localRole?.name ?? (choice.access.isNamespaceAdmin ? 'Admin' : 'Member');
}
</script>

<style lang="scss" scoped>
.area-chooser {
	box-sizing: border-box;
	width: 100%;
	padding: 32px;
	color: var(--foreground-normal);
}

.chooser-heading {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16px;

	h1 {
		font-size: 24px;
		line-height: 1.25;
	}

	.v-button {
		flex: none;
		--v-button-background-color: transparent;
		--v-button-background-color-hover: transparent;
	}
}

.description {
	margin: 8px 0 24px;
	color: var(--foreground-subdued);
}

.area-list {
	display: flex;
	flex-direction: column;
	gap: 10px;
	max-height: min(52vh, 520px);
	margin-top: 16px;
	overflow-y: auto;
}

.area-card {
	display: flex;
	align-items: center;
	width: 100%;
	min-height: 78px;
	padding: 16px;
	border: 1px solid var(--border-normal);
	border-radius: var(--border-radius);
	background: var(--background-normal);
	color: var(--foreground-normal);
	text-align: left;
	cursor: pointer;

	&:hover:not(:disabled),
	&:focus-visible {
		border-color: var(--primary);
	}

	&:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}

	&:disabled:not(.current) {
		opacity: 0.55;
		cursor: default;
	}

	&.current {
		border-color: var(--primary);
		background: var(--primary-10);
		cursor: default;
	}
}

.identity {
	display: flex;
	flex: 1;
	flex-direction: column;
	min-width: 0;
	padding-right: 16px;
	gap: 2px;
	word-break: break-word;
}

.machine-name {
	color: var(--foreground-subdued);
	font-family: var(--family-monospace);
	font-size: 12px;
}

.role-pill {
	flex: none;
	max-width: 40%;
	padding: 4px 10px;
	border: 1px solid var(--border-normal);
	border-radius: 999px;
	color: var(--foreground-subdued);
	font-size: 12px;
	text-align: center;
}

.current-check {
	flex: none;
	margin-left: 12px;
	color: var(--primary);
}

.message,
.footer {
	margin-top: 16px;
	color: var(--foreground-subdued);
}

@media (max-width: 600px) {
	.area-chooser {
		padding: 20px;
	}
}
</style>
