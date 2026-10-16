import type { Knex } from 'knex';

/** Files and folders stay in public; existing records belong to the main area. */
export async function up(knex: Knex): Promise<void> {
	for (const table of ['directus_folders', 'directus_files']) {
		if (await knex.schema.hasColumn(table, 'namespace')) continue;
		await knex.schema.alterTable(table, (builder) => {
			builder.string('namespace', 64).notNullable().defaultTo('main').index();
		});
	}
}

export async function down(knex: Knex): Promise<void> {
	for (const table of ['directus_files', 'directus_folders']) {
		if (!(await knex.schema.hasColumn(table, 'namespace'))) continue;
		await knex.schema.alterTable(table, (builder) => builder.dropColumn('namespace'));
	}
}
