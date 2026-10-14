import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Carries the active virtual namespace for the duration of a request.
 *
 * Outside a request (boot, CLI, migrations) the store is empty, which means the
 * default database/schema is used.
 */
const namespaceStorage = new AsyncLocalStorage<string>();

export function getActiveNamespace(): string | undefined {
	return namespaceStorage.getStore();
}

export function runWithNamespace<T>(namespace: string, callback: () => T): T {
	return namespaceStorage.run(namespace, callback);
}
