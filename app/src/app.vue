<template>
	<div id="directus" :style="brandStyle">
		<transition name="fade">
			<div v-if="hydrating" class="hydrating">
				<v-progress-circular indeterminate />
			</div>
		</transition>

		<v-info v-if="error" type="danger" :title="t('unexpected_error')" icon="error" center>
			{{ t('unexpected_error_copy') }}

			<template #append>
				<v-error :error="error" />
			</template>
		</v-info>

		<div v-else-if="!hydrating && !blockProtected" class="route-host" :inert="sourceBlocked">
			<router-view :key="viewKey" />
		</div>
		<div v-if="sourceBlocked" class="namespace-recovery" role="alertdialog" aria-modal="true">
			<p>The switch outcome could not be confirmed. Your current edits are preserved.</p>
			<button type="button" @click="recoverSource">Check current namespace</button>
		</div>

		<teleport to="#custom-css">{{ customCSS }}</teleport>
	</div>
</template>

<script lang="ts" setup>
import { useSystem } from '@/composables/use-system';
import { ensureNamespaceRuntime } from '@/namespaces/live';
import { namespaceFrontendEnabled } from '@/namespaces/enabled';
import { requestedNamespace } from '@/namespaces/url';
import { useAppStore } from '@/stores/app';
import { useServerStore } from '@/stores/server';
import { useUserStore } from '@/stores/user';
import { setFavicon } from '@/utils/set-favicon';
import { User } from '@wbce-d9/types';
import { StyleValue, computed, onMounted, onUnmounted, toRefs, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { startIdleTracking, stopIdleTracking } from './idle';

const { t } = useI18n();

const appStore = useAppStore();
const userStore = useUserStore();
const serverStore = useServerStore();
const route = useRoute();
const runtime = namespaceFrontendEnabled ? ensureNamespaceRuntime() : null;
const staticNamespace = computed(() => route.path.startsWith('/namespace'));
const sourceBlocked = computed(() => runtime?.state.phase === 'blocked' && !!runtime.snapshot.value);

const routeContextMismatch = computed(() => {
	if (!runtime?.state.active) return false;

	try {
		const requested = requestedNamespace(route.fullPath);
		return requested !== null && requested !== runtime.state.active.namespaceId;
	} catch {
		return true;
	}
});

function recoverSource() {
	void runtime?.recoverSource();
}

const blockProtected = computed(
	() =>
		!!runtime &&
		!staticNamespace.value &&
		route.meta.public !== true &&
		(routeContextMismatch.value ||
			['resetting', 'hydrating', 'no-access'].includes(runtime.state.phase) ||
			(runtime.state.phase === 'blocked' && !runtime.snapshot.value) ||
			(runtime.state.sessionGeneration > 0 && runtime.state.active === null))
);

const viewKey = computed(() =>
	runtime?.state.active ? `${runtime.state.active.namespaceId}:${runtime.state.epoch}:${route.path}` : route.path
);

const { hydrating } = toRefs(appStore);

const brandStyle = computed(() => {
	return {
		'--brand': serverStore.info?.project?.project_color || 'var(--primary)',
	} as StyleValue;
});

onMounted(() => startIdleTracking());
onUnmounted(() => stopIdleTracking());

watch(
	[() => serverStore.info?.project?.project_color ?? null, () => serverStore.info?.project?.project_logo ?? null],
	() => {
		const hasCustomLogo = !!serverStore.info?.project?.project_logo;
		setFavicon(serverStore.info?.project?.project_color, hasCustomLogo);
	},
	{ immediate: true }
);

watch(
	() => (userStore.currentUser as User)?.theme,
	(theme) => {
		document.body.classList.remove('dark');
		document.body.classList.remove('light');
		document.body.classList.remove('auto');

		if (theme) {
			document.body.classList.add(theme);

			document
				.querySelector('head meta[name="theme-color"]')
				?.setAttribute('content', theme === 'light' ? '#ffffff' : '#263238');
		} else {
			// Default to auto mode
			document.body.classList.add('auto');
		}
	},
	{ immediate: true }
);

watch(
	() => serverStore.info?.project?.project_name,
	(projectName) => {
		document.title = projectName || 'd9';
	},
	{ immediate: true }
);

const customCSS = computed(() => {
	return serverStore.info?.project?.custom_css || '';
});

const error = computed(() => appStore.error);

useSystem();
</script>

<style lang="scss" scoped>
:global(#app) {
	height: 100%;
}

#directus {
	height: 100%;
}

.route-host {
	height: 100%;
}

.hydrating {
	position: fixed;
	z-index: 1000;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 100%;
	height: 100%;
	backdrop-filter: blur(10px);
}

.namespace-recovery {
	position: fixed;
	inset: 0;
	z-index: 2000;
	display: grid;
	place-content: center;
	gap: 16px;
	padding: 32px;
	background: var(--background-normal);
	text-align: center;
}

.namespace-recovery button {
	padding: 10px 16px;
	border: 1px solid currentColor;
}

.fade-enter-active,
.fade-leave-active {
	transition: opacity var(--medium) var(--transition);
}

.fade-enter-from,
.fade-leave-to {
	opacity: 0;
}
</style>
