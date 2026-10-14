import { router } from '@/router';
import { watch } from 'vue';
import { dehydrate } from '@/hydrate';
import { installNamespaceToken, clearNamespaceToken } from '@/auth';
import { useAppStore } from '@/stores/app';
import { resetFolders } from '@/composables/use-folders';
import { resetContentNavigation } from '@/modules/content/composables/use-navigation';
import { resetUserNavigation } from '@/modules/users/composables/use-navigation';
import { resetTranslationStrings } from '@/composables/use-translation-strings';
import { resetScopedLocaleMessages } from '@/lang';
import { backendNamespaceAdapter } from './backend';
import { withNamespace, internalDestination } from './url';
import { createNamespaceNavigation } from './navigation';
import { createNamespaceRuntime, type NamespaceRuntime } from './runtime';

let runtime: NamespaceRuntime | null = null;
let navigation: ReturnType<typeof createNamespaceNavigation> | null = null;

/** Shared C1/C7 entry point. Both callers submit an intent to this coordinator. */
export function getNamespaceRuntime(): NamespaceRuntime | null {
	return runtime;
}

export function getNamespaceNavigation() {
	return navigation;
}

export function ensureNamespaceRuntime(): NamespaceRuntime {
	if (runtime) return runtime;

	navigation = createNamespaceNavigation({
		replace: (destination) => router.replace(destination),
		push: (destination) => router.push(destination),
	});

	runtime = createNamespaceRuntime({
		adapter: backendNamespaceAdapter,
		navigation,
		confirmDiscard: async () => window.confirm('Discard unsaved changes and switch namespace?'),
		onInstall: (grant) => installNamespaceToken(grant.accessToken, grant.expiresInMs),
		onLogout: () => {
			clearNamespaceToken();
			if (router.currentRoute.value.meta.public !== true) void router.replace('/login?reason=SESSION_EXPIRED');
		},
	});

	runtime.lifecycle.register({
		id: 'native-directus-state',
		reset: async () => {
			await dehydrate();
			resetFolders();
			resetContentNavigation();
			resetUserNavigation();
			resetTranslationStrings();
			resetScopedLocaleMessages();
			const app = useAppStore();
			app.notificationsDrawerOpen = false;
			app.fullScreen = false;
		},
	});

	watch(
		() => runtime?.state.phase,
		(phase) => {
			if (phase === 'no-access') void router.replace('/namespace/choose');

			if (phase === 'blocked' && !runtime?.snapshot.value) {
				const id = runtime?.state.active?.namespaceId;
				let recovery = '/namespace/recover';
				const next = router.currentRoute.value.query.next;

				try {
					if (typeof next === 'string') recovery += `?next=${encodeURIComponent(internalDestination(next))}`;
				} catch {
					/* Invalid saved intent is discarded. */
				}

				void router.replace(id ? withNamespace(recovery, id) : recovery);
			}
		}
	);

	return runtime;
}
