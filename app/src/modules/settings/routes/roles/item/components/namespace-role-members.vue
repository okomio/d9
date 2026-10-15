<template>
	<section class="namespace-role-members">
		<div class="field-label type-label">{{ t('fields.directus_roles.users') }}</div>

		<v-notice v-if="assignmentError || membersError" type="danger">{{ assignmentError || membersError }}</v-notice>
		<v-skeleton-loader v-else-if="loadingMembers" type="block-list-item" />
		<v-notice v-else-if="members.length === 0">{{ t('no_items') }}</v-notice>
		<v-list v-else>
			<v-list-item v-for="member in members" :key="member.user_id" block>
				{{ displayName(member) }}
				<span v-if="member.email && member.email !== displayName(member)" class="email">{{ member.email }}</span>
			</v-list-item>
		</v-list>

		<div class="actions">
			<v-button :disabled="assigning" @click="openPicker">{{ t('add_existing') }}</v-button>
			<div class="spacer" />
			<v-button v-if="members.length < total" secondary :loading="loadingMembers" @click="loadMembers">
				{{ t('interfaces.select-multiple-checkbox.show_more', { count: total - members.length }) }}
			</v-button>
		</div>

		<drawer-collection
			v-model:active="pickerOpen"
			collection="directus_users"
			multiple
			search-required
			search-hint="Enter at least two letters or digits to search existing users."
			@input="assignSelected"
		/>
	</section>
</template>

<script setup lang="ts">
import api from '@/api';
import DrawerCollection from '@/views/private/components/drawer-collection.vue';
import { itemsSourceKey } from '@wbce-d9/composables';
import { computed, onMounted, provide, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { createNamespaceUserLookupSource, type LookupCandidate } from './namespace-user-lookup';

type Person = {
	user_id: string;
	email: string | null;
	first_name: string | null;
	last_name: string | null;
};

type Member = Person & { role: { id: string } | null };

const props = defineProps<{ namespaceId: string; roleId: string }>();
const { t } = useI18n();
const members = ref<Member[]>([]);
const total = ref(0);
const loadingMembers = ref(false);
const membersError = ref<string | null>(null);
const assignmentError = ref<string | null>(null);
const pickerOpen = ref(false);
const assigning = ref(false);
const candidateMap = new Map<string, LookupCandidate>();
const excludedIds = computed(() => members.value.map((member) => member.user_id));

provide(
	itemsSourceKey,
	createNamespaceUserLookupSource(pickerOpen, excludedIds, (candidates) => {
		for (const candidate of candidates) {
			if (candidate.status === 'active') candidateMap.set(candidate.user_id, candidate);
		}
	})
);

provide('namespace-member-view', true);

let membersRequest = 0;

onMounted(() => void loadMembers());

watch(
	() => [props.namespaceId, props.roleId],
	() => void resetMembers()
);

function displayName(person: Person): string {
	return [person.first_name, person.last_name].filter(Boolean).join(' ') || person.email || person.user_id;
}

function errorMessage(error: any, fallback: string): string {
	return error?.response?.data?.errors?.[0]?.message || fallback;
}

function resetMembers() {
	membersRequest++;
	pickerOpen.value = false;
	candidateMap.clear();
	members.value = [];
	total.value = 0;
	loadingMembers.value = false;
	void loadMembers();
}

function openPicker() {
	candidateMap.clear();
	pickerOpen.value = true;
}

async function loadMembers() {
	if (loadingMembers.value) return;
	const request = ++membersRequest;
	loadingMembers.value = true;
	membersError.value = null;

	try {
		const response = await api.get<{ data: Member[]; meta: { total_count: number } }>(
			`/namespaces/${encodeURIComponent(props.namespaceId)}/members`,
			{ params: { role_id: props.roleId, limit: 50, offset: members.value.length } }
		);

		if (request !== membersRequest) return;
		members.value.push(...response.data.data);
		total.value = response.data.meta.total_count;
	} catch (error) {
		if (request === membersRequest) membersError.value = errorMessage(error, 'Could not load users in this role');
	} finally {
		if (request === membersRequest) loadingMembers.value = false;
	}
}

async function assignSelected(userIds: (string | number)[]) {
	if (assigning.value || userIds.length === 0) return;
	assigning.value = true;
	assignmentError.value = null;
	const base = `/namespaces/${encodeURIComponent(props.namespaceId)}/members`;

	try {
		for (const userId of userIds) {
			const id = String(userId);
			const candidate = candidateMap.get(id);

			if (!candidate || candidate.user_id !== id) throw new Error('Could not find the selected user');
			if (candidate.role_id === props.roleId) continue;

			if (candidate.role_id) {
				await api.patch(`${base}/${encodeURIComponent(id)}`, { role_id: props.roleId });
			} else {
				await api.post(base, { user_id: id, role_id: props.roleId });
			}
		}
	} catch (error) {
		assignmentError.value = errorMessage(
			error,
			error instanceof Error ? error.message : 'Could not add user to this role'
		);
	} finally {
		assigning.value = false;
		resetMembers();
	}
}
</script>

<style scoped>
.namespace-role-members {
	margin-top: 48px;
	max-width: 800px;
}

.field-label {
	margin-bottom: 8px;
}

.actions {
	display: flex;
	align-items: center;
	gap: var(--v-sheet-padding);
	margin-top: 8px;
}

.spacer {
	flex-grow: 1;
}

.email {
	margin-left: 8px;
	color: var(--foreground-subdued);
}
</style>
