import type { Knex } from 'knex';

/**
 * Adds the `namespace` column to the shared control-plane tables that are
 * filtered by it.
 *
 * `roles`, `permissions`, `activity` and `revisions` stay shared tables rather
 * than being copied per namespace — duplicating the permission matrix per area
 * would be worse, and the global directory needs to see across areas. What they
 * lacked was a way to tell which area a row belongs to, so every namespace saw
 * every area's roles, permissions and audit records.
 *
 * Existing rows belong to the namespace that currently holds them, which is the
 * main one.
 */
const TABLES = ['directus_activity', 'directus_permissions', 'directus_revisions', 'directus_roles'];

const MAIN = 'main';

export async function up(knex: Knex): Promise<void> {
	for (const table of TABLES) {
		if (await knex.schema.hasColumn(table, 'namespace')) continue;

		await knex.schema.alterTable(table, (t) => {
			t.string('namespace', 64).nullable();
		});

		await knex(table).update({ namespace: MAIN });
	}
}

export async function down(knex: Knex): Promise<void> {
	for (const table of TABLES) {
		if (!(await knex.schema.hasColumn(table, 'namespace'))) continue;

		await knex.schema.alterTable(table, (t) => {
			t.dropColumn('namespace');
		});
	}
}
