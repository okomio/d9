/**
 * One-way migration of the Infrastructure instance: every area's collections
 * leave the shared `public` schema and become their own virtual namespace.
 *
 * Prerequisite is the namespace registry and the `namespace` columns, which come
 * from the database migrations; the source of truth is always `public`.
 */
import type { Knex } from 'knex';

import { copyTable, listAreaCollections, listNamespaceSystemTables } from './provision.js';
import { CONTROL_PLANE_SCHEMA, SHARED_TABLES } from './tables.js';

/** Postgres identifier quoting; identifiers still go through knex `??` where possible. */
const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/** SQL string literal, for the few places a name has to be inlined. */
const quoteLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;

const inList = (values: string[]): string => values.map(quoteLiteral).join(', ');

/**
 * Areas to move out of `public`, in report order.
 *
 * `area` is the top-level `group` folder that already exists in the metadata;
 * `id` is the immutable registry id and `name` the display label the switcher
 * shows. The schema follows the provisioner's convention (`ns_<id>`).
 */
export const AREA_NAMESPACES = [
	{ area: 'AAA', id: 'aaa', name: 'AAA' },
	{ area: 'Tracking', id: 'tracking', name: 'Tracking' },
	{ area: 'Scraper', id: 'scraper', name: 'Scraper' },
	{ area: 'Platform_Plus', id: 'platform_plus', name: 'Platform+' },
	{ area: 'Translations', id: 'translations', name: 'Translations' },
	{ area: 'SRE', id: 'sre', name: 'SRE' },
	{ area: 'Test', id: 'test', name: 'Test' },
];

/**
 * Role → namespace, agreed with the product owner.
 *
 * `main` keeps the global administrator. Note `Platform+ Admin`: it carries
 * `admin_access = true` and lives in `main` today, which makes its four holders
 * **global** admins. Moving it into `platform_plus` makes them admins of that
 * namespace only, which is the intent of the two-level model.
 *
 * A role that is not listed here is left in `main` and reported, never guessed.
 */
export const ROLE_NAMESPACES: Record<string, string> = {
	Administrator: 'main',
	'All access - view only': 'main',
	'[AAA] API': 'aaa',
	'[AAA] Campaign Manager': 'aaa',
	'[AAA] Editor': 'aaa',
	'Tier 2 editors': 'tracking',
	EventsGetter: 'tracking',
	'Competitor Scraper - business editor': 'scraper',
	'Competitor Scraper - editor': 'scraper',
	'Competitor Scraper - view only': 'scraper',
	'Platform+ Admin': 'platform_plus',
	'Platform+ Feature Team': 'platform_plus',
	'Platform+ Hook Maintainer': 'platform_plus',
	'[P+] User test': 'platform_plus',
	'Service (PlatformPlus)': 'platform_plus',
	'Translation Manager': 'translations',
};

/**
 * Tables that deliberately stay in `public`.
 *
 * `directus_users` holds foreign keys into these two, so moving them would make
 * the shared user table depend on a namespace. They move once the
 * `tracking_team`/`tracking_tier` columns are redesigned into their own table.
 */
export const EXCLUDED_TABLES = ['tracking_teams', 'tracking_tiers'];

/**
 * Grouping corrections, applied before the area walk.
 *
 * The junction is the real mis-grouping: it was filed under AAA while both its
 * foreign keys point into Tracking. `hooks_Features` is a leaf with no group at
 * all, and its foreign keys point at Platform+ `Features` and `hooks`.
 */
export const GROUPING_FIXES = [
	{ collection: 'collector_event_validation_config_tracking_events', to: 'Tracking' },
	{ collection: 'hooks_Features', to: 'Platform_Plus' },
];

export type AreaPlan = {
	id: string;
	area: string;
	name: string;
	schema: string;
	registered: boolean;
	/** Tables already in the namespace schema, so "empty" can be told from "done". */
	namespaceTables: number;
	collections: number;
	tables: string[];
	excluded: string[];
	foldersWithoutTable: string[];
	metadata: { collections: number; fields: number; relations: number };
	/** Relations left in `public` because the far end is another area's collection. */
	leftBehindRelations: string[];
};

export type MigrationPlan = {
	areas: AreaPlan[];
	roles: Array<{ name: string; users: number; from: string; to: string }>;
	unmappedRoles: string[];
	memberships: Array<{ namespace: string; role: string; users: number }>;
	crossAreaForeignKeys: Array<{ from: string; to: string }>;
	flows: { active: number; inactive: number };
	blockers: string[];
};

/** Thrown to unwind the dry-run transaction; never escapes. */
class Rollback extends Error {}

async function listTables(database: Knex, schema: string): Promise<Set<string>> {
	const rows = await database
		.select('table_name')
		.from('information_schema.tables')
		.where({ table_schema: schema, table_type: 'BASE TABLE' });

	return new Set(rows.map((row) => row.table_name as string));
}

async function listColumns(database: Knex, schema: string, table: string): Promise<string[]> {
	const rows = await database
		.select('column_name')
		.from('information_schema.columns')
		.where({ table_schema: schema, table_name: table })
		.orderBy('ordinal_position');

	return rows.map((row) => row.column_name as string);
}

/** Applies the grouping corrections. Idempotent. */
export async function applyGroupingFixes(database: Knex): Promise<void> {
	for (const fix of GROUPING_FIXES) {
		await database('directus_collections').where({ collection: fix.collection }).update({ group: fix.to });
	}
}

/**
 * Areas whose collections still live in `public`, plus the foreign keys that
 * cross between two areas. Reads only.
 *
 * Run inside the dry-run transaction, so the area walk reflects the grouping
 * corrections without them having been committed.
 */
export async function planAreas(database: Knex): Promise<MigrationPlan> {
	const registry = await database.select('id', 'schema_name').from('directus_namespaces');
	const registered = new Map(registry.map((row) => [row.id as string, row.schema_name as string]));

	const publicTables = await listTables(database, CONTROL_PLANE_SCHEMA);
	const excluded = new Set(EXCLUDED_TABLES);

	const areas: AreaPlan[] = [];

	for (const { area, id, name } of AREA_NAMESPACES) {
		const collections = await listAreaCollections(database, area);
		const schema = registered.get(id) ?? `ns_${id}`;

		const tables: string[] = [];
		const skippedTables: string[] = [];
		const foldersWithoutTable: string[] = [];

		for (const collection of collections) {
			if (!publicTables.has(collection)) {
				foldersWithoutTable.push(collection);
				continue;
			}

			if (excluded.has(collection)) {
				skippedTables.push(collection);
				continue;
			}

			tables.push(collection);
		}

		const namespaceTables = (await listTables(database, schema)).size;

		const ownCollections = `collection in (${inList(collections)})`;
		const ownRelations = `many_collection in (${inList(collections)})`;
		const reachable = inList([...collections, ...SHARED_TABLES]);

		/**
		 * Counts only when the area still has collections in `public`. An
		 * already-migrated area has none, and `x in ()` is a syntax error, so the
		 * empty case is answered before the query is built rather than after.
		 *
		 * Each table is asked about the column it actually keys on: relations
		 * reference their collection as `many_collection`.
		 */
		const countMetadata = async (table: string, where: string, extra?: string): Promise<number> => {
			if (collections.length === 0) return 0;

			const query = database.from(table).whereRaw(where);

			if (extra) query.andWhereRaw(extra);

			return Number((await query.count({ count: '*' }).first())?.count ?? 0);
		};

		const metadata = {
			collections: await countMetadata('directus_collections', ownCollections),
			fields: await countMetadata('directus_fields', ownCollections),
			relations: await countMetadata(
				'directus_relations',
				ownRelations,
				`(one_collection is null or one_collection in (${reachable}))`
			),
		};

		const allRelations = await database
			.select('many_collection', 'one_collection')
			.from('directus_relations')
			.whereIn('many_collection', collections.length ? collections : ['']);

		const visible = new Set([...collections, ...SHARED_TABLES]);
		const leftBehindRelations = allRelations
			.filter((row) => row.one_collection && !visible.has(row.one_collection as string))
			.map((row) => `${row.many_collection} → ${row.one_collection}`);

		areas.push({
			id,
			area,
			name,
			schema,
			registered: registered.has(id),
			namespaceTables,
			collections: collections.length,
			tables: tables.sort(),
			excluded: skippedTables.sort(),
			foldersWithoutTable,
			metadata,
			leftBehindRelations,
		});
	}

	const roleRows = await database
		.select('r.name as name', 'r.namespace as namespace')
		.count({ users: 'u.id' })
		.from('directus_roles as r')
		.leftJoin('directus_users as u', 'u.role', 'r.id')
		.groupBy('r.name', 'r.namespace')
		.orderBy('r.name');

	const roles: MigrationPlan['roles'] = [];
	const unmappedRoles: string[] = [];
	const memberCounts = new Map<string, { namespace: string; role: string; users: number }>();

	for (const row of roleRows) {
		const name = row.name as string;
		const users = Number(row.users ?? 0);
		const to = ROLE_NAMESPACES[name];

		if (!to) {
			unmappedRoles.push(name);
			continue;
		}

		roles.push({ name, users, from: (row.namespace as string) ?? 'NULL', to });

		if (to !== 'main' && users > 0) {
			const key = `${to}|${name}`;
			memberCounts.set(key, { namespace: to, role: name, users });
		}
	}

	const fkRows = await database.raw(`
		with recursive up as (
			select collection as start, collection as node, coalesce(nullif("group", ''), '') as parent
			from directus_collections where collection not like 'directus%'
			union all
			select u.start, p.collection, coalesce(nullif(p."group", ''), '')
			from up u join directus_collections p on p.collection = u.parent
			where u.parent <> ''
		),
		area as (
			select distinct start as collection, node as area from up
			where node in (${inList(AREA_NAMESPACES.map((entry) => entry.area))})
		)
		select fa.area as from_area, src.relname as from_table, ta.area as to_area, tgt.relname as to_table
		from pg_constraint con
		join pg_class src on src.oid = con.conrelid
		join pg_class tgt on tgt.oid = con.confrelid
		join pg_namespace n on n.oid = src.relnamespace
		join area fa on fa.collection = src.relname
		join area ta on ta.collection = tgt.relname
		where con.contype = 'f' and n.nspname = 'public' and fa.area <> ta.area
		order by 1, 2, 4
	`);

	const crossAreaForeignKeys = (fkRows.rows as { from_area: string; from_table: string; to_area: string; to_table: string }[]).map(
		(row) => ({ from: `${row.from_area}.${row.from_table}`, to: `${row.to_area}.${row.to_table}` })
	);

	const flowRows = await database.select('status').count({ count: '*' }).from('directus_flows').groupBy('status');
	const flows = { active: 0, inactive: 0 };

	for (const row of flowRows) {
		if (row.status === 'active') flows.active = Number(row.count);
		else flows.inactive += Number(row.count);
	}

	const blockers: string[] = [];

	if (unmappedRoles.length) {
		blockers.push(`${unmappedRoles.length} role(s) not in the mapping, left in main: ${unmappedRoles.join(', ')}`);
	}

	for (const area of areas) {
		if (area.tables.length === 0 && area.namespaceTables === 0) {
			blockers.push(
				`${area.area}: no tables to move and the namespace has none — it will report 0 collections and 500s on some routes`
			);
		}

		if (area.leftBehindRelations.length) {
			blockers.push(`${area.area}: ${area.leftBehindRelations.length} relation(s) point into another area and stay behind`);
		}
	}

	if (crossAreaForeignKeys.length) {
		blockers.push(`${crossAreaForeignKeys.length} foreign key(s) cross two areas and will survive the move`);
	}

	if (flows.active > 0) {
		blockers.push(`${flows.active} flow(s) are active; they are not moved by this migration`);
	}

	return {
		areas,
		roles,
		unmappedRoles,
		memberships: [...memberCounts.values()].sort((a, b) => b.users - a.users),
		crossAreaForeignKeys,
		flows,
		blockers,
	};
}

/**
 * The plan as `--apply` would see it: grouping corrections made visible for the
 * duration of a transaction that is then rolled back.
 */
export async function dryRun(database: Knex): Promise<MigrationPlan> {
	let plan: MigrationPlan | undefined;

	try {
		await database.transaction(async (trx) => {
			await applyGroupingFixes(trx);
			plan = await planAreas(trx);
			throw new Rollback();
		});
	} catch (error) {
		if (!(error instanceof Rollback)) throw error;
	}

	if (!plan) throw new Error('dry run produced no plan');

	return plan;
}

/** Moves rows out of `public` into the namespace schema; returns the row count. */
async function moveRows(database: Knex, schema: string, table: string, where: string): Promise<number> {
	const columns = await listColumns(database, schema, table);

	if (columns.length === 0) return 0;

	const list = columns.map(quoteIdent).join(', ');

	const inserted = await database.raw(
		`insert into ??.?? (${list}) select ${list} from "public".?? where ${where} on conflict do nothing`,
		[schema, table, table]
	);

	// Only the rows that just moved leave `public`, so a half-applied run can be
	// resumed by running it again.
	await database.raw(`delete from "public".?? where ${where}`, [table]);

	return inserted.rowCount ?? 0;
}

export type MigrationResult = {
	areas: Array<{
		id: string;
		schema: string;
		registered: boolean;
		tablesMoved: string[];
		metadataMoved: { collections: number; fields: number; relations: number };
	}>;
	rolesUpdated: number;
	membershipsCreated: number;
};

/**
 * Moves every area of the Infrastructure instance out of `public` and into its own namespace.
 *
 * Idempotent: tables already in a namespace are skipped, metadata inserts ignore
 * conflicts, and the deletes are scoped to what the insert just moved — so a
 * wipe and re-run is the normal loop rather than an exception.
 *
 * Must run on the default connection: it reads `public` as the source.
 */
export async function migrateInfrastructure(database: Knex): Promise<MigrationResult> {
	await applyGroupingFixes(database);

	const systemTables = await listNamespaceSystemTables(database);
	const result: MigrationResult = { areas: [], rolesUpdated: 0, membershipsCreated: 0 };

	for (const { area, id, name } of AREA_NAMESPACES) {
		const schema = `ns_${id}`;

		const existing = await database.select('id').from('directus_namespaces').where({ id }).first();

		if (!existing) {
			await database('directus_namespaces').insert({ id, name, schema_name: schema, kind: 'virtual', readiness: 'provisioning' });
		}

		// The namespace owns its own metadata tables, so `getSchema()` inside it
		// resolves the area's rows rather than falling through to `public`.
		await database.raw(`create schema if not exists ??`, [schema]);

		for (const table of systemTables) {
			await copyTable(database, schema, table);
		}

		const collections = await listAreaCollections(database, area);
		const publicTables = await listTables(database, CONTROL_PLANE_SCHEMA);
		const excluded = new Set(EXCLUDED_TABLES);
		const tablesMoved: string[] = [];

		for (const collection of collections) {
			if (!publicTables.has(collection) || excluded.has(collection)) continue;

			// Moves the table with its data, indexes, sequences and constraints
			// intact — unlike a structure copy, and the owned sequences follow the
			// table so nothing keeps drawing from `public`.
			await database.raw(`alter table "public".?? set schema ??`, [collection, schema]);
			tablesMoved.push(collection);
		}

		if (collections.length) {
			const own = `collection in (${inList(collections)})`;
			const reachable = inList([...collections, ...SHARED_TABLES]);

			const metadata = {
				collections: await moveRows(database, schema, 'directus_collections', own),
				fields: await moveRows(database, schema, 'directus_fields', own),
				relations: await moveRows(
					database,
					schema,
					'directus_relations',
					`many_collection in (${inList(collections)}) and (one_collection is null or one_collection in (${reachable}))`
				),
			};

			await database('directus_namespaces').where({ id }).update({ readiness: 'ready' });

			result.areas.push({ id, schema, registered: !existing, tablesMoved, metadataMoved: metadata });

			continue;
		}

		await database('directus_namespaces').where({ id }).update({ readiness: 'ready' });
		result.areas.push({
			id,
			schema,
			registered: !existing,
			tablesMoved,
			metadataMoved: { collections: 0, fields: 0, relations: 0 },
		});
	}

	for (const [roleName, namespace] of Object.entries(ROLE_NAMESPACES)) {
		const updated = await database('directus_roles').where({ name: roleName }).update({ namespace });

		result.rolesUpdated += updated;
	}

	// Membership is derived from the role a user already holds: no new grants,
	// just the same authority expressed per namespace.
	const memberships = await database.raw(`
		insert into directus_user_namespaces (id, user_id, namespace_id, role_id)
		select gen_random_uuid(), u.id, r.namespace, r.id
		from directus_users u
		join directus_roles r on r.id = u.role
		where r.namespace is not null and r.namespace <> 'main'
		on conflict (user_id, namespace_id) do nothing
	`);

	result.membershipsCreated = memberships.rowCount ?? 0;

	return result;
}

/**
 * What the migration changed, expressed as leftovers rather than as intent.
 *
 * Reports collections still sitting in `public` that belong to an area, which
 * should be zero once every area is moved.
 */
export async function verifyMigration(
	database: Knex
): Promise<{ leftovers: Array<{ area: string; collection: string; reason: string }> }> {
	const leftovers: Array<{ area: string; collection: string; reason: string }> = [];
	const publicTables = await listTables(database, CONTROL_PLANE_SCHEMA);
	const excluded = new Set(EXCLUDED_TABLES);

	for (const { area } of AREA_NAMESPACES) {
		const collections = await listAreaCollections(database, area);

		for (const collection of collections) {
			if (publicTables.has(collection) && !excluded.has(collection)) {
				leftovers.push({ area, collection, reason: 'still in public' });
			}
		}
	}

	return { leftovers };
}

export type MigrationStatus = {
	state: 'not-ready' | 'needs-migration' | 'migrated' | 'partial';
	detail: string;
};

/**
 * Whether this database has already been through the migration.
 *
 * Answered from the database's shape rather than from a marker file, so it stays
 * true no matter who ran what. Deliberately not answered from the area walk: an
 * area's metadata moves *into* the namespace, so once an area has migrated there
 * is nothing left in `public` to walk. Registered namespaces, the tables still in
 * `public`, and the schemas those namespaces actually have, are all readable.
 *
 * The exit-code contract agents depend on lives in the runner, not here.
 */
export async function migrationStatus(database: Knex): Promise<MigrationStatus> {
	const controlPlaneTables = new Set<string>(
		(
			await database
				.select('table_name')
				.from('information_schema.tables')
				.where({ table_schema: CONTROL_PLANE_SCHEMA, table_type: 'BASE TABLE' })
		).map((row) => row.table_name as string)
	);

	if (!controlPlaneTables.has('directus_namespaces') || !controlPlaneTables.has('directus_user_namespaces')) {
		return {
			state: 'not-ready',
			detail: 'the namespace migrations have not been applied to this database',
		};
	}

	const registry = await database.select('id', 'schema_name').from('directus_namespaces');
	const registered = new Set(registry.map((row) => row.id as string));
	const schemas = registry.map((row) => row.schema_name as string).filter((schema) => schema !== CONTROL_PLANE_SCHEMA);

	const missing = AREA_NAMESPACES.filter((entry) => !registered.has(entry.id)).map((entry) => entry.id);

	const tablesBySchema = new Map<string, number>();

	for (const row of await database
		.select('table_schema')
		.from('information_schema.tables')
		.where({ table_type: 'BASE TABLE' })) {
		const schema = row.table_schema as string;

		tablesBySchema.set(schema, (tablesBySchema.get(schema) ?? 0) + 1);
	}

	// A registered namespace whose schema has nothing in it cannot serve anything.
	const emptySchemas = schemas.filter((schema) => !tablesBySchema.has(schema));

	const excluded = new Set(EXCLUDED_TABLES);
	const shared = new Set(SHARED_TABLES);
	const stranded = [...controlPlaneTables].filter(
		(table) => !table.startsWith('directus_') && !shared.has(table) && !excluded.has(table)
	);

	if (missing.length === 0 && stranded.length === 0 && emptySchemas.length === 0) {
		return {
			state: 'migrated',
			detail: `${AREA_NAMESPACES.length} area namespaces registered, nothing left in public`,
		};
	}

	if (missing.length === AREA_NAMESPACES.length) {
		return {
			state: 'needs-migration',
			detail: `no area namespace is registered and ${stranded.length} table(s) are still in public`,
		};
	}

	const problems = [
		missing.length ? `missing namespaces: ${missing.join(', ')}` : undefined,
		emptySchemas.length ? `empty schemas: ${emptySchemas.join(', ')}` : undefined,
		stranded.length ? `${stranded.length} table(s) still in public` : undefined,
	].filter(Boolean);

	return { state: 'partial', detail: problems.join('; ') };
}
