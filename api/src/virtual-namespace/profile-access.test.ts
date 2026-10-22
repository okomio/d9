import type { Knex } from 'knex';
import knex from 'knex';
import { createTracker, MockClient, type Tracker } from 'knex-mock-client';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { preferredLandingNamespace } from './profile-access.js';

describe('preferred landing namespace', () => {
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

	test('retains an accessible saved preference', async () => {
		tracker.on.select('directus_users').response({ default_namespace: 'tracking' });
		expect(await preferredLandingNamespace(database, 'user', ['tracking', 'aaa'])).toBe('tracking');
		expect(tracker.history.update).toHaveLength(0);
	});

	test('replaces a revoked preference with the sole eligible child', async () => {
		tracker.on.select('directus_users').response({ default_namespace: 'revoked' });
		tracker.on.update('directus_users').response([]);
		expect(await preferredLandingNamespace(database, 'user', ['aaa'])).toBe('aaa');
		expect(tracker.history.update[0]!.bindings).toContain('aaa');
	});

	test('clears an invalid preference when several children remain', async () => {
		tracker.on.select('directus_users').response({ default_namespace: 'revoked' });
		tracker.on.update('directus_users').response([]);
		expect(await preferredLandingNamespace(database, 'user', ['tracking', 'aaa'])).toBeNull();
		expect(tracker.history.update[0]!.bindings).toContain(null);
	});
});
