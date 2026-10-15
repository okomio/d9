import { refresh } from '@/auth';
import { hydrate } from '@/hydrate';
import { namespaceFrontendEnabled } from '@/namespaces/enabled';
import { allowedDestination } from '@/namespaces/choices';
import TFASetup from '@/routes/tfa-setup.vue';
import AcceptInviteRoute from '@/routes/accept-invite.vue';
import LoginRoute from '@/routes/login/login.vue';
import LogoutRoute from '@/routes/logout.vue';
import ShareRoute from '@/routes/shared/shared.vue';
import PrivateNotFoundRoute from '@/routes/private-not-found.vue';
import ResetPasswordRoute from '@/routes/reset-password/reset-password.vue';
import { useAppStore } from '@/stores/app';
import { useServerStore } from '@/stores/server';
import { useUserStore } from '@/stores/user';
import { ensureNamespaceRuntime, getNamespaceNavigation, getNamespaceRuntime } from '@/namespaces/live';
import {
	requestedNamespace,
	withNamespace,
	loginRedirect,
	navigationKey,
	internalDestination,
	destinationAfterLogin,
} from '@/namespaces/url';
import { NamespaceError } from '@/namespaces/adapter';
import { canManagePlatformResource } from '@/namespaces/capabilities';
import { getRootPath } from '@/utils/get-root-path';
import { createRouter, createWebHistory, NavigationGuard, NavigationHookAfter, RouteRecordRaw } from 'vue-router';

export const defaultRoutes: RouteRecordRaw[] = [
	{
		path: '/',
		redirect: '/login',
	},
	{
		name: 'login',
		path: '/login',
		component: LoginRoute,
		props: (route) => ({
			ssoErrorCode: route.query.error ? route.query.code : null,
			logoutReason: route.query.reason,
		}),
		meta: {
			public: true,
		},
	},
	{
		name: 'reset-password',
		path: '/reset-password',
		component: ResetPasswordRoute,
		meta: {
			public: true,
		},
	},
	{
		name: 'accept-invite',
		path: '/accept-invite',
		component: AcceptInviteRoute,
		meta: {
			public: true,
		},
	},
	{
		name: 'tfa-setup',
		path: '/tfa-setup',
		component: TFASetup,
		meta: {
			track: false,
		},
	},
	{
		name: 'logout',
		path: '/logout',
		component: LogoutRoute,
		meta: {
			public: true,
		},
	},
	{
		name: 'shared',
		path: '/shared/:id([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',
		component: ShareRoute,
		meta: {
			public: true,
		},
	},
	{
		name: 'private-404',
		path: '/:_(.+)+',
		component: PrivateNotFoundRoute,
	},
	{
		name: 'namespace-loading',
		path: '/namespace/loading',
		component: () => import('@/namespaces/static-route.vue'),
		props: { mode: 'loading' },
		meta: { track: false },
	},
	{
		name: 'namespace-choose',
		path: '/namespace/choose',
		component: () => import('@/namespaces/static-route.vue'),
		props: { mode: 'choose' },
		meta: { track: false },
	},
	{
		name: 'namespace-recover',
		path: '/namespace/recover',
		component: () => import('@/namespaces/static-route.vue'),
		props: { mode: 'recover' },
		meta: { track: false },
	},
	{
		name: 'namespace-landing',
		path: '/namespace',
		component: () => import('@/namespaces/static-route.vue'),
		props: { mode: 'landing' },
		meta: { track: false },
	},
	{
		name: 'global-admin-home',
		path: '/global-admin',
		redirect: (to) => ({ path: '/global-admin/users', query: to.query }),
		meta: { namespacePlatform: true, track: false },
	},
	{
		name: 'global-admin-users',
		path: '/global-admin/users',
		component: () => import('@/modules/users/routes/collection.vue'),
		props: { platform: true },
		meta: { namespacePlatform: true, track: false },
	},
	{
		name: 'global-admin-onboarding',
		path: '/global-admin/users/new',
		component: () => import('@/namespaces/global-admin/onboarding.vue'),
		beforeEnter: (to) => {
			if (to.query.mode !== 'invite') return true;
			const query = { ...to.query };
			delete query.mode;
			return { path: '/global-admin/users', query: { ...query, invite: '1' } };
		},
		meta: { namespacePlatform: true, track: false },
	},
	{
		name: 'global-admin-user',
		path: '/global-admin/users/:primaryKey',
		component: () => import('@/modules/users/routes/item.vue'),
		props: (route) => ({ primaryKey: route.params.primaryKey, platform: true }),
		meta: { namespacePlatform: true, track: false },
	},
	{
		name: 'global-admin-namespaces',
		path: '/global-admin/namespaces',
		component: () => import('@/namespaces/global-admin/namespaces.vue'),
		meta: { namespacePlatform: true, track: false },
	},
	{
		name: 'global-admin-namespace-new',
		path: '/global-admin/namespaces/new',
		component: () => import('@/namespaces/global-admin/new-namespace.vue'),
		meta: { namespacePlatform: true, track: false },
	},
];

export const router = createRouter({
	history: createWebHistory(getRootPath() + 'admin/'),
	routes: defaultRoutes,
});

// RouterLink uses router.resolve for its href. Canonicalize internal links here so copied
// native Directus links and links opened in a new tab retain the current namespace.
const resolveUnscoped = router.resolve.bind(router);

router.resolve = ((location: Parameters<typeof router.resolve>[0], current?: Parameters<typeof router.resolve>[1]) => {
	if (!namespaceFrontendEnabled) return resolveUnscoped(location, current);
	const namespaceId = getNamespaceRuntime()?.state.active?.namespaceId;
	if (!namespaceId) return resolveUnscoped(location, current);
	const publicPath = /^\/(?:login|logout|reset-password|accept-invite|shared|namespace)(?:\/|\?|$)/;

	if (typeof location === 'string') {
		if (!location.startsWith('/') || publicPath.test(location)) return resolveUnscoped(location, current);

		try {
			if (requestedNamespace(location)) return resolveUnscoped(location, current);
		} catch {
			return resolveUnscoped(location, current);
		}

		return resolveUnscoped(withNamespace(location, namespaceId), current);
	}

	if ('path' in location && location.path && publicPath.test(location.path)) return resolveUnscoped(location, current);
	if (
		'name' in location &&
		['login', 'logout', 'reset-password', 'accept-invite', 'shared'].includes(String(location.name))
	)
		return resolveUnscoped(location, current);
	if (location.query && 'ns' in location.query) return resolveUnscoped(location, current);
	return resolveUnscoped({ ...location, query: { ...location.query, ns: namespaceId } }, current);
}) as typeof router.resolve;

let firstLoad = true;

export const onBeforeEach: NavigationGuard = async (to) => {
	const appStore = useAppStore();
	const serverStore = useServerStore();
	const userStore = useUserStore();
	const staticNamespaceRoute = typeof to.name === 'string' && to.name.startsWith('namespace-');
	const destination = to.fullPath;
	let requested: string | null = null;

	if (namespaceFrontendEnabled) {
		try {
			const loginTarget = to.name === 'login' ? destinationAfterLogin(to.query.redirect) : null;
			requested = requestedNamespace(loginTarget ?? destination);
		} catch {
			return '/namespace/recover';
		}
	}

	// First load
	if (firstLoad) {
		firstLoad = false;

		if (to.name !== 'shared') {
			// Try retrieving a fresh access token on first load
			try {
				await refresh({ navigate: false, namespace: requested ?? undefined });
			} catch (error: any) {
				const code = error.response?.data?.errors?.[0]?.extensions?.code;

				// A denied deep link still needs a valid control-plane session to show the chooser.
				if (requested && code === 'FORBIDDEN') {
					try {
						await refresh({ navigate: false, bootstrapRetry: true });
					} catch {
						/* login route below */
					}
				}
			}
		}
	}

	if (serverStore.info.project === null) {
		try {
			await serverStore.hydrate();
		} catch (error: any) {
			if (!(error instanceof NamespaceError && error.kind === 'cancelled')) appStore.error = error;
		}
	}

	if (!namespaceFrontendEnabled) {
		if (to.meta.namespacePlatform) return '/content';
		if (staticNamespaceRoute) return '/content';
		if (to.meta.public === true) return;

		if (!appStore.hydrated) {
			appStore.hydrating = false;
			if (!appStore.authenticated) return loginRedirect(destination);
			await hydrate();
			return destination;
		}

		if (userStore.currentUser && !('share' in userStore.currentUser) && userStore.currentUser.role) {
			if (
				to.path !== '/tfa-setup' &&
				userStore.currentUser.role.enforce_tfa &&
				userStore.currentUser.tfa_secret === null
			)
				return '/tfa-setup?redirect=' + encodeURIComponent(destination);
			if (to.path === '/tfa-setup' && userStore.currentUser.tfa_secret !== null)
				return userStore.currentUser.last_page || '/login';
		}

		return;
	}

	if (to.name === 'global-admin-user' && to.params.primaryKey === '+') return '/global-admin/users/new';

	if (to.meta?.public !== true) {
		if (!appStore.authenticated) return loginRedirect(destination);

		if (staticNamespaceRoute) {
			const runtime = ensureNamespaceRuntime();

			if (!runtime.state.session) {
				window.setTimeout(() => {
					let next = '/content';

					try {
						if (typeof to.query.next === 'string') next = internalDestination(to.query.next);
					} catch {
						/* Invalid saved intent uses Content. */
					}

					if (to.name === 'namespace-loading' && requested)
						void runtime.bootstrap(withNamespace(next, requested)).catch(() => {
							void router.replace('/namespace/recover');
						});
					else
						void runtime.ensureSession().catch(() => {
							void router.replace('/namespace/recover');
						});
				}, 0);
			}

			return;
		}

		const runtime = ensureNamespaceRuntime();
		// Check a switch permit too: it must not bypass platform authority.

		const platformResource =
			to.name === 'global-admin-namespaces' || to.name === 'global-admin-namespace-new' ? 'namespaces' : 'users';

		if (
			to.meta.namespacePlatform &&
			runtime.state.session &&
			!canManagePlatformResource(runtime.state.session.platform, platformResource)
		)
			return '/namespace/choose';
		if (
			to.meta.namespacePlatform &&
			runtime.state.active &&
			!canManagePlatformResource(runtime.state.active.platform, platformResource)
		)
			return '/namespace/choose';
		if (getNamespaceNavigation()?.consumePermit(destination)) return;

		if (!runtime.state.active) {
			window.setTimeout(() => {
				void runtime
					.bootstrap(destination)
					.then(() => {
						if (runtime.state.phase === 'no-access') void router.replace('/namespace/choose');
						else if (runtime.state.phase === 'blocked')
							void router.replace(requested ? withNamespace('/namespace/recover', requested) : '/namespace/recover');
					})
					.catch(() => {
						void router.replace('/namespace/recover');
					});
			}, 0);

			const loading = `/namespace/loading?next=${encodeURIComponent(destination)}`;
			return requested ? withNamespace(loading, requested) : loading;
		}

		if (runtime.state.phase !== 'ready') return withNamespace('/namespace/recover', runtime.state.active.namespaceId);

		if (requested && requested !== runtime.state.active.namespaceId) {
			if (!allowedDestination(runtime.state.choices, requested, runtime.state.active.platform.isGlobalAdmin))
				return '/namespace/choose';

			const result = await runtime.coordinator.requestSwitch({
				namespaceId: requested,
				source: 'history',
				destination,
			});

			if (result.status !== 'ready') {
				if (getNamespaceRuntime()?.state.phase === 'blocked' && !runtime.snapshot.value)
					return withNamespace('/namespace/recover', runtime.state.active?.namespaceId ?? requested);
				return false;
			}

			if (result.destination && result.destination !== destination) return withNamespace(result.destination, requested);
			return;
		}

		if (!requested) return withNamespace(destination, runtime.state.active.namespaceId);

		if (userStore.currentUser && !('share' in userStore.currentUser) && userStore.currentUser.role) {
			if (to.path !== '/tfa-setup') {
				if (userStore.currentUser.role.enforce_tfa && userStore.currentUser.tfa_secret === null) {
					if (userStore.currentUser.last_page === to.fullPath) {
						return '/tfa-setup';
					} else {
						return '/tfa-setup?redirect=' + encodeURIComponent(to.fullPath);
					}
				}
			} else if (userStore.currentUser.tfa_secret !== null) {
				return withNamespace('/namespace', runtime.state.active.namespaceId);
			}
		}
	}
};

let trackTimeout: number | null = null;

export const onAfterEach: NavigationHookAfter = (to) => {
	const userStore = useUserStore();
	const runtime = getNamespaceRuntime();

	if (runtime?.state.active) {
		if (trackTimeout) window.clearTimeout(trackTimeout);
		trackTimeout = null;
		if (
			runtime.state.phase === 'ready' &&
			to.meta.public !== true &&
			to.meta.track !== false &&
			userStore.currentUser &&
			'id' in userStore.currentUser
		)
			sessionStorage.setItem(navigationKey(userStore.currentUser.id, runtime.state.active.namespaceId), to.fullPath);
		return;
	}

	if (to.meta.public !== true && to.meta.track !== false) {
		// The timeout gives the page some breathing room to load. No need to clog up the thread with
		// this call while more important things are loading

		if (trackTimeout) {
			window.clearTimeout(trackTimeout);
			trackTimeout = null;
		}

		trackTimeout = window.setTimeout(() => {
			userStore.trackPage(to.fullPath);
		}, 500);
	}
};

router.beforeEach(onBeforeEach);
router.afterEach(onAfterEach);
