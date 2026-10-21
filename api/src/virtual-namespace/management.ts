import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { InvalidPayloadException, UnprocessableEntityException } from '../exceptions/index.js';
import { copyTable, listNamespaceSystemTables } from './provision.js';
import { getNamespace, type NamespaceRecord } from './registry.js';

function validName(value: unknown): string {
	if (typeof value !== 'string' || !value.trim() || value.trim().length > 255) {
		throw new InvalidPayloadException('Namespace name must contain 1 to 255 characters');
	}
	return value.trim();
}

function validRequestKey(value: unknown): string {
	if (
		typeof value !== 'string' ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
	) {
		throw new InvalidPayloadException('A UUID Idempotency-Key header is required');
	}
	return value.toLowerCase();
}

function assertVirtual(namespace: NamespaceRecord | undefined): asserts namespace is NamespaceRecord {
	if (!namespace || namespace.kind !== 'virtual') throw new UnprocessableEntityException('Virtual namespace not found');
}

/** The transaction includes PostgreSQL DDL, so a failed provision leaves no registry row or schema. */
export async function createEmptyNamespace(
	database: Knex,
	nameValue: unknown,
	requestKeyValue: unknown
): Promise<NamespaceRecord> {
	const name = validName(nameValue);
	const requestKey = validRequestKey(requestKeyValue);

	return database.transaction(async (trx) => {
		// Serializes retries with the same key before either one can observe an absent row.
		await trx.raw('lock table public.directus_namespaces in share row exclusive mode');
		const prior = await trx('public.directus_namespaces').where({ request_key: requestKey }).first();
		if (prior) {
			if (prior.name !== name) throw new UnprocessableEntityException('Idempotency-Key was used with another name');
			if (prior.readiness !== 'ready') throw new UnprocessableEntityException('Namespace creation is not ready');
			return prior as NamespaceRecord;
		}

		const id = `n_${randomUUID().replaceAll('-', '')}`;
		const schema = `ns_${id}`;
		await trx('public.directus_namespaces').insert({
			id,
			name,
			schema_name: schema,
			kind: 'virtual',
			readiness: 'provisioning',
			request_key: requestKey,
		});
		await trx.raw('create schema ??', [schema]);
		for (const table of await listNamespaceSystemTables(trx)) await copyTable(trx, schema, table);
		await trx('public.directus_namespaces').where({ id }).update({ readiness: 'ready' });
		return (await getNamespace(trx, id))!;
	});
}

/** Only the display label may change. Tokens, memberships, and physical schema keep their ID. */
export async function renameNamespace(database: Knex, id: string, nameValue: unknown): Promise<NamespaceRecord> {
	const name = validName(nameValue);
	return database.transaction(async (trx) => {
		const namespace = await trx('public.directus_namespaces').where({ id }).forUpdate().first();
		assertVirtual(namespace);
		await trx('public.directus_namespaces').where({ id }).update({ name });
		return { ...namespace, name };
	});
}

async function hasRows(trx: Knex.Transaction, table: string, column: string, id: string): Promise<boolean> {
	return Boolean(await trx(`public.${table}`).select(column).where(column, id).first());
}

async function hasColumn(trx: Knex.Transaction, table: string, column: string): Promise<boolean> {
	return Boolean(
		await trx('information_schema.columns')
			.select('column_name')
			.where({ table_schema: 'public', table_name: table, column_name: column })
			.first()
	);
}

/** Locks the data being checked; DROP ... RESTRICT then refuses any unexpected dependency. */
export async function deleteEmptyNamespace(database: Knex, id: string): Promise<void> {
	await database.transaction(async (trx) => {
		const namespace = await trx('public.directus_namespaces').where({ id }).forUpdate().first();
		assertVirtual(namespace);
		if (namespace.readiness !== 'ready') throw new UnprocessableEntityException('Namespace is not ready for deletion');

		const schema = namespace.schema_name as string;
		const systemTables = await listNamespaceSystemTables(trx);
		const tables = (
			await trx('information_schema.tables')
				.select('table_name')
				.where({ table_schema: schema, table_type: 'BASE TABLE' })
		).map((row) => row.table_name as string);
		const extra = tables.filter((table) => !systemTables.includes(table));
		if (extra.length)
			throw new UnprocessableEntityException(`Namespace has collections or data tables: ${extra.join(', ')}`);
		const views = (await trx('information_schema.views').select('table_name').where({ table_schema: schema })).map(
			(row) => row.table_name as string
		);
		const materialized = (await trx('pg_catalog.pg_matviews').select('matviewname').where({ schemaname: schema })).map(
			(row) => row.matviewname as string
		);
		if (views.length || materialized.length) {
			throw new UnprocessableEntityException(`Namespace has views: ${[...views, ...materialized].join(', ')}`);
		}

		// These locks make the row checks fresh through the schema removal, including concurrent writes.
		for (const table of tables.sort()) await trx.raw('lock table ??.?? in access exclusive mode', [schema, table]);
		await trx.raw(
			'lock table public.directus_user_namespaces, public.directus_roles, public.directus_permissions, public.directus_activity, public.directus_revisions, public.directus_files, public.directus_folders in share row exclusive mode'
		);

		const reasons: string[] = [];
		for (const table of tables) {
			if (await trx.withSchema(schema).from(table).first()) reasons.push(`${table} has records`);
		}
		for (const [table, column, label] of [
			['directus_user_namespaces', 'namespace_id', 'memberships'],
			['directus_roles', 'namespace', 'roles'],
			['directus_permissions', 'namespace', 'permissions'],
			['directus_activity', 'namespace', 'activity'],
			['directus_revisions', 'namespace', 'revisions'],
			['directus_files', 'namespace', 'files'],
			['directus_folders', 'namespace', 'folders'],
		] as const) {
			if ((await hasColumn(trx, table, column)) && (await hasRows(trx, table, column, id)))
				reasons.push(`Namespace has ${label}`);
		}
		if (reasons.length) throw new UnprocessableEntityException(`Cannot delete namespace: ${reasons.join('; ')}`);

		try {
			for (const table of tables) await trx.raw('drop table ??.?? restrict', [schema, table]);
			await trx.raw('drop schema ?? restrict', [schema]);
		} catch (error) {
			if ((error as { code?: string }).code === '2BP01') {
				throw new UnprocessableEntityException('Namespace has other dependent database objects');
			}
			throw error;
		}
		await trx('public.directus_namespaces').where({ id }).delete();
	});
}
