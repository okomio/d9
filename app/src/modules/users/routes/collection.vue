<template>
	<component
		:is="layoutWrapper"
		v-if="!platform || !platformFilter"
		ref="layoutRef"
		v-slot="{ layoutState }"
		v-model:selection="selection"
		v-model:layout-options="layoutOptions"
		v-model:layout-query="directoryLayoutQuery"
		:filter="mergeFilters(virtual ? statusFilterValue : filter, roleFilter)"
		:filter-user="virtual ? statusFilterValue : filter"
		:filter-system="roleFilter"
		:search="search"
		:select-mode="virtual"
		collection="directus_users"
		:reset-preset="resetPreset"
	>
		<private-view :title="bookmark ? bookmarkTitle : title">
			<template v-if="breadcrumb" #headline>
				<v-breadcrumb :items="breadcrumb" />
			</template>

			<template #title-outer:prepend>
				<v-button class="header-icon" rounded disabled icon secondary>
					<v-icon name="people_alt" />
				</v-button>
			</template>

			<template #title-outer:append>
				<div v-if="!virtual" class="bookmark-controls">
					<bookmark-add
						v-if="!bookmark && !platform"
						v-model="bookmarkDialogActive"
						class="add"
						:saving="creatingBookmark"
						@save="createBookmark"
					>
						<template #activator="{ on }">
							<v-icon v-tooltip.right="t('create_bookmark')" class="toggle" clickable name="bookmark" @click="on" />
						</template>
					</bookmark-add>

					<v-icon v-else-if="bookmarkSaved && !platform" class="saved" name="bookmark" />

					<template v-else-if="bookmarkIsMine && !platform">
						<v-icon
							v-tooltip.bottom="t('update_bookmark')"
							class="save"
							clickable
							name="bookmark_save"
							@click="savePreset()"
						/>
					</template>

					<bookmark-add
						v-else-if="!platform"
						v-model="bookmarkDialogActive"
						class="add"
						:saving="creatingBookmark"
						@save="createBookmark"
					>
						<template #activator="{ on }">
							<v-icon class="toggle" name="bookmark_outline" clickable @click="on" />
						</template>
					</bookmark-add>

					<v-icon
						v-if="bookmark && !bookmarkSaving && bookmarkSaved === false && !platform"
						v-tooltip.bottom="t('reset_bookmark')"
						name="settings_backup_restore"
						clickable
						class="clear"
						@click="clearLocalSave"
					/>
				</div>
			</template>

			<template #actions:prepend>
				<component :is="`layout-actions-${layout}`" v-bind="layoutState" />
			</template>

			<template #actions>
				<search-input v-if="!virtual" v-model="search" v-model:filter="filter" collection="directus_users" />
				<search-input v-else v-model="search" :filter="statusFilterValue" collection="directus_users">
					<template #filter>
						<v-list>
							<v-list-item
								v-for="option in statusOptions"
								:key="option.value ?? 'all'"
								clickable
								:active="statusFilter === option.value"
								@click="statusFilter = option.value"
							>
								<v-list-item-content>{{ option.text }}</v-list-item-content>
							</v-list-item>
						</v-list>
					</template>
				</search-input>

				<v-dialog v-if="selection.length > 0 && !virtual" v-model="confirmDelete" @esc="confirmDelete = false">
					<template #activator="{ on }">
						<v-button
							v-tooltip.bottom="batchDeleteAllowed ? t('delete_label') : t('not_allowed')"
							:disabled="batchDeleteAllowed !== true"
							rounded
							icon
							class="action-delete"
							secondary
							@click="on"
						>
							<v-icon name="delete" />
						</v-button>
					</template>

					<v-card>
						<v-card-title>{{ t('batch_delete_confirm', selection.length) }}</v-card-title>

						<v-card-actions>
							<v-button secondary @click="confirmDelete = false">
								{{ t('cancel') }}
							</v-button>
							<v-button kind="danger" :loading="deleting" @click="batchDelete">
								{{ t('delete_label') }}
							</v-button>
						</v-card-actions>
					</v-card>
				</v-dialog>

				<v-button
					v-if="selection.length > 0 && !platform && !virtual"
					v-tooltip.bottom="batchEditAllowed ? t('edit') : t('not_allowed')"
					rounded
					icon
					secondary
					:disabled="batchEditAllowed === false"
					@click="batchEditActive = true"
				>
					<v-icon name="edit" />
				</v-button>

				<v-button
					v-if="virtual && selection.length > 0"
					v-tooltip.bottom="'Change local role'"
					rounded
					icon
					secondary
					@click="memberDialogs?.openRole()"
				>
					<v-icon name="edit" />
				</v-button>
				<v-button
					v-if="virtual && selection.length > 0"
					v-tooltip.bottom="'Remove from namespace'"
					rounded
					icon
					secondary
					@click="memberDialogs?.openRemove()"
				>
					<v-icon name="person_remove" />
				</v-button>

				<v-button
					v-if="canInviteUsers && !platform && !virtual"
					v-tooltip.bottom="t('invite_users')"
					rounded
					icon
					secondary
					@click="userInviteModalActive = true"
				>
					<v-icon name="person_add" />
				</v-button>

				<v-button
					v-if="platform"
					v-tooltip.bottom="t('invite_users')"
					rounded
					icon
					secondary
					@click="userInviteModalActive = true"
				>
					<v-icon name="person_add" />
				</v-button>

				<v-button v-if="virtual" v-tooltip.bottom="'Add existing user'" rounded icon @click="memberDialogs?.openAdd()">
					<v-icon name="add" />
				</v-button>
				<v-button
					v-else
					v-tooltip.bottom="platform ? 'Create User (D14)' : createAllowed ? t('create_item') : t('not_allowed')"
					rounded
					icon
					:to="platform ? { path: '/global-admin/users/new', query: { admin_ns: $route.query.admin_ns } } : addNewLink"
					:disabled="!platform && createAllowed === false"
				>
					<v-icon name="add" />
				</v-button>
			</template>

			<template #navigation>
				<global-navigation v-if="platform" />
				<users-navigation v-else :current-role="role" current-collection="directus_users" :virtual="virtual" />
			</template>

			<v-info
				v-if="bookmark && bookmarkExists === false"
				type="warning"
				:title="t('bookmark_doesnt_exist')"
				icon="bookmark"
				center
			>
				{{ t('bookmark_doesnt_exist_copy') }}

				<template #append>
					<v-button to="/users">
						{{ t('bookmark_doesnt_exist_cta') }}
					</v-button>
				</template>
			</v-info>

			<users-invite
				v-if="canInviteUsers && !platform && !virtual"
				v-model="userInviteModalActive"
				@update:model-value="refresh"
			/>
			<namespace-member-dialogs
				v-if="virtual"
				ref="memberDialogs"
				:selection="selection"
				:selected-role-id="selectedRoleId"
				@refresh="refresh"
				@clear-selection="selection = []"
			/>
			<users-invite
				v-if="platform"
				v-model="userInviteModalActive"
				platform
				:initial-namespace-id="typeof $route.query.admin_ns === 'string' ? $route.query.admin_ns : null"
				:initial-role-id="typeof $route.query.admin_role === 'string' ? $route.query.admin_role : null"
			/>

			<component :is="`layout-${layout}`" v-bind="layoutState">
				<template #no-results>
					<v-info
						v-if="!(virtual ? statusFilterValue : filter) && !search && !role"
						:title="t('user_count', 0)"
						icon="people_alt"
						center
					>
						{{ t('no_users_copy') }}

						<template v-if="virtual" #append>
							<v-button @click="memberDialogs?.openAdd()">Add existing user</v-button>
						</template>
						<template v-else-if="canInviteUsers || platform" #append>
							<v-button
								:to="
									platform
										? '/global-admin/users/new'
										: role
										? { path: `/users/roles/${role}/+` }
										: { path: '/users/+' }
								"
							>
								{{ t('create_user') }}
							</v-button>
						</template>
					</v-info>

					<v-info v-else :title="t('no_results')" icon="search" center>
						{{ t('no_results_copy') }}

						<template #append>
							<v-button @click="clearFilters">{{ t('clear_filters') }}</v-button>
						</template>
					</v-info>
				</template>

				<template #no-items>
					<v-info :title="t('user_count', 0)" icon="people_alt" center>
						{{ t('no_users_copy') }}

						<template v-if="virtual" #append>
							<v-button @click="memberDialogs?.openAdd()">Add existing user</v-button>
						</template>
						<template v-else-if="canInviteUsers || platform" #append>
							<v-button
								:to="
									platform
										? '/global-admin/users/new'
										: role
										? { path: `/users/roles/${role}/+` }
										: { path: '/users/+' }
								"
							>
								{{ t('create_user') }}
							</v-button>
						</template>
					</v-info>
				</template>
			</component>

			<drawer-batch
				v-if="!platform && !virtual"
				v-model:active="batchEditActive"
				:primary-keys="selection"
				collection="directus_users"
				@refresh="refresh"
			/>

			<template #sidebar>
				<sidebar-detail icon="info" :title="t('information')" close>
					<div v-if="virtual">
						Members of the active namespace. Select users to change a local role or remove access.
					</div>
					<div v-else v-md="t('page_help_users_collection')" class="page-description" />
				</sidebar-detail>
				<layout-sidebar-detail v-model="layout" :allowed-layouts="virtual ? ['cards', 'tabular'] : undefined">
					<component :is="`layout-options-${layout}`" v-bind="layoutState" />
				</layout-sidebar-detail>
				<component :is="`layout-sidebar-${layout}`" v-bind="layoutState" />
				<refresh-sidebar-detail v-model="refreshInterval" @refresh="refresh" />
				<export-sidebar-detail
					v-if="!virtual"
					collection="directus_users"
					:layout-query="layoutQuery"
					:filter="mergeFilters(filter, roleFilter)"
					:search="search"
					@refresh="refresh"
				/>
			</template>
		</private-view>
	</component>
	<filtered-users v-else />
</template>

<script lang="ts" setup>
import UsersInvite from '@/views/private/components/users-invite.vue';
import { computed, provide, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import UsersNavigation from '../components/navigation.vue';
import NamespaceMemberDialogs from '../components/namespace-member-dialogs.vue';
import { namespaceMemberItemsSource } from '../composables/use-namespace-member-items';
import { itemsSourceKey } from '@wbce-d9/composables';
import GlobalNavigation from '@/namespaces/global-admin/navigation.vue';
import FilteredUsers from '@/namespaces/global-admin/filtered-users.vue';
import { useRoute } from 'vue-router';

import api from '@/api';
import { usePreset } from '@/composables/use-preset';
import { usePermissionsStore } from '@/stores/permissions';
import { useServerStore } from '@/stores/server';
import { useUserStore } from '@/stores/user';
import { unexpectedError } from '@/utils/unexpected-error';
import DrawerBatch from '@/views/private/components/drawer-batch.vue';
import LayoutSidebarDetail from '@/views/private/components/layout-sidebar-detail.vue';
import RefreshSidebarDetail from '@/views/private/components/refresh-sidebar-detail.vue';
import SearchInput from '@/views/private/components/search-input.vue';
import { useLayout } from '@wbce-d9/composables';
import { Role } from '@wbce-d9/types';
import { mergeFilters } from '@wbce-d9/utils';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import useNavigation from '../composables/use-navigation';
import { useRouter } from 'vue-router';
import BookmarkAdd from '@/views/private/components/bookmark-add.vue';

interface Props {
	role?: string | null;
	bookmark?: string | null;
	platform?: boolean;
	virtual?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
	role: null,
	bookmark: null,
	platform: false,
	virtual: false,
});

if (props.virtual) provide(itemsSourceKey, namespaceMemberItemsSource);
if (props.virtual) provide('namespace-member-view', true);

const route = useRoute();

const platformFilter = computed(
	() => props.platform && (typeof route.query.admin_ns === 'string' || typeof route.query.admin_role === 'string')
);

const { t } = useI18n();

const { roles } = useNavigation();
const userInviteModalActive = ref(false);
const userStore = useUserStore();
const permissionsStore = usePermissionsStore();
const serverStore = useServerStore();

const layoutRef = ref();
const memberDialogs = ref<InstanceType<typeof NamespaceMemberDialogs> | null>(null);
const selection = ref<string[]>([]);

const selectedRoleId = computed<string | null>(() => {
	if (selection.value.length !== 1) return null;
	return (
		layoutRef.value?.state?.items?.find((item: { id: string }) => item.id === selection.value[0])?.local_role_id ?? null
	);
});

const statusFilter = ref<string | null>(null);
const statusFilterValue = computed(() => (statusFilter.value ? { status: { _eq: statusFilter.value } } : null));

const statusOptions = [
	{ text: 'All statuses', value: null },
	{ text: 'Active', value: 'active' },
	{ text: 'Invited', value: 'invited' },
	{ text: 'Suspended', value: 'suspended' },
];

const router = useRouter();

watch(
	() => route.query.invite,
	(invite) => {
		if (props.platform && invite === '1') userInviteModalActive.value = true;
	},
	{ immediate: true }
);

watch(userInviteModalActive, (open) => {
	if (props.platform && !open && route.query.invite === '1') {
		const query = { ...route.query };
		delete query.invite;
		void router.replace({ query });
	}
});

const bookmark = computed(() => (props?.bookmark ? +props.bookmark : null));

const {
	layout,
	layoutOptions,
	layoutQuery,
	filter,
	search,
	savePreset,
	bookmarkExists,
	saveCurrentAsBookmark,
	bookmarkTitle,
	resetPreset,
	bookmarkSaved,
	bookmarkIsMine,
	refreshInterval,
	busy: bookmarkSaving,
	clearLocalSave,
} = usePreset(ref('directus_users'), bookmark);

if (props.virtual && !['cards', 'tabular'].includes(layout.value ?? '')) layout.value = 'cards';

// The member API returns only identity fields; keep native pagination and layout
// settings while excluding fields that require shared-profile reads.
const directoryLayoutQuery = computed({
	get() {
		if (!props.virtual) return layoutQuery.value;

		const saved = layoutQuery.value ?? {};
		const sortable = ['id', 'email', 'first_name', 'last_name', 'status'];

		const sort =
			Array.isArray(saved.sort) && sortable.includes(String(saved.sort[0]).replace(/^-/, '')) ? saved.sort : ['email'];

		if (layout.value !== 'tabular') return { ...saved, sort };

		const allowed = ['first_name', 'last_name', 'email', 'status'];

		const fields = Array.isArray(saved.fields)
			? saved.fields.filter((field: string) => allowed.includes(field))
			: allowed;

		return {
			...saved,
			sort,
			fields: fields.length ? fields : allowed,
		};
	},
	set(query) {
		layoutQuery.value = query;
	},
});

watch(
	() => props.virtual,
	() => {
		selection.value = [];
		statusFilter.value = null;
	}
);

const { addNewLink } = useLinks();

const { confirmDelete, deleting, batchDelete, batchEditActive } = useBatch();

const { bookmarkDialogActive, creatingBookmark, createBookmark } = useBookmarks();

const { breadcrumb, title } = useBreadcrumb();

const roleFilter = computed(() => {
	if (props.role !== null) {
		return {
			_and: [
				{
					role: {
						_eq: props.role,
					},
				},
			],
		};
	}

	return null;
});

const canInviteUsers = computed(() => {
	if (serverStore.auth.disableDefault === true) return false;

	const isAdmin = !!userStore.currentUser?.role?.admin_access;
	if (isAdmin) return true;

	const usersCreatePermission = permissionsStore.permissions.find(
		(permission) => permission.collection === 'directus_users' && permission.action === 'create'
	);

	const rolesReadPermission = permissionsStore.permissions.find(
		(permission) => permission.collection === 'directus_roles' && permission.action === 'read'
	);

	return !!usersCreatePermission && !!rolesReadPermission;
});

const { layoutWrapper } = useLayout(layout);

const { batchEditAllowed, batchDeleteAllowed, createAllowed } = usePermissions();

onBeforeRouteLeave(() => {
	selection.value = [];
});

onBeforeRouteUpdate(() => {
	selection.value = [];
});

async function refresh() {
	await layoutRef.value?.state?.refresh?.();
}

function useBatch() {
	const confirmDelete = ref(false);
	const deleting = ref(false);

	const batchEditActive = ref(false);

	const error = ref<any>();

	return { batchEditActive, confirmDelete, deleting, batchDelete, error };

	async function batchDelete() {
		deleting.value = true;

		const batchPrimaryKeys = selection.value;

		try {
			await api.delete('/users', {
				data: batchPrimaryKeys,
			});

			await refresh();

			selection.value = [];
			confirmDelete.value = false;
		} catch (err: any) {
			error.value = err;
			unexpectedError(err);
		} finally {
			deleting.value = false;
		}
	}
}

function useLinks() {
	const addNewLink = computed<string>(() => {
		return props.role ? `/users/roles/${props.role}/+` : '/users/+';
	});

	return { addNewLink };
}

function useBreadcrumb() {
	const breadcrumb = computed(() => {
		if (!props.role) return null;

		return [
			{
				name: t('user_directory'),
				to: `/users`,
			},
		];
	});

	const title = computed(() => {
		if (!props.role) return t('user_directory');
		return roles.value?.find((role: Role) => role.id === props.role)?.name;
	});

	return { breadcrumb, title };
}

function useBookmarks() {
	const bookmarkDialogActive = ref(false);
	const creatingBookmark = ref(false);

	return {
		bookmarkDialogActive,
		creatingBookmark,
		createBookmark,
	};

	async function createBookmark(bookmark: any) {
		creatingBookmark.value = true;

		try {
			const newBookmark = await saveCurrentAsBookmark({
				bookmark: bookmark.name,
				icon: bookmark.icon,
				color: bookmark.color,
			});

			router.push(`/users/?bookmark=${newBookmark.id}`);

			bookmarkDialogActive.value = false;
		} catch (err: any) {
			unexpectedError(err);
		} finally {
			creatingBookmark.value = false;
		}
	}
}

function clearFilters() {
	filter.value = null;
	search.value = null;
	statusFilter.value = null;
}

function usePermissions() {
	const batchEditAllowed = computed(() => {
		const admin = userStore?.currentUser?.role.admin_access === true;
		if (admin) return true;

		const updatePermissions = permissionsStore.permissions.find(
			(permission) => permission.action === 'update' && permission.collection === 'directus_users'
		);

		return !!updatePermissions;
	});

	const batchDeleteAllowed = computed(() => {
		const admin = userStore?.currentUser?.role.admin_access === true;
		if (admin) return true;

		const deletePermissions = permissionsStore.permissions.find(
			(permission) => permission.action === 'delete' && permission.collection === 'directus_users'
		);

		return !!deletePermissions;
	});

	const createAllowed = computed(() => {
		const admin = userStore?.currentUser?.role.admin_access === true;
		if (admin) return true;

		const createPermissions = permissionsStore.permissions.find(
			(permission) => permission.action === 'create' && permission.collection === 'directus_users'
		);

		return !!createPermissions;
	});

	return { batchEditAllowed, batchDeleteAllowed, createAllowed };
}
</script>

<style lang="scss" scoped>
.action-delete {
	--v-button-background-color-hover: var(--danger) !important;
	--v-button-color-hover: var(--white) !important;
}

.header-icon {
	--v-button-color-disabled: var(--foreground-normal);
}

.layout {
	--layout-offset-top: 64px;
}
.bookmark-controls {
	.add,
	.save,
	.saved,
	.clear {
		display: inline-block;
		margin-left: 8px;
	}

	.add,
	.save,
	.clear {
		cursor: pointer;
		transition: color var(--fast) var(--transition);
	}

	.add {
		color: var(--foreground-subdued);

		&:hover {
			color: var(--foreground-normal);
		}
	}

	.save {
		color: var(--warning);

		&:hover {
			color: var(--warning-125);
		}
	}

	.clear {
		margin-left: 4px;
		color: var(--foreground-subdued);

		&:hover {
			color: var(--warning);
		}
	}

	.saved {
		color: var(--primary);
	}
}
</style>
