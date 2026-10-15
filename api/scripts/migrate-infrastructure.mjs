#!/usr/bin/env node
/**
 * Move each area of the Infrastructure instance out of the `public` schema and
 * into its own virtual namespace.
 *
 *   node scripts/migrate-infrastructure.mjs            dry run — prints the plan, changes nothing
 *   node scripts/migrate-infrastructure.mjs --apply    performs the migration
 *   node scripts/migrate-infrastructure.mjs --verify   reports anything still left in public
 *   node scripts/migrate-infrastructure.mjs --status   says whether this database needs the
 *                                                      migration; exit 0 only when it does not
 *
 * Prerequisites, in order:
 *   1. The instance this is meant to transform (restore the dump first, e.g.
 *      `cms/directus-v9/development/run.sh --apply-backup-from=…`).
 *   2. `npx tsc --build` in `api/`, so `dist/` matches `src/`.
 *   3. `node dist/cli/run.js database migrate:latest` — the registry table, the
 *      `namespace` columns and the membership table come from there.
 *
 * The migration is one-way for the data in `public`: tables are MOVED, not
 * copied. It is idempotent, so wiping the database and running it again is the
 * expected loop rather than an exception. Take a dump before `--apply` anyway.
 *
 * Run from `api/`. Connection settings come from the environment, with the same
 * defaults the local stack uses.
 */
import knexFactory from 'knex';

import {
	dryRun,
	migrateInfrastructure,
	migrationStatus,
	verifyMigration,
} from '../dist/virtual-namespace/migrate-infrastructure.js';

const args = new Set(process.argv.slice(2));

if (args.has('--help') || args.has('-h')) {
	console.log('usage: node scripts/migrate-infrastructure.mjs [--status|--apply|--verify]');
	process.exit(0);
}

const database = knexFactory({
	client: 'pg',
	connection: {
		host: process.env.DB_HOST ?? 'localhost',
		port: Number(process.env.DB_PORT ?? 5432),
		user: process.env.DB_USER ?? 'directus',
		password: process.env.DB_PASSWORD ?? 'directus',
		database: process.env.DB_DATABASE ?? 'directus',
	},
	pool: { min: 0, max: 4 },
});

const pad = (value, width) => String(value).padEnd(width);

function printPlan(plan) {
	console.log('\n── areas to move ──');

	for (const area of plan.areas) {
		const state =
			area.tables.length === 0 && area.namespaceTables > 0 ? 'already migrated' : area.registered ? 'registered' : 'new';
		console.log(
			`  ${pad(area.area, 14)} → ${pad(area.schema, 16)} ${pad(`${area.tables.length} tables`, 11)}` +
				` ${pad(`${area.metadata.collections} collections / ${area.metadata.fields} fields / ${area.metadata.relations} relations`, 46)}` +
				` ${state}`
		);

		if (area.excluded.length) console.log(`      stays in public: ${area.excluded.join(', ')}`);
		if (area.foldersWithoutTable.length) console.log(`      folder rows only: ${area.foldersWithoutTable.join(', ')}`);
	}

	console.log('\n── roles → namespace ──');
	for (const role of plan.roles) {
		console.log(`  ${pad(role.name, 36)} ${pad(`${role.users} users`, 10)} ${role.from} → ${role.to}`);
	}

	if (plan.memberships.length) {
		console.log('\n── memberships to create ──');
		for (const entry of plan.memberships) {
			console.log(`  ${pad(entry.namespace, 16)} ${pad(entry.role, 36)} ${entry.users} users`);
		}
	}

	if (plan.crossAreaForeignKeys.length) {
		console.log('\n── foreign keys crossing two areas (they survive the move) ──');
		for (const fk of plan.crossAreaForeignKeys) console.log(`  ${fk.from} → ${fk.to}`);
	}

	console.log(`\n── flows ──  ${plan.flows.active} active, ${plan.flows.inactive} inactive (not moved by this migration)`);

	console.log(`\n── blockers / notes (${plan.blockers.length}) ──`);
	for (const blocker of plan.blockers) console.log(`  • ${blocker}`);
	if (plan.blockers.length === 0) console.log('  none');
}

try {
	if (args.has('--apply')) {
		const result = await migrateInfrastructure(database);

		console.log('\n── applied ──');

		for (const area of result.areas) {
			console.log(
				`  ${pad(area.id, 16)} → ${pad(area.schema, 16)} ${pad(`${area.tablesMoved.length} tables moved`, 20)}` +
					` ${area.metadataMoved.collections} collections / ${area.metadataMoved.fields} fields / ${area.metadataMoved.relations} relations` +
					(area.metadataMoved.aliasFields ? ` / ${area.metadataMoved.aliasFields} alias field(s)` : '') +
					`${area.registered ? '  (registered now)' : ''}`
			);
		}

		console.log(`\n  roles updated:      ${result.rolesUpdated}`);
		console.log(`  memberships created: ${result.membershipsCreated}`);

		const { leftovers } = await verifyMigration(database);

		console.log(`\n── verify ──  ${leftovers.length} area collection(s) still in public`);
		for (const leftover of leftovers) console.log(`  ${leftover.area}: ${leftover.collection} (${leftover.reason})`);
	} else if (args.has('--status')) {
		const status = await migrationStatus(database);

		console.log(`status: ${status.state}`);
		console.log(`  ${status.detail}`);

		if (status.state === 'migrated') {
			console.log('\nNothing to do — carry on.\n');
		} else {
			console.log('\nDo not start other work on this branch until this is resolved.');
			console.log('See api/scripts/migrate-infrastructure.md\n');
			process.exitCode = 1;
		}
	} else if (args.has('--verify')) {
		const { leftovers } = await verifyMigration(database);

		console.log(`area collections still in public: ${leftovers.length}`);
		for (const leftover of leftovers) console.log(`  ${leftover.area}: ${leftover.collection} (${leftover.reason})`);
	} else {
		printPlan(await dryRun(database));
		console.log('\nDry run — nothing was changed. Re-run with --apply to perform the migration.\n');
	}
} catch (error) {
	console.error(`\nmigration failed: ${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
} finally {
	await database.destroy();
}
