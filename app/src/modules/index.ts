import { router } from '@/router';
import { usePermissionsStore } from '@/stores/permissions';
import { useUserStore } from '@/stores/user';
import RouterPass from '@/utils/router-passthrough';
import { ModuleConfig } from '@wbce-d9/types';
import { ShallowRef, shallowRef } from 'vue';
import { sortBy } from 'lodash';
import { getNamespaceRuntime } from '@/namespaces/live';

export function getInternalModules(): ModuleConfig[] {
	const modules = import.meta.glob<ModuleConfig>('./*/index.ts', { import: 'default', eager: true });

	return sortBy(Object.values(modules), 'id');
}

export function registerModules(modules: ModuleConfig[]): {
	registeredModules: ShallowRef<ModuleConfig[]>;
	onHydrateModules: () => Promise<void>;
	onDehydrateModules: () => Promise<void>;
} {
	const registeredModules = shallowRef<ModuleConfig[]>([]);

	const onHydrateModules = async () => {
		const userStore = useUserStore();
		const permissionsStore = usePermissionsStore();

		if (!userStore.currentUser || 'share' in userStore.currentUser) return;
		const currentUser = userStore.currentUser;

		registeredModules.value = (
			await Promise.all(
				modules.map(async (module) => {
					const active = getNamespaceRuntime()?.state.active;
					// These native modules require child-scoped backend reads/actions before they are safe to expose.
					if (active?.namespace.kind === 'virtual' && ['users', 'files', 'settings', 'activity'].includes(module.id))
						return null;
					if (!module.preRegisterCheck) return module;

					const allowed = await module.preRegisterCheck(currentUser, permissionsStore.permissions);

					if (allowed) return module;

					return null;
				})
			)
		).filter((module): module is ModuleConfig => module !== null);

		for (const module of registeredModules.value) {
			router.addRoute({
				name: module.id,
				path: `/${module.id}`,
				component: RouterPass,
				children: module.routes,
			});
		}
	};

	const onDehydrateModules = async () => {
		for (const module of modules) {
			router.removeRoute(module.id);
		}

		registeredModules.value = [];
	};

	return { registeredModules, onHydrateModules, onDehydrateModules };
}
