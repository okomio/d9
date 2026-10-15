import type { Knex } from 'knex';

import { CONTROL_PLANE_SCHEMA, SHARED_TABLES } from './tables.js';

/** Postgres identifier quoting, for the few places a name must be a literal. */
const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;

export type ProvisionRequest = {
	/** Registry id. Must already be registered, or pass a name to register. */
	id: string;
	name: string;
	/** Top-level collection group, e.g. "Tracking". */
	area: string;
};

export type ProvisionResult = {
	id: string;
	area: string;
	schema: string;
	collections: string[];
	tables: { created: string[]; skipped: string[]; missing: string[] };
	metadata: { collections: number; fields: number; relations: number; skippedRelations: number };
};

/** Tables the database actually has, for a given schema. */
async function listTables(database: Knex, schema: string): Promise<Set<string>> {
	const rows = await database
		.select('table_name')
		.from('information_schema.tables')
		.where({ table_schema: schema, table_type: 'BASE TABLE' });

	return new Set(rows.map((row) => row.table_name));
}

/**
 * System tables a namespace owns: every `directus_*` table that is not shared.
 *
 * Derived from the database rather than hard-coded, so a table added by a later
 * migration is picked up without editing this list.
 */
export async function listNamespaceSystemTables(database: Knex): Promise<string[]> {
	const publicTables = await listTables(database, CONTROL_PLANE_SCHEMA);
	const shared = new Set(SHARED_TABLES);

	return [...publicTables].filter((table) => table.startsWith('directus_') && !shared.has(table)).sort();
}

/**
 * Every collection belonging to an area, by walking the `group` tree.
 *
 * `directus_collections.group` is hierarchical (up to three levels deep in the
 * reference instance), so grouping by the raw value invents areas that are
 * really sub-folders — `native_ad` is a sub-folder of AAA, not an area.
 *
 * The result includes the area's own folder row and intermediate sub-folders,
 * because their metadata rows are what make the sidebar render at all.
 */
export async function listAreaCollections(database: Knex, area: string): Promise<string[]> {
	const rows = await database.raw(
		`
		with recursive up as (
			select collection as start, collection as node, coalesce(nullif("group", ''), '') as parent
			from directus_collections
			where collection not like 'directus%'
			union all
			select u.start, p.collection, coalesce(nullif(p."group", ''), '')
			from up u
			join directus_collections p on p.collection = u.parent
			where u.parent <> ''
		)
		select distinct start as collection
		from up
		where node = ?
		order by 1
		`,
		[area]
	);

	return rows.rows.map((row: { collection: string }) => row.collection);
}

/**
 * Copies one table's structure into a namespace schema.
 *
 * `LIKE … INCLUDING ALL EXCLUDING DEFAULTS` copies columns, identity, indexes
 * and comment/statistics metadata. Defaults are re-applied by hand because the
 * naive `INCLUDING ALL` leaves `nextval('public.x_id_seq')` in place — every
 * namespace would then draw from the *source* schema's sequence, which is the
 * trap found during the S1 spike.
 *
 * Foreign keys are deliberately not reproduced (see the module note below).
 */
export async function copyTable(database: Knex, schema: string, table: string): Promise<void> {
	const defaults = await database
		.select({ column: 'column_name', default: 'column_default' })
		.from('information_schema.columns')
		.where({ table_schema: CONTROL_PLANE_SCHEMA, table_name: table })
		.whereNotNull('column_default');

	await database.raw(
		`create table if not exists ??.?? (like "public".?? including all excluding defaults)`,
		[schema, table, table]
	);

	for (const { column, default: expression } of defaults as { column: string; default: string }[]) {
		const sequence = `${table}_${column}_seq`;
		const isSequence = /^nextval\(/.test(expression);

		if (isSequence) {
			// The sequence has to live in the namespace schema and be owned by its
			// column, or it is shared with `public` again.
			await database.raw(`create sequence if not exists ??.??`, [schema, sequence]);
			await database.raw(`alter sequence ??.?? owned by ??.??.??`, [schema, sequence, schema, table, column]);
			// Inlined, not bound: Postgres does not accept parameters in DDL
			// (utility statements are parsed with zero parameters). Identifiers are
			// still handled by knex, and the names come from our own inputs plus the
			// system catalogue.
			await database.raw(`alter table ??.?? alter column ?? set default nextval('${quoteIdent(schema)}.${quoteIdent(sequence)}'::regclass)`, [
				schema,
				table,
				column,
			]);

			continue;
		}

		// Any non-sequence default is schema-independent (now(), literals, casts).
		if (expression.includes('public.')) continue;

		// The expression comes from the system catalogue, not from a caller.
		await database.raw(`alter table ??.?? alter column ?? set default ${expression}`, [schema, table, column]);
	}
}

/** SQL string literal, for the few places a name must be inlined. */
const quoteLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;

const inList = (values: string[]): string => values.map(quoteLiteral).join(', ');

/**
 * Copies rows from `public` into the namespace schema with INSERT … SELECT.
 *
 * Not a select-into-JS-and-insert round trip: the metadata tables carry `json`
 * columns and re-serialising them through the driver is both slower and a type
 * coercion hazard. This is DML rather than DDL, so parameters would be legal,
 * but inlined catalogue-derived literals keep it simple.
 */
async function copyRows(database: Knex, schema: string, table: string, where: string): Promise<number> {
	const columns = await database
		.select('column_name')
		.from('information_schema.columns')
		.where({ table_schema: schema, table_name: table })
		.orderBy('ordinal_position');

	if (columns.length === 0) return 0;

	const list = columns.map((column) => quoteIdent(column.column_name)).join(', ');

	const result = await database.raw(
		`insert into ??.?? (${list}) select ${list} from "public".?? where ${where} on conflict do nothing`,
		[schema, table, table]
	);

	return result.rowCount ?? 0;
}

/**
 * Copies collection, field and relation metadata for the area's collections.
 *
 * Relations are copied only when the other end is visible from the namespace:
 * either another collection in the area, or a shared control-plane table that
 * `search_path` still resolves through `public`. A relation pointing at another
 * area's collection is skipped rather than copied dangling, and counted so the
 * caller can see it happen.
 */
async function copyMetadata(
	database: Knex,
	schema: string,
	collections: string[]
): Promise<ProvisionResult['metadata']> {
	if (collections.length === 0) return { collections: 0, fields: 0, relations: 0, skippedRelations: 0 };

	const own = inList(collections);
	const reachable = inList([...collections, ...SHARED_TABLES]);

	const collections_ = await copyRows(database, schema, 'directus_collections', `collection in (${own})`);
	const fields = await copyRows(database, schema, 'directus_fields', `collection in (${own})`);
	const relations = await copyRows(
		database,
		schema,
		'directus_relations',
		`many_collection in (${own}) and (one_collection is null or one_collection in (${reachable}))`
	);

	const total = await database.from('directus_relations').whereIn('many_collection', collections).count({ count: '*' });
	const totalRelations = Number((total[0] as { count?: string | number } | undefined)?.count ?? 0);

	return {
		collections: collections_,
		fields,
		relations,
		skippedRelations: totalRelations - relations,
	};
}

/**
 * Provisions a namespace: its schema, the system tables it owns, the area's own
 * tables, and the metadata to describe them.
 *
 * Idempotent — existing tables are left alone, metadata inserts ignore conflicts,
 * so re-running repairs rather than duplicates.
 *
 * Deliberately does NOT reproduce foreign keys. A namespace's tables and the
 * shared control plane live in different schemas, and the design says the areas
 * are disjoint; the prototype therefore copies structure and metadata but not
 * referential constraints. That is a known gap, not an oversight.
 *
 * Must be called on the default connection: it reads `public` as the source.
 */
export async function provisionNamespace(database: Knex, request: ProvisionRequest): Promise<ProvisionResult> {
	const registry = await database.select('schema_name', 'readiness').from('directus_namespaces').where({ id: request.id }).first();

	if (!registry) {
		throw new Error(`Namespace "${request.id}" is not registered; register it before provisioning`);
	}

	const schema = registry.schema_name;
	const collections = await listAreaCollections(database, request.area);

	if (collections.length === 0) {
		throw new Error(`Area "${request.area}" has no collections; check the group tree`);
	}

	await database.raw(`create schema if not exists ??`, [schema]);

	const systemTables = await listNamespaceSystemTables(database);
	const existing = await listTables(database, schema);
	const source = await listTables(database, CONTROL_PLANE_SCHEMA);

	const created: string[] = [];
	const skipped: string[] = [];
	const missing: string[] = [];

	for (const table of [...systemTables, ...collections]) {
		if (!source.has(table)) {
			// A folder row is not necessarily a table (`AAA` is not, `Widgets` is).
			missing.push(table);
			continue;
		}

		if (existing.has(table)) {
			skipped.push(table);
			continue;
		}

		await copyTable(database, schema, table);
		created.push(table);
	}

	const metadata = await copyMetadata(database, schema, collections);

	await database('directus_namespaces').where({ id: request.id }).update({ readiness: 'ready' });

	return { id: request.id, area: request.area, schema, collections, tables: { created, skipped, missing }, metadata };
}
