import { setLanguage } from '@/lang/set-language';
import { getBasemapSources } from '@/utils/geometry/basemap';
import { useAppStore } from '@/stores/app';
import { useCollectionsStore } from '@/stores/collections';
import { useFieldsStore } from '@/stores/fields';
import { useLatencyStore } from '@/stores/latency';
import { useInsightsStore } from '@/stores/insights';
import { useFlowsStore } from '@/stores/flows';
import { usePermissionsStore } from '@/stores/permissions';
import { usePresetsStore } from '@/stores/presets';
import { useRelationsStore } from '@/stores/relations';
import { useRequestsStore } from '@/stores/requests';
import { useServerStore } from '@/stores/server';
import { useSettingsStore } from '@/stores/settings';
import { useUserStore } from '@/stores/user';
import { useNotificationsStore } from '@/stores/notifications';
import { useTranslationStrings } from '@/composables/use-translation-strings';
import { NamespaceError } from '@/namespaces/adapter';
import { onDehydrateExtensions, onHydrateExtensions } from './extensions';

type GenericStore = {
	$id: string;
	hydrate?: () => Promise<void>;
	dehydrate?: () => Promise<void>;

	[key: string]: any;
};

export function useStores(
	stores = [
		useCollectionsStore,
		useFieldsStore,
		useUserStore,
		useRequestsStore,
		usePresetsStore,
		useSettingsStore,
		useServerStore,
		useLatencyStore,
		useRelationsStore,
		usePermissionsStore,
		useInsightsStore,
		useFlowsStore,
		useNotificationsStore,
	]
): GenericStore[] {
	return stores.map((useStore) => useStore()) as GenericStore[];
}

export async function hydrate(options: { strict?: boolean } = {}): Promise<void> {
	const stores = useStores();

	const appStore = useAppStore();
	const userStore = useUserStore();
	const serverStore = useServerStore();
	const permissionsStore = usePermissionsStore();
	const fieldsStore = useFieldsStore();
	const { loadParsedTranslationStrings } = useTranslationStrings();

	if (appStore.hydrated) return;
	if (appStore.hydrating) return;

	appStore.hydrating = true;

	try {
		/**
		 * @NOTE
		 * Multiple stores rely on the userStore to be set, so they can fetch user specific data. The
		 * following makes sure that the user store is always fetched first, before we hydrate anything
		 * else.
		 */
		await userStore.hydrate();
		const active = options.strict ? (await import('@/namespaces/live')).getNamespaceRuntime()?.state.active : null;

		if (options.strict && userStore.currentUser && !('share' in userStore.currentUser)) {
			if (active?.namespace.kind === 'virtual') {
				// /users/me reports the shared main role. A child has a separate local role,
				// which is absent for an inherited Global Admin.
				const role = active.access.localRole;

				userStore.currentUser.role = role
					? ({
							id: role.id,
							name: role.name,
							admin_access: role.adminAccess ?? false,
							app_access: role.appAccess ?? false,
					  } as typeof userStore.currentUser.role)
					: null;
			}
		}

		let lang = 'en-US';
		if (serverStore.info?.project?.default_language) lang = serverStore.info.project.default_language;
		if (userStore.currentUser && 'language' in userStore.currentUser && userStore.currentUser.language)
			lang = userStore.currentUser.language;

		if (userStore.currentUser?.role || (active?.platform.isGlobalAdmin && active.access.canUseApp)) {
			await Promise.all([permissionsStore.hydrate(), fieldsStore.hydrate({ skipTranslation: true })]);

			const hydratedStores = ['userStore', 'permissionsStore', 'fieldsStore'];

			if (options.strict) {
				const required = ['collectionsStore', 'relationsStore', 'presetsStore'];
				await Promise.all(stores.filter(({ $id }) => required.includes($id)).map((store) => store.hydrate?.()));

				await Promise.allSettled(
					stores
						.filter(({ $id }) => !hydratedStores.includes($id) && !required.includes($id))
						.map((store) => store.hydrate?.())
				);
			} else {
				await Promise.all(stores.filter(({ $id }) => !hydratedStores.includes($id)).map((store) => store.hydrate?.()));
			}

			await onHydrateExtensions();
		}

		loadParsedTranslationStrings();
		await setLanguage(lang);

		appStore.basemap = getBasemapSources()[0].name;
	} catch (error: any) {
		if (error instanceof NamespaceError && error.kind === 'cancelled') {
			if (options.strict) throw error;
			return;
		}

		appStore.error = error;
		if (options.strict) throw error;
	} finally {
		appStore.hydrating = false;
	}

	appStore.hydrated = true;
}

export async function dehydrate(stores = useStores()): Promise<void> {
	const appStore = useAppStore();
	let failed = false;

	for (const store of stores) {
		try {
			await store.dehydrate?.();
		} catch {
			failed = true;
		}
	}

	try {
		await onDehydrateExtensions();
	} catch {
		failed = true;
	}

	appStore.hydrated = false;
	appStore.hydrating = false;
	appStore.error = null;
	if (failed) throw new Error('Namespace state reset failed');
}
