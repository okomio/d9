<template>
	<private-view class="content-overview" :title="t('content')">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="box" />
			</v-button>
		</template>

		<template #navigation>
			<content-navigation />
		</template>

		<v-info icon="box" :title="t('no_collections')" center>
			<template v-if="canCreateCollection">
				{{ t('no_collections_copy_admin') }}
			</template>

			<template v-else>
				{{ t('no_collections_copy') }}
			</template>

			<template v-if="canCreateCollection" #append>
				<v-button to="/settings/data-model/+">{{ t('create_collection') }}</v-button>
			</template>
		</v-info>

		<template #sidebar>
			<sidebar-detail icon="info" :title="t('information')" close>
				<div v-md="t('page_help_collections_overview')" class="page-description" />
			</sidebar-detail>
		</template>
	</private-view>
</template>

<script lang="ts">
import { useI18n } from 'vue-i18n';
import { defineComponent, computed } from 'vue';
import ContentNavigation from '../components/navigation.vue';
import { useUserStore } from '@/stores/user';
import { router } from '@/router';

export default defineComponent({
	name: 'ContentOverview',
	components: {
		ContentNavigation,
	},
	props: {},
	setup() {
		const { t } = useI18n();

		const userStore = useUserStore();

		const canCreateCollection = computed(() => userStore.isAdmin && router.hasRoute('settings'));

		return { t, canCreateCollection };
	},
});
</script>

<style lang="scss" scoped>
.icon {
	--v-icon-color: var(--foreground-subdued);

	:deep(i) {
		vertical-align: unset;
	}
}

.header-icon {
	--v-button-color-disabled: var(--foreground-normal);
}

.v-table {
	padding: var(--content-padding);
	padding-top: 0;
}
</style>
