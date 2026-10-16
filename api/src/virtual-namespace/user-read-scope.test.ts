import { knex } from 'knex';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runWithNamespace } from './context.js';
import { applySharedUserReadScope } from './user-read-scope.js';

const database = knex({ client: 'pg' });
const caller = { user: 'local-admin', role: 'child-admin', admin: true, globalAdmin: false };
const namespace = { id: 'child', schema: 'ns_child', kind: 'virtual' } as const;

beforeEach(() => vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'true'));
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => database.destroy());

describe('shared user SQL visibility', () => {
	it('scopes the SQL source used by users, joined filters, sorting and aggregate subqueries', () => {
		const query = database
			.select('tracking_events.id')
			.from('tracking_events')
			.leftJoin({ owner: 'directus_users' }, 'tracking_events.owner', 'owner.id')
			.where('owner.email', 'outsider@example.com')
			.orderBy('owner.email');

		const scoped = runWithNamespace(namespace, () => applySharedUserReadScope(database, query, caller).toSQL());

		expect(scoped.sql).toContain('with "directus_users" as (select "shared_user".* from "public"."directus_users"');
		expect(scoped.sql).toContain('from "public"."directus_user_namespaces" as "membership"');
		expect(scoped.sql).toContain('"membership"."user_id" = "shared_user"."id"');
		expect(scoped.bindings).toEqual(['child', 'outsider@example.com']);
		expect(scoped.sql).toContain('left join "directus_users" as "owner"');
	});

	it('uses an explicit self predicate for identity reads without namespace access', () => {
		const query = applySharedUserReadScope(database, database.select('id').from('directus_users'), caller, 'self');

		expect(query.toSQL().sql).toContain('"shared_user"."id" = ?');
		expect(query.toSQL().bindings).toEqual(['local-admin']);
		expect(query.toSQL().sql).not.toContain('directus_user_namespaces');
	});

	it('keeps expanded identity reads self-only for Global Admins too', () => {
		const query = applySharedUserReadScope(
			database,
			database.select('id').from('directus_users'),
			{ ...caller, globalAdmin: true },
			'self'
		);

		expect(query.toSQL().bindings).toEqual(['local-admin']);
	});

	it('preserves the main namespace directory under its existing ACLs', () => {
		const sql = runWithNamespace({ id: 'renamed-main', schema: 'public', kind: 'main' }, () =>
			applySharedUserReadScope(database, database.select('id').from('directus_users'), caller).toSQL()
		);

		expect(sql.sql).not.toContain('with ');
	});

	it.each([
		{ user: null, role: null, admin: true, globalAdmin: false },
		{ user: null, role: 'child-execution-role', admin: false, globalAdmin: false },
	])('scopes non-global execution identity $role/$admin to child members', (accountability) => {
		const sql = runWithNamespace(namespace, () =>
			applySharedUserReadScope(database, database.select('id').from('directus_users'), accountability).toSQL()
		);

		expect(sql.sql).toContain('with "directus_users" as');
		expect(sql.bindings).toEqual(['child']);
	});

	it('does not interpret a system execution identity as a personal self scope', () => {
		expect(() =>
			applySharedUserReadScope(
				database,
				database.select('id').from('directus_users'),
				{ user: null, role: null, admin: true, globalAdmin: false },
				'self'
			)
		).toThrow("You don't have permission to access this.");
	});

	it.each([
		['internal', null],
		['anonymous', { role: null, user: null }],
		['Global Admin', { ...caller, globalAdmin: true }],
		['verified global system execution', { user: null, role: null, admin: true, globalAdmin: true }],
		['share execution', { role: 'share-role', share: 'share-id', user: null }],
	])('preserves the %s source', (_label, accountability) => {
		const query = database.select('id').from('directus_users');
		const sql = query.toSQL();
		const scoped = runWithNamespace(namespace, () => applySharedUserReadScope(database, query, accountability).toSQL());

		expect(scoped.sql).toBe(sql.sql);
		expect(scoped.bindings).toEqual(sql.bindings);
	});

	it('preserves legacy reads when namespaces are disabled or no namespace is selected', () => {
		const unselected = database.select('id').from('directus_users');
		expect(applySharedUserReadScope(database, unselected, caller).toSQL().sql).not.toContain('with ');

		vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'false');

		const disabled = runWithNamespace(namespace, () =>
			applySharedUserReadScope(database, database.select('id').from('directus_users'), caller).toSQL()
		);

		expect(disabled.sql).not.toContain('with ');
	});
});
