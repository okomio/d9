import type { Directive } from 'vue';
import { getAssetGrantUrl } from '@/utils/get-asset-url';
import { getNamespaceRuntime } from '@/namespaces/live';

type LinkState = { source?: string; namespaceId?: string; granted?: string; expiresAt?: number; timer?: number };
const states = new WeakMap<HTMLElement, LinkState>();

function anchor(el: HTMLElement): HTMLAnchorElement | null {
	return el instanceof HTMLAnchorElement ? el : el.querySelector('a');
}

function clear(state: LinkState) {
	if (state.timer) window.clearTimeout(state.timer);
}

async function refresh(el: HTMLElement, state: LinkState) {
	const link = anchor(el);
	if (!link) return;
	link.removeAttribute('href');
	if (!state.source) return;

	try {
		const granted = await getAssetGrantUrl(state.source);
		if (states.get(el) !== state) return;
		state.granted = granted;
		state.expiresAt = Date.now() + 4 * 60 * 1000;
		link.href = granted;
		link.referrerPolicy = 'no-referrer';

		if (getNamespaceRuntime()?.state.active) {
			state.timer = window.setTimeout(() => void refresh(el, state), 4 * 60 * 1000);
		}
	} catch {
		// A stale namespace must never leave a usable link to the wrong file.
		if (states.get(el) === state) link.removeAttribute('href');
	}
}

const assetGrantLink: Directive<HTMLElement, string | undefined> = {
	mounted(el, binding) {
		const state = { source: binding.value, namespaceId: getNamespaceRuntime()?.state.active?.namespaceId };
		states.set(el, state);
		void refresh(el, state);
	},
	updated(el, binding) {
		const old = states.get(el);

		const namespaceId = getNamespaceRuntime()?.state.active?.namespaceId;

		if (
			old?.source === binding.value &&
			old.namespaceId === namespaceId &&
			old.expiresAt &&
			old.expiresAt > Date.now()
		) {
			if (old.granted) anchor(el)?.setAttribute('href', old.granted);
			return;
		}

		if (old) clear(old);
		const state = { source: binding.value, namespaceId };
		states.set(el, state);
		void refresh(el, state);
	},
	unmounted(el) {
		const state = states.get(el);
		if (state) clear(state);
		states.delete(el);
	},
};

export default assetGrantLink;
