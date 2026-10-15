import knex from 'knex';
import { createTracker, MockClient } from 'knex-mock-client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	canEnterNamespace,
	describeNamespaceContext,
	listAccessibleNamespaces,
	resolveNamespaceRole,
} from './access.js';
import { getNamespace, listNamespaces, type NamespaceRecord } from './registry.js';

vi.mock('./registry.js', () => ({ getNamespace: vi.fn(), listNamespaces: vi.fn() }));

const main: NamespaceRecord = { id: 'main', name: 'Main', kind: 'main', schema_name: 'public', readiness: 'ready' };
const peer: NamespaceRecord = { id: 'peer', name: 'Peer', kind: 'virtual', schema_name: 'ns_peer', readiness: 'ready' };
const caller = { user: 'owner', role: 'main-reader', admin: false, app: true };
const role = { id: 'main-reader', name: 'Main reader', admin_access: false, app_access: true };
let database: ReturnType<typeof knex.default>;
let tracker: ReturnType<typeof createTracker>;
let memberships: Record<string, unknown>[];

beforeEach(() => {
	vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'true');
	vi.stubEnv('VIRTUAL_NAMESPACES_DEFAULT', 'main');
	database = knex.default({ client: MockClient });
	tracker = createTracker(database);

	vi.mocked(getNamespace).mockImplementation(async (_database, id) =>
		[main, peer].find((namespace) => namespace.id === id)
	);

	vi.mocked(listNamespaces).mockResolvedValue([main, peer]);

	memberships = [
		{ namespace_id: 'peer', role_id: 'peer-reader', role_name: 'Peer reader', admin_access: false, app_access: true },
	];

	tracker.on.select(/from "public"\."directus_roles"/).response([role]);
	tracker.on.select(/from "public"\."directus_users"/).response([{ namespace: 'peer', role: 'main-reader' }]);
	tracker.on.select(/from "public"\."directus_user_namespaces"/).response(() => memberships);
});

afterEach(async () => {
	await database.destroy();
	vi.resetAllMocks();
	vi.unstubAllEnvs();
});

describe('default namespace access reporting', () => {
	test('listing and auth context describe the owner default instead of the instance default', async () => {
		expect((await listAccessibleNamespaces(database, caller)).default).toBe('peer');

		expect((await describeNamespaceContext(database, caller)).namespace).toMatchObject({
			id: 'peer',
			local_role: { id: 'peer-reader' },
			can_enter: true,
		});
	});

	test('an inaccessible owner mapping returns null instead of selecting an accessible main namespace', async () => {
		memberships = [];
		expect((await listAccessibleNamespaces(database, caller)).default).toBeNull();
		expect((await describeNamespaceContext(database, caller)).namespace).toBeNull();
	});

	test('unready defaults are null while discovery retains the unready choice', async () => {
		const unready = { ...peer, readiness: 'provisioning' as const };
		vi.mocked(listNamespaces).mockResolvedValue([main, unready]);
		vi.mocked(getNamespace).mockResolvedValue(unready);
		const listing = await listAccessibleNamespaces(database, caller);
		expect(listing.default).toBeNull();
		expect(listing.data.find((namespace) => namespace.id === 'peer')?.can_enter).toBe(false);
		expect((await describeNamespaceContext(database, caller)).namespace).toBeNull();
	});

	test('main resolves through the shared role without any membership', async () => {
		memberships = [];
		expect(await resolveNamespaceRole(database, caller, main)).toEqual(role);
		expect(await canEnterNamespace(database, 'owner', 'main')).toBe(true);
	});

	test('explicit target context does not consult the owner default', async () => {
		expect((await describeNamespaceContext(database, caller, 'main')).namespace?.id).toBe('main');
		expect(tracker.history.select.some((query) => query.sql.includes('directus_users'))).toBe(false);
	});

	test('unknown and unready targets cannot be minted even by Global Admin', async () => {
		vi.mocked(getNamespace).mockResolvedValue(undefined);
		expect(await canEnterNamespace(database, 'owner', 'missing', { isGlobalAdmin: true })).toBe(false);
		vi.mocked(getNamespace).mockResolvedValue({ ...peer, readiness: 'provisioning' });
		expect(await canEnterNamespace(database, 'owner', 'peer', { isGlobalAdmin: true })).toBe(false);
	});

	test('disabled auth context performs no namespace work', async () => {
		vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'false');
		expect(await describeNamespaceContext(database, caller)).toEqual({ is_global_admin: false, namespace: null });
		expect(getNamespace).not.toHaveBeenCalled();
	});
});
