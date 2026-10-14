import type { Query } from '@wbce-d9/types';
import { getActiveNamespaceId } from './context.js';

/**
 * Shared control-plane tables that carry a `namespace` column.
 *
 * These are the tables a namespace must not read across: without the column a
 * namespace returned every area's roles, permissions and audit records.
 * `directus_users`, `directus_files` and `directus_settings` are deliberately
 * absent — those are shared by design, and their visibility rules are separate
 * open questions (D07, D09).
 */
export const NAMESPACE_SCOPED_TABLES = [
	'directus_activity',
	'directus_permissions',
	'directus_revisions',
	'directus_roles',
];

const SCOPED = new Set(NAMESPACE_SCOPED_TABLES);

/**
 * The namespace a query should be limited to, or undefined for no limitation.
 *
 * Undefined outside a request, which keeps the legacy single-context behaviour
 * byte-identical — including for the main namespace, whose id happens to match
 * the backfill value but must not be assumed.
 */
function activeScope(): string | undefined {
	return getActiveNamespaceId();
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
	const namespace = activeScope();

	if (!namespace || !SCOPED.has(collection)) return query;

	const filter = query.filter ? { _and: [query.filter, { namespace: { _eq: namespace } }] } : { namespace: { _eq: namespace } };

	return { ...query, filter };
}

/**
 * Stamps the active namespace onto a row being written, so a new role,
 * permission, activity or revision record belongs to the area it was created in
 * rather than to no area at all.
 *
 * Callers may still set it explicitly.
 */
export function stampNamespace<T extends Record<string, any>>(collection: string, data: T): T {
	const namespace = activeScope();

	if (!namespace || !SCOPED.has(collection) || data['namespace']) return data;

	return { ...data, namespace };
}
