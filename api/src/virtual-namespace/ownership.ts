import type { Knex } from 'knex';
import { getActiveNamespace } from './context.js';
import { CONTROL_PLANE_SCHEMA, SHARED_TABLES } from './tables.js';

/**
 * The collections a namespace is allowed to expose.
 *
 * A collection is owned when its table lives in the namespace's own schema, or
 * when it is a shared control-plane table reached through the `public` fallback
 * in `search_path`.
 *
 * This exists because `search_path` alone is not isolation. It gives shadowing
 * for *data* reads — the first schema wins — but the schema inspector selects
 * tables by `relnamespace IN (schemas…)`, so anything still in `public` is
 * reported as if the namespace owned it. Without this filter a namespace lists
 * and reads every other area's collections.
 *
 * Returns null when no namespace is active, meaning "do not filter": the legacy
 * single-schema behaviour stays unchanged.
 *
 * Every consumer that enumerates collections from the raw inspector has to apply
 * this — the schema overview and the collections listing both do.
 */
export async function listOwnedCollections(database: Knex): Promise<Set<string> | null> {
	const namespace = getActiveNamespace();

	if (!namespace) return null;

	const rows = await database
		.select('table_name', 'table_schema')
		.from('information_schema.tables')
		.where({ table_type: 'BASE TABLE' })
		.whereIn('table_schema', [namespace, CONTROL_PLANE_SCHEMA]);

	const shared = new Set(SHARED_TABLES);
	const owned = new Set<string>();

	for (const { table_name: table, table_schema: schema } of rows) {
		if (schema === namespace || shared.has(table)) owned.add(table);
	}

	return owned;
}
