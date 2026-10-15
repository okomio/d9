import { ref, Ref, onBeforeMount, onBeforeUnmount, unref } from 'vue';
import { onBeforeRouteUpdate, onBeforeRouteLeave, NavigationGuard, useRoute } from 'vue-router';
import { getNamespaceRuntime } from '@/namespaces/live';

type EditsGuardOptions = {
	ignorePrefix?: string | Ref<string>;
};

let dirtyRegistration = 0;

export function useEditsGuard(hasEdits: Ref<boolean>, opts?: EditsGuardOptions) {
	const { path } = useRoute();

	const unregister = getNamespaceRuntime()?.lifecycle.register({
		id: `native-edits:${path}:${++dirtyRegistration}`,
		dirty: () => hasEdits.value,
	});

	const confirmLeave = ref(false);
	const leaveTo = ref<string | null>(null);

	const beforeUnload = (event: BeforeUnloadEvent) => {
		if (hasEdits.value) {
			event.preventDefault();
			event.returnValue = '';
			return '';
		}
	};

	const editsGuard: NavigationGuard = (to) => {
		const matchesPathPrefix = opts?.ignorePrefix ? to.path.startsWith(unref(opts.ignorePrefix)) : false;

		if (hasEdits.value && !to.path.startsWith(path) && !matchesPathPrefix) {
			confirmLeave.value = true;
			leaveTo.value = to.fullPath;
			return false;
		}
	};

	onBeforeMount(() => {
		window.addEventListener('beforeunload', beforeUnload);
	});

	onBeforeUnmount(() => {
		window.removeEventListener('beforeunload', beforeUnload);
		unregister?.();
	});

	onBeforeRouteUpdate(editsGuard);
	onBeforeRouteLeave(editsGuard);

	return { confirmLeave, leaveTo };
}
