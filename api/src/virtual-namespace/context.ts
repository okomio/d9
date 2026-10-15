import { AsyncLocalStorage } from 'node:async_hooks';
import type { NamespaceKind } from './registry.js';

/**
 * The active virtual namespace for the duration of a request.
 *
 * Both halves are needed and they are not interchangeable: `schema` is what
 * `search_path` and the cache keys work in terms of, while `id` is the registry
 * identifier — the only thing that belongs in a `namespace` column, in a
 * membership, or in a token claim.
 *
 * Outside a request (boot, CLI, migrations) the store is empty, which means the
 * default database/schema is used.
 */
type NamespaceContext = {
	id: string;
	schema: string;
	kind?: NamespaceKind;
	responseCacheFingerprint?: string;
};

const namespaceStorage = new AsyncLocalStorage<NamespaceContext>();

/** The physical schema of the active namespace, for `search_path` and caches. */
export function getActiveNamespace(): string | undefined {
	return namespaceStorage.getStore()?.schema;
}

/** The registry id of the active namespace, for `namespace` columns. */
export function getActiveNamespaceId(): string | undefined {
	return namespaceStorage.getStore()?.id;
}

export function getActiveNamespaceKind(): NamespaceKind | undefined {
	return namespaceStorage.getStore()?.kind;
}

export function getNamespaceResponseCacheFingerprint(): string | undefined {
	return namespaceStorage.getStore()?.responseCacheFingerprint;
}

/** Compute once at request admission; cache reads and writes must use the same value. */
export function setNamespaceResponseCacheFingerprint(fingerprint: string): void {
	const context = namespaceStorage.getStore();
	if (context) context.responseCacheFingerprint = fingerprint;
}

export function runWithNamespace<T>(context: NamespaceContext, callback: () => T): T {
	return namespaceStorage.run(context, callback);
}

/** Personal/control operations resolve shared ACL independently of child filters. */
export function runWithoutNamespace<T>(callback: () => T): T {
	return namespaceStorage.exit(callback);
}
