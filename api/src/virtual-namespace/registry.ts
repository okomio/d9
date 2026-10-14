import type { Knex } from 'knex';

/** Shared control-plane table: the namespace registry. */
export const NAMESPACES_TABLE = 'directus_namespaces';

export type NamespaceKind = 'main' | 'virtual';

export type NamespaceReadiness = 'provisioning' | 'ready' | 'failed';

export type NamespaceRecord = {
	id: string;
	name: string;
	schema_name: string;
	kind: NamespaceKind;
	readiness: NamespaceReadiness;
};

const COLUMNS = ['id', 'name', 'schema_name', 'kind', 'readiness'];

/** Resolves a namespace id. Undefined when it is not registered. */
export async function getNamespace(database: Knex, id: string): Promise<NamespaceRecord | undefined> {
	const record = await database.select(COLUMNS).from(NAMESPACES_TABLE).where({ id }).first();

	return record ?? undefined;
}

/**
 * All registered namespaces, main first.
 *
 * Read from the shared control plane, so it must be called before entering a
 * namespace context.
 */
export async function listNamespaces(database: Knex): Promise<NamespaceRecord[]> {
	return database
		.select(COLUMNS)
		.from(NAMESPACES_TABLE)
		.orderBy([
			{ column: 'kind', order: 'asc' },
			{ column: 'sort', order: 'asc' },
			{ column: 'name', order: 'asc' },
		]);
}
