import type { Accountability } from '@wbce-d9/types';
import type { Knex } from 'knex';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ForbiddenException } from '../exceptions/index.js';
import {
	assertNamespaceOwnedWrite,
	assertSharedWrite,
	hasGlobalAuthority,
	resolveSharedAccountability,
} from './authority.js';
import { runWithNamespace } from './context.js';

afterEach(() => vi.unstubAllEnvs());

function sharedDatabase(row: Record<string, unknown> | undefined) {
	const query = {
		select: vi.fn().mockReturnThis(),
		from: vi.fn().mockReturnThis(),
		leftJoin: vi.fn().mockReturnThis(),
		where: vi.fn().mockReturnThis(),
		first: vi.fn().mockResolvedValue(row),
	};

	return query as unknown as Knex;
}

describe('shared authority', () => {
	test('preserves legacy custom and internal accountability without schema lookups', async () => {
		vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'false');
		const identity = { role: 'legacy', admin: true };
		expect(await resolveSharedAccountability({} as Knex, identity)).toBe(identity);
		expect(hasGlobalAuthority(identity)).toBe(true);
	});

	test.each(['virtual', undefined])('a %s primary role cannot grant instance authority', async (kind) => {
		vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'true');

		const result = await resolveSharedAccountability(
			sharedDatabase({ role: 'child-admin', kind, admin_access: true, app_access: true }),
			{ user: 'user', role: 'child-admin', admin: true, globalAdmin: true }
		);

		expect(result).toMatchObject({ role: null, admin: false, app: false, globalAdmin: false });
	});

	test('uses current main-role flags instead of stale token or custom flags', async () => {
		vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'true');

		const result = await resolveSharedAccountability(
			sharedDatabase({ role: 'current-main-reader', kind: 'main', admin_access: false, app_access: true }),
			{ user: 'user', role: 'stale-main-admin', admin: true, globalAdmin: true }
		);

		expect(result).toMatchObject({ role: 'current-main-reader', admin: false, app: true, globalAdmin: false });
	});

	test('recognizes a current main admin independently of the supplied child role', async () => {
		vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'true');

		const result = await resolveSharedAccountability(
			sharedDatabase({ role: 'main-admin', kind: 'main', admin_access: true, app_access: true }),
			{ user: 'user', role: 'child-reader', admin: false }
		);

		expect(result).toMatchObject({ role: 'main-admin', admin: true, globalAdmin: true });
	});

	test('shares retain their scoped role and never gain global authority', async () => {
		vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'true');

		const result = await resolveSharedAccountability({} as Knex, {
			role: 'share-role',
			share: 'share',
			admin: true,
		});

		expect(result).toMatchObject({ role: 'share-role', admin: false, globalAdmin: false });
	});

	test('blocks local admin shared writes while preserving local content and trusted work', () => {
		vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'true');

		runWithNamespace({ id: 'child', schema: 'ns_child' }, () => {
			const local = { role: 'local-admin', admin: true, globalAdmin: false };

			for (const collection of ['directus_users', 'directus_settings', 'directus_files']) {
				expect(() => assertSharedWrite(collection, local)).toThrow(ForbiddenException);
				expect(() => assertSharedWrite(collection, null)).not.toThrow();
				expect(() => assertSharedWrite(collection, { ...local, globalAdmin: true })).not.toThrow();
			}

			expect(() => assertSharedWrite('content', local)).not.toThrow();
		});
	});

	test('namespace ownership cannot be moved by an explicit payload', async () => {
		vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'true');
		const local: Accountability = { role: 'local-admin', admin: true, globalAdmin: false };

		await runWithNamespace({ id: 'child', schema: 'ns_child' }, async () => {
			await expect(
				assertNamespaceOwnedWrite({} as Knex, 'directus_roles', local, { namespace: 'main' })
			).rejects.toThrow(ForbiddenException);

			await expect(
				assertNamespaceOwnedWrite({} as Knex, 'directus_roles', local, { namespace: 'child' })
			).resolves.toBeUndefined();
		});
	});

	test.each([
		['create', 'main-role', undefined],
		['nested create', { id: 'main-role' }, undefined],
		['update', 'main-role', ['permission']],
		['nested update', { id: 'main-role' }, ['permission']],
	])('a local permission %s cannot target a main-owned role', async (_action, role, keys) => {
		vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'true');

		const query = {
			select: vi.fn().mockReturnThis(),
			where: vi.fn().mockReturnThis(),
			first: vi.fn().mockResolvedValue({ namespace: 'main' }),
		};

		const database = vi.fn(() => query);
		const local = { role: 'local-admin', admin: true, globalAdmin: false };

		await runWithNamespace({ id: 'child', schema: 'ns_child' }, async () => {
			await expect(
				assertNamespaceOwnedWrite(database as unknown as Knex, 'directus_permissions', local, { role }, keys)
			).rejects.toThrow(ForbiddenException);
		});

		expect(database).toHaveBeenCalledWith('public.directus_roles');
		expect(query.where).toHaveBeenCalledWith('id', 'main-role');
	});

	test.each(['child-role', { id: 'child-role' }])('local permissions may target their own role: %j', async (role) => {
		vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'true');

		const query = {
			select: vi.fn().mockReturnThis(),
			where: vi.fn().mockReturnThis(),
			whereIn: vi.fn().mockReturnThis(),
			whereNotNull: vi.fn().mockReturnThis(),
			leftJoin: vi.fn().mockReturnThis(),
			andWhere: vi.fn().mockReturnThis(),
			first: vi.fn().mockResolvedValueOnce({ namespace: 'child' }).mockResolvedValueOnce(undefined),
		};

		const database = vi.fn(() => query) as unknown as Knex;
		const local = { role: 'local-admin', admin: true, globalAdmin: false };

		await runWithNamespace({ id: 'child', schema: 'ns_child' }, async () => {
			await expect(
				assertNamespaceOwnedWrite(database, 'directus_permissions', local, { role }, ['permission'])
			).resolves.toBeUndefined();
		});
	});

	test.each([
		['update', {}],
		['delete', undefined],
	])('a malformed local permission cannot alter a main role through %s', async (_action, data) => {
		vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'true');

		const query = {
			select: vi.fn().mockReturnThis(),
			whereIn: vi.fn().mockReturnThis(),
			whereNotNull: vi.fn().mockReturnThis(),
			leftJoin: vi.fn().mockReturnThis(),
			andWhere: vi.fn().mockReturnThis(),
			first: vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce({ id: 'malformed-permission' }),
		};

		const database = vi.fn(() => query);
		const local = { role: 'local-admin', admin: true, globalAdmin: false };

		await runWithNamespace({ id: 'child', schema: 'ns_child' }, async () => {
			await expect(
				assertNamespaceOwnedWrite(database as unknown as Knex, 'directus_permissions', local, data, ['permission'])
			).rejects.toThrow(ForbiddenException);
		});

		expect(database).toHaveBeenCalledWith('public.directus_permissions as permission');
		expect(query.whereNotNull).toHaveBeenCalledWith('permission.role');
	});

	test('preserves global, trusted, disabled and null-role permission writes', async () => {
		vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'true');
		const database = {} as Knex;
		const local = { role: 'local-admin', admin: true, globalAdmin: false };

		await runWithNamespace({ id: 'child', schema: 'ns_child' }, async () => {
			await expect(
				assertNamespaceOwnedWrite(database, 'directus_permissions', { ...local, globalAdmin: true }, { role: 'main' })
			).resolves.toBeUndefined();

			await expect(
				assertNamespaceOwnedWrite(database, 'directus_permissions', null, { role: 'main' })
			).resolves.toBeUndefined();

			await expect(
				assertNamespaceOwnedWrite(database, 'directus_permissions', local, { role: null })
			).resolves.toBeUndefined();

			vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'false');

			await expect(
				assertNamespaceOwnedWrite(database, 'directus_permissions', local, { role: 'main' })
			).resolves.toBeUndefined();
		});
	});
});
