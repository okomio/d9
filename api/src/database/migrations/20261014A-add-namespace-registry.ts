import type { Knex } from 'knex';

const NAMESPACES = 'directus_namespaces';
const MEMBERSHIPS = 'directus_user_namespaces';
const MEMBERSHIP_COLUMN = 'namespace_id';

/**
 * Namespace registry.
 *
 * A namespace gets a stable `id` that is independent of both its display name
 * and its physical Postgres schema. Renaming a label therefore never
 * invalidates a token or a membership, and the schema stays an internal detail.
 *
 * `directus_user_namespaces` may already exist from the S1–S3 spike, created by
 * hand rather than by a migration, so this migrates either shape: it creates the
 * final one when absent, and upgrades in place when present.
 */
export async function up(knex: Knex): Promise<void> {
	if (!(await knex.schema.hasTable(NAMESPACES))) {
		await knex.schema.createTable(NAMESPACES, (table) => {
			table.string('id', 64).primary();
			table.string('name', 255).notNullable();
			table.string('schema_name', 64).notNullable().unique();
			table.string('kind', 16).notNullable().defaultTo('virtual');
			table.string('readiness', 16).notNullable().defaultTo('provisioning');
			table.integer('sort').nullable();
			table.timestamp('date_created').defaultTo(knex.fn.now());
		});
	}

	// The main namespace is the existing shared schema. It is what legacy,
	// claim-less tokens resolve to, so it must exist on every instance.
	await knex(NAMESPACES)
		.insert({
			id: 'main',
			name: 'Infrastructure',
			schema_name: 'public',
			kind: 'main',
			readiness: 'ready',
			sort: 0,
		})
		.onConflict('id')
		.ignore();

	if (!(await knex.schema.hasTable(MEMBERSHIPS))) {
		await knex.schema.createTable(MEMBERSHIPS, (table) => {
			table.uuid('id').primary();
			table.uuid('user_id').notNullable();
			table.string(MEMBERSHIP_COLUMN, 64).notNullable().references('id').inTable(NAMESPACES).onDelete('CASCADE');
			table.uuid('role_id').nullable().references('id').inTable('directus_roles').onDelete('CASCADE');
			table.unique(['user_id', MEMBERSHIP_COLUMN]);
		});

		return;
	}

	await migrateMembershipsInPlace(knex);
}

/**
 * Upgrades the hand-made table: a surrogate primary key (Directus ignores a
 * table whose only key is composite and logs a warning on every boot) and a
 * registry foreign key instead of a free-text namespace name.
 */
async function migrateMembershipsInPlace(knex: Knex): Promise<void> {
	if (!(await knex.schema.hasColumn(MEMBERSHIPS, 'id'))) {
		await knex.schema.alterTable(MEMBERSHIPS, (table) => {
			table.uuid('id');
		});

		await knex.raw(`update ${MEMBERSHIPS} set id = gen_random_uuid() where id is null`);
		await knex.raw(`alter table ${MEMBERSHIPS} alter column id set not null`);
		await knex.raw(`alter table ${MEMBERSHIPS} drop constraint if exists ${MEMBERSHIPS}_pkey`);
		await knex.raw(`alter table ${MEMBERSHIPS} add constraint ${MEMBERSHIPS}_pkey primary key (id)`);
	}

	if (await knex.schema.hasColumn(MEMBERSHIPS, 'namespace')) {
		await knex.schema.alterTable(MEMBERSHIPS, (table) => {
			table.renameColumn('namespace', MEMBERSHIP_COLUMN);
		});
	}

	const uniqueExists = await knex
		.raw(
			`select 1 from pg_constraint where conname = ? and conrelid = ?::regclass`,
			[`${MEMBERSHIPS}_user_id_${MEMBERSHIP_COLUMN}_unique`, MEMBERSHIPS]
		)
		.then((result) => result.rowCount > 0);

	if (!uniqueExists) {
		await knex.schema.alterTable(MEMBERSHIPS, (table) => {
			table.unique(['user_id', MEMBERSHIP_COLUMN]);
		});
	}
}

export async function down(knex: Knex): Promise<void> {
	if (await knex.schema.hasColumn(MEMBERSHIPS, MEMBERSHIP_COLUMN)) {
		await knex.schema.alterTable(MEMBERSHIPS, (table) => {
			table.renameColumn(MEMBERSHIP_COLUMN, 'namespace');
		});
	}

	await knex.schema.dropTableIfExists(NAMESPACES);
}
