import type { Knex } from 'knex';
import { afterEach, expect, test, vi } from 'vitest';
import { defaultAdminRole, getDefaultAdminRole } from './defaults.js';

afterEach(() => vi.unstubAllEnvs());

test('preserves the exact legacy admin role payload without namespace queries', async () => {
	vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'false');
	expect(await getDefaultAdminRole({} as Knex)).toBe(defaultAdminRole);
});

test('owns the first admin role by the registry main namespace independently of the configured default', async () => {
	vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'true');
	vi.stubEnv('VIRTUAL_NAMESPACES_DEFAULT', 'child-default');

	const query = {
		select: vi.fn().mockReturnThis(),
		from: vi.fn().mockReturnThis(),
		where: vi.fn().mockReturnThis(),
		first: vi.fn().mockResolvedValue({ id: 'registry-main' }),
	};

	expect(await getDefaultAdminRole(query as unknown as Knex)).toEqual({
		...defaultAdminRole,
		namespace: 'registry-main',
	});

	expect(query.from).toHaveBeenCalledWith('public.directus_namespaces');
	expect(query.where).toHaveBeenCalledWith('kind', 'main');
});

test('refuses enabled initialization without a registered main namespace', async () => {
	vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'true');

	const query = {
		select: vi.fn().mockReturnThis(),
		from: vi.fn().mockReturnThis(),
		where: vi.fn().mockReturnThis(),
		first: vi.fn().mockResolvedValue(undefined),
	};

	await expect(getDefaultAdminRole(query as unknown as Knex)).rejects.toThrow('The main namespace must exist');
});
