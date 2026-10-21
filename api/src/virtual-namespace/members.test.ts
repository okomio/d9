import type { Knex } from 'knex';
import knex from 'knex';
import { createTracker, MockClient, type Tracker } from 'knex-mock-client';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { InvalidPayloadException, UnprocessableEntityException } from '../exceptions/index.js';
import { addMember, lookupUsers, removeMember, updateMemberRole } from './members.js';

describe('namespace member lookup and assignment', () => {
	let database: Knex;
	let tracker: Tracker;

	beforeEach(() => {
		database = knex({ client: MockClient, dialect: 'pg' });
		tracker = createTracker(database);
	});

	afterEach(async () => {
		tracker.reset();
		await database.destroy();
	});

	test('requires meaningful search before reading the shared user table', async () => {
		for (const search of [undefined, '', 'a', '%_', '  a  ']) {
			await expect(lookupUsers(database, 'tracking', search)).rejects.toBeInstanceOf(InvalidPayloadException);
		}

		expect(tracker.history.all).toHaveLength(0);
	});

	test('caps results at 20 and escapes wildcard input', async () => {
		tracker.on.select('directus_users').response([]);
		await lookupUsers(database, 'tracking', 'a_b', 1000);

		expect(tracker.history.select).toHaveLength(1);
		expect(tracker.history.select[0]!.sql).toContain('limit');
		expect(tracker.history.select[0]!.bindings).toContain(20);
		expect(tracker.history.select[0]!.bindings).toContain('%a\\_b%');
		expect(tracker.history.select[0]!.bindings).toContain('tracking');
	});

	test('adds a namespace membership without changing the shared user record', async () => {
		tracker.on.select('directus_roles').response({ id: 'role', namespace: 'tracking' });
		tracker.on.select('directus_users').response({ id: 'user' });
		tracker.on.select('directus_user_namespaces').response(undefined);
		tracker.on.insert('directus_user_namespaces').response([]);

		await addMember(database, 'tracking', 'user', 'role');

		expect(tracker.history.insert).toHaveLength(1);
		expect(tracker.history.insert[0]!.sql).toContain('directus_user_namespaces');
		expect(tracker.history.update).toHaveLength(0);
	});

	test('moves an existing member to the selected local role only', async () => {
		tracker.on.select(/select "id", "namespace" from "directus_roles"/).response({ id: 'next', namespace: 'tracking' });
		tracker.on.select('directus_namespaces').response({ id: 'tracking' });
		tracker.on.select(/select "admin_access" from "directus_roles"/).response({ admin_access: false });
		tracker.on.select('directus_user_namespaces').response({ role_id: 'old', admin_access: false });
		tracker.on.update('directus_user_namespaces').response([]);

		await updateMemberRole(database, 'tracking', 'user', 'next');

		expect(tracker.history.update).toHaveLength(1);
		expect(tracker.history.update[0]!.sql).toContain('directus_user_namespaces');
		expect(tracker.history.update[0]!.sql).not.toContain('directus_users');
	});

	test('does not demote or remove the last local admin', async () => {
		tracker.on
			.select(/select "id", "namespace" from "directus_roles"/)
			.response({ id: 'viewer', namespace: 'tracking' });

		tracker.on.select('directus_namespaces').response({ id: 'tracking' });
		tracker.on.select(/select "m"\."role_id", "r"\."admin_access"/).response({ role_id: 'admin', admin_access: true });
		tracker.on.select(/select "admin_access" from "directus_roles"/).response({ admin_access: false });
		tracker.on.select(/count\(\*\)/).response([{ count: '0' }]);

		await expect(updateMemberRole(database, 'tracking', 'user', 'viewer')).rejects.toBeInstanceOf(
			UnprocessableEntityException
		);

		await expect(removeMember(database, 'tracking', 'user')).rejects.toBeInstanceOf(UnprocessableEntityException);
		expect(tracker.history.update).toHaveLength(0);
		expect(tracker.history.delete).toHaveLength(0);
	});
});
