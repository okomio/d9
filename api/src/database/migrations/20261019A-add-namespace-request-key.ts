import type { Knex } from 'knex';

/** Retain create requests so a lost HTTP response cannot create a second namespace. */
export async function up(knex: Knex): Promise<void> {
	await knex.schema.alterTable('directus_namespaces', (table) => {
		table.uuid('request_key').nullable().unique();
	});
}

export async function down(knex: Knex): Promise<void> {
	await knex.schema.alterTable('directus_namespaces', (table) => {
		table.dropColumn('request_key');
	});
}
