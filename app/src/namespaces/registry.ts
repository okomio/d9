import type { RegistryInvalidation } from './types';

/** C7 emits after creation/status changes; C1 subscribes and refreshes authorized choices. */
export function createNamespaceRegistrySignal() {
	const listeners = new Set<(event: RegistryInvalidation) => void>();
	return {
		subscribe(listener: (event: RegistryInvalidation) => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		invalidate(event: RegistryInvalidation) {
			for (const listener of listeners) listener(event);
		},
	};
}
