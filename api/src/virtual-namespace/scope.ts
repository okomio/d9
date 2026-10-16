import type { Query } from '@wbce-d9/types';
import { getActiveNamespaceId } from './context.js';
import { isVirtualNamespaceEnabled } from './config.js';

/**
 * Shared control-plane tables that carry a `namespace` column.
 *
 * These are the tables a namespace must not read across: without the column a
 * namespace returned every area's roles, permissions and audit records.
 * Files and folders remain in shared storage, but each row has one owner.
 * Users and settings have separate visibility rules.
 */
export const NAMESPACE_SCOPED_TABLES = [
	'directus_activity',
	'directus_permissions',
	'directus_revisions',
	'directus_roles',
	'directus_files',
	'directus_folders',
];

const SCOPED = new Set(NAMESPACE_SCOPED_TABLES);

/**
 * The namespace a query should be limited to, or undefined for no limitation.
 *
 * Public file requests and trusted work without a request context use main;
 * an anonymous asset URL must never expose a child-owned file.
 */
function activeScope(collection: string): string | undefined {
	return (
		getActiveNamespaceId() ??
		(isVirtualNamespaceEnabled() && (collection === 'directus_files' || collection === 'directus_folders')
			? 'main'
			: undefined)
	);
}

/**
 * Narrows a read to the active namespace.
 *
 * Applied in `ItemsService`, which every one of these tables is read through
 * (`RolesService`, `PermissionsService`, `ActivityService` and `RevisionsService`
 * all extend it, and `readOne`/`readMany` delegate to `readByQuery`).
 *
 * This does not affect authorization: the permission engine reads
 * `directus_permissions` with a direct knex query, not through `ItemsService`.
 */
export function limitToNamespace(collection: string, query: Query): Query {
	const namespace = activeScope(collection);

	if (!namespace || !SCOPED.has(collection)) return query;

	const filter = query.filter
		? { _and: [query.filter, { namespace: { _eq: namespace } }] }
		: { namespace: { _eq: namespace } };

	return { ...query, filter };
}

/**
 * Stamps the active namespace onto a row being written, including files and
 * folders in shared storage.
 *
 * Callers may still set it explicitly.
 */
export function stampNamespace<T extends Record<string, any>>(collection: string, data: T): T {
	const namespace = activeScope(collection);

	if (!namespace || !SCOPED.has(collection) || data['namespace']) return data;

	return { ...data, namespace };
}
