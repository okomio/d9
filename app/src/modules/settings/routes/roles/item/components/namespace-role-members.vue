<template>
	<section class="namespace-role-members">
		<div class="heading">
			<h2>{{ t('fields.directus_roles.users') }} {{ total > 0 ? `(${total})` : '' }}</h2>
			<v-button secondary @click="openPicker">{{ t('add_existing') }}</v-button>
		</div>

		<v-notice v-if="membersError" type="danger">{{ membersError }}</v-notice>
		<p v-else-if="loadingMembers">{{ t('loading') }}</p>
		<p v-else-if="members.length === 0" class="empty">{{ t('no_users_copy') }}</p>
		<ul v-else class="members">
			<li v-for="member in members" :key="member.user_id">
				<strong>{{ displayName(member) }}</strong>
				<span v-if="member.email && member.email !== displayName(member)">{{ member.email }}</span>
			</li>
		</ul>
		<v-button v-if="members.length < total" secondary :loading="loadingMembers" @click="loadMembers">
			Load more
		</v-button>

		<v-dialog v-model="pickerOpen" @esc="pickerOpen = false">
			<v-card>
				<v-card-title>{{ t('add_existing') }}</v-card-title>
				<v-card-text>
					<div class="search">
						<v-input v-model="search" :placeholder="t('search')" @keyup.enter="loadCandidates" />
						<v-button secondary :loading="loadingCandidates" @click="loadCandidates">{{ t('search') }}</v-button>
					</div>
					<v-notice v-if="pickerError" type="danger">{{ pickerError }}</v-notice>
					<p v-else-if="loadingCandidates">{{ t('loading') }}</p>
					<p v-else-if="candidates.length === 0" class="empty">{{ t('no_results') }}</p>
					<ul v-else class="candidates">
						<li v-for="candidate in candidates" :key="candidate.user_id">
							<span>
								<strong>{{ displayName(candidate) }}</strong>
								<small v-if="candidate.email && candidate.email !== displayName(candidate)">
									{{ candidate.email }}
								</small>
							</span>
							<v-button
								secondary
								:disabled="candidate.role_id === roleId || !!assigning"
								:loading="assigning === candidate.user_id"
								@click="assign(candidate)"
							>
								{{ candidate.role_id === roleId ? 'In role' : t('add_existing') }}
							</v-button>
						</li>
					</ul>
				</v-card-text>
				<v-card-actions>
					<v-button secondary @click="pickerOpen = false">{{ t('cancel') }}</v-button>
				</v-card-actions>
			</v-card>
		</v-dialog>
	</section>
</template>

<script setup lang="ts">
import api from '@/api';
import { onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

type Person = {
	user_id: string;
	email: string | null;
	first_name: string | null;
	last_name: string | null;
};

type Member = Person & { role: { id: string } | null };
type Candidate = Person & { role_id: string | null };

const props = defineProps<{ namespaceId: string; roleId: string }>();
const { t } = useI18n();
const members = ref<Member[]>([]);
const total = ref(0);
const loadingMembers = ref(false);
const membersError = ref<string | null>(null);
const pickerOpen = ref(false);
const search = ref('');
const candidates = ref<Candidate[]>([]);
const loadingCandidates = ref(false);
const pickerError = ref<string | null>(null);
const assigning = ref<string | null>(null);
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
	members.value = [];
	total.value = 0;
	loadingMembers.value = false;
	void loadMembers();
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

function openPicker() {
	pickerOpen.value = true;
	search.value = '';
	void loadCandidates();
}

async function loadCandidates() {
	loadingCandidates.value = true;
	pickerError.value = null;

	try {
		const response = await api.get<{ data: Candidate[] }>(
			`/namespaces/${encodeURIComponent(props.namespaceId)}/members/lookup`,
			{ params: { search: search.value || undefined, limit: 20 } }
		);

		candidates.value = response.data.data;
	} catch (error) {
		pickerError.value = errorMessage(error, 'Could not find users');
	} finally {
		loadingCandidates.value = false;
	}
}

async function assign(candidate: Candidate) {
	if (candidate.role_id === props.roleId || assigning.value) return;
	assigning.value = candidate.user_id;
	pickerError.value = null;

	try {
		const base = `/namespaces/${encodeURIComponent(props.namespaceId)}/members`;

		if (candidate.role_id) {
			await api.patch(`${base}/${encodeURIComponent(candidate.user_id)}`, { role_id: props.roleId });
		} else {
			await api.post(base, { user_id: candidate.user_id, role_id: props.roleId });
		}

		pickerOpen.value = false;
		resetMembers();
	} catch (error) {
		pickerError.value = errorMessage(error, 'Could not add user to this role');
	} finally {
		assigning.value = null;
	}
}
</script>

<style scoped>
.namespace-role-members {
	margin-top: 48px;
	max-width: 800px;
}

.heading,
.search,
.candidates li {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16px;
}

.heading {
	margin-bottom: 16px;
}

.heading h2 {
	margin: 0;
	font-size: 1.25rem;
}

.members,
.candidates {
	list-style: none;
	padding: 0;
}

.members li,
.candidates li {
	padding: 12px 0;
	border-bottom: var(--border-width) solid var(--border-normal);
}

.members span,
.candidates small {
	display: block;
	color: var(--foreground-subdued);
}

.empty {
	color: var(--foreground-subdued);
}

.search {
	margin-bottom: 16px;
}
</style>
