<template>
	<v-dialog
		:model-value="modelValue"
		@update:model-value="$emit('update:modelValue', $event)"
		@esc="$emit('update:modelValue', false)"
	>
		<v-card :class="{ 'platform-invite': platform }">
			<v-card-title>{{ t('invite_users') }}</v-card-title>

			<v-card-text>
				<div class="grid">
					<div class="field">
						<div class="type-label">{{ t('emails') }}</div>
						<v-textarea v-model="emails" :nullable="false" placeholder="admin@example.com, user@example.com..." />
					</div>
					<div v-if="!platform && role === null" class="field">
						<div class="type-label">{{ t('role') }}</div>
						<v-select v-model="roleSelected" :items="roles" />
					</div>
					<template v-if="platform">
						<div v-for="(assignment, index) in assignments" :key="assignment.key" class="assignment">
							<div class="field">
								<div class="type-label">Virtual namespace</div>
								<v-select
									:model-value="assignment.namespaceId"
									:items="namespaceItems"
									@update:model-value="selectNamespace(assignment, $event)"
								/>
							</div>
							<div class="field">
								<div class="type-label">{{ t('role') }}</div>
								<v-select
									v-model="assignment.roleId"
									:items="assignment.roles"
									:disabled="!assignment.namespaceId || assignment.loading || assignment.roles.length === 0"
								/>
							</div>
							<v-button v-if="assignments.length > 1" secondary icon :aria-label="`Remove namespace ${index + 1}`" @click="removeAssignment(index)">
								<v-icon name="close" />
							</v-button>
							<div v-if="assignment.error" class="assignment-error">{{ assignment.error }}</div>
						</div>
						<v-button class="add-namespace" secondary @click="addAssignment">Add namespace</v-button>
						<v-notice class="field" type="warning">Invitations with namespace access are not available yet.</v-notice>
					</template>
					<v-notice v-if="uniqueValidationErrors.length > 0" class="field" type="danger">
						<div v-for="(err, i) in uniqueValidationErrors" :key="i">
							<template v-if="err.extensions.invalid">
								{{ t('email_already_invited', { email: err.extensions.invalid }) }}
							</template>
							<template v-else-if="i === 0">
								{{ t('validationError.unique') }}
							</template>
						</div>
					</v-notice>
				</div>
			</v-card-text>

			<v-card-actions>
				<v-button secondary @click="$emit('update:modelValue', false)">{{ t('cancel') }}</v-button>
				<v-button :disabled="platform || emails === null || emails.length === 0" :loading="loading" @click="inviteUsers">
					{{ t('invite') }}
				</v-button>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script lang="ts">
import { useI18n } from 'vue-i18n';
import { computed, defineComponent, onBeforeUnmount, ref, watch } from 'vue';
import api from '@/api';
import { ensureNamespaceRuntime } from '@/namespaces/live';
import { unexpectedError } from '@/utils/unexpected-error';
import { APIError } from '@/types/error';

type RoleOption = { text: string; value: string };
type Assignment = {
	key: number;
	namespaceId: string | null;
	roleId: string | null;
	roles: RoleOption[];
	loading: boolean;
	error: string | null;
	controller: AbortController | null;
};

export default defineComponent({
	props: {
		modelValue: {
			type: Boolean,
			default: false,
		},
		role: {
			type: String,
			default: null,
		},
		platform: {
			type: Boolean,
			default: false,
		},
		initialNamespaceId: {
			type: String,
			default: null,
		},
		initialRoleId: {
			type: String,
			default: null,
		},
	},
	emits: ['update:modelValue'],
	setup(props, { emit }) {
		const { t } = useI18n();

		const emails = ref<string>('');
		const roles = ref<Record<string, any>[]>([]);
		const roleSelected = ref<string | null>(props.role);
		const loading = ref(false);
		const runtime = props.platform ? ensureNamespaceRuntime() : null;
		let nextKey = 0;
		const assignments = ref<Assignment[]>([]);
		const namespaceItems = computed(() =>
			(runtime?.state.choices ?? [])
				.filter((choice) => choice.namespace.kind === 'virtual' && choice.namespace.readiness === 'ready')
				.map((choice) => ({ text: choice.namespace.name, value: choice.namespace.id }))
		);

		const uniqueValidationErrors = ref([]);

		watch(
			() => props.modelValue,
			(open) => {
				if (!open) {
					assignments.value.forEach((assignment) => assignment.controller?.abort());
					return;
				}
				if (props.platform) {
					assignments.value = [newAssignment()];
					const initial = props.initialNamespaceId;
					if (initial && namespaceItems.value.some((item) => item.value === initial))
						void selectNamespace(assignments.value[0]!, initial);
				} else {
					void loadRoles();
				}
			}
		);

		onBeforeUnmount(() => assignments.value.forEach((assignment) => assignment.controller?.abort()));

		return {
			t,
			emails,
			inviteUsers,
			roles,
			roleSelected,
			loading,
			uniqueValidationErrors,
			assignments,
			namespaceItems,
			addAssignment,
			removeAssignment,
			selectNamespace,
		};

		function newAssignment(): Assignment {
			return {
				key: ++nextKey,
				namespaceId: null,
				roleId: null,
				roles: [],
				loading: false,
				error: null,
				controller: null,
			};
		}

		function addAssignment() {
			assignments.value.push(newAssignment());
		}

		function removeAssignment(index: number) {
			assignments.value[index]?.controller?.abort();
			assignments.value.splice(index, 1);
		}

		async function selectNamespace(assignment: Assignment, namespaceId: string | null) {
			assignment.controller?.abort();
			assignment.namespaceId = null;
			assignment.roleId = null;
			assignment.roles = [];
			assignment.error = null;
			assignment.loading = false;
			if (!namespaceId) return;
			if (assignments.value.some((other) => other !== assignment && other.namespaceId === namespaceId)) {
				assignment.error = 'This namespace is already selected.';
				return;
			}
			assignment.namespaceId = namespaceId;
			if (runtime?.state.active?.namespaceId !== namespaceId) {
				assignment.error = 'Roles will be available when this namespace can be loaded.';
				return;
			}

			const request = new AbortController();
			assignment.controller = request;
			assignment.loading = true;
			try {
				const response = await api.get<{ data: { id: string; name: string }[] }>('/roles', {
					params: { fields: ['id', 'name'], sort: 'name', limit: -1 },
					signal: request.signal,
				});
				if (request.signal.aborted || assignment.namespaceId !== namespaceId) return;
				assignment.roles = response.data.data.map((role) => ({ text: role.name, value: role.id }));
				if (
					assignment === assignments.value[0] &&
					namespaceId === props.initialNamespaceId &&
					assignment.roles.some((role) => role.value === props.initialRoleId)
				)
					assignment.roleId = props.initialRoleId;
			} catch {
				if (!request.signal.aborted) assignment.error = 'Could not load roles from this namespace.';
			} finally {
				if (!request.signal.aborted) assignment.loading = false;
			}
		}

		async function inviteUsers() {
			if (props.platform) return;
			loading.value = true;

			try {
				const emailsParsed = emails.value
					.split(/,|\n/)
					.filter((e) => e)
					.map((email) => email.trim());

				await api.post('/users/invite', {
					email: emailsParsed,
					role: roleSelected.value,
				});

				emails.value = '';
				emit('update:modelValue', false);
			} catch (err: any) {
				uniqueValidationErrors.value = err?.response?.data?.errors?.filter((error: APIError) => {
					return error.extensions?.code === 'RECORD_NOT_UNIQUE';
				});

				const otherErrors = err?.response?.data?.errors?.filter(
					(err: APIError) => err?.extensions?.code !== 'RECORD_NOT_UNIQUE'
				);

				if (otherErrors.length > 0) {
					otherErrors.forEach((err: APIError) => unexpectedError(err));
				}
			} finally {
				loading.value = false;
			}
		}

		async function loadRoles() {
			const response = await api.get('/roles', {
				params: {
					sort: 'name',
					fields: ['id', 'name'],
				},
			});

			roles.value = response.data.data.map((role: Record<string, any>) => ({
				text: role.name,
				value: role.id,
			}));

			if (roles.value.length > 0 && roleSelected.value === null) {
				roleSelected.value = roles.value[0].value;
			}
		}
	},
});
</script>

<style lang="scss" scoped>
@import '@/styles/mixins/form-grid';

.grid {
	--form-vertical-gap: 20px;

	@include form-grid;
}

.v-card-title {
	font-size: 20px;
}

.platform-invite .v-card-text {
	max-height: calc(90vh - 144px);
	overflow-y: auto;
}

.assignment,
.add-namespace {
	grid-column: start / full;
}

.assignment {
	min-width: 0;

	.field + .field {
		margin-top: 20px;
	}

	& + .assignment {
		padding-top: 20px;
		border-top: 1px solid var(--border-subdued);
	}

	.v-button {
		margin-top: 12px;
	}
}

.assignment-error {
	margin-top: 8px;
	color: var(--danger);
}

.add-namespace {
	justify-self: start;
}
</style>
