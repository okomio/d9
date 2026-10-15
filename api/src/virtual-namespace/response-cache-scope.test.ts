import { knex } from 'knex';
import { createTracker, MockClient } from 'knex-mock-client';
import { afterAll, expect, it } from 'vitest';
import { getNamespaceMembershipFingerprint } from './response-cache-scope.js';

const database = knex({ client: MockClient });
const tracker = createTracker(database);

afterAll(async () => database.destroy());

it('reads fresh membership state from the shared source before every cache lookup', async () => {
	tracker.on.select('directus_user_namespaces').responseOnce([{ fingerprint: 'before-removal' }]);
	tracker.on.select('directus_user_namespaces').responseOnce([{ fingerprint: 'after-removal' }]);

	expect(await getNamespaceMembershipFingerprint(database, 'child')).toBe('before-removal');
	expect(await getNamespaceMembershipFingerprint(database, 'child')).toBe('after-removal');
	expect(tracker.history.select).toHaveLength(2);
	expect(tracker.history.select[0]!.sql).toContain('from "public"."directus_user_namespaces"');
	expect(tracker.history.select[0]!.bindings).toEqual(['[]', 'child', 1]);
});
