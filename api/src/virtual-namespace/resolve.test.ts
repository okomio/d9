import type { Knex } from 'knex';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { pickNamespace, resolveLegacyDefaultNamespace } from './resolve.js';

afterEach(() => vi.unstubAllEnvs());

describe('pickNamespace', () => {
	test('prefers the token claim over the header and the default', () => {
		expect(pickNamespace({ claimed: 'ns_a', header: 'ns_b', fallback: 'main' })).toBe('ns_a');
	});

	test('falls back to the header, then to the default', () => {
		expect(pickNamespace({ header: 'ns_b', fallback: 'main' })).toBe('ns_b');
		expect(pickNamespace({ fallback: 'main' })).toBe('main');
	});

	test('ignores blank values', () => {
		expect(pickNamespace({ claimed: '   ', header: '', fallback: 'main' })).toBe('main');
	});

	test('returns nothing when no candidate is present', () => {
		expect(pickNamespace({})).toBeUndefined();
	});

	test('trims candidates', () => {
		expect(pickNamespace({ claimed: ' ns_a ' })).toBe('ns_a');
	});
});

describe('legacy owner defaults', () => {
	function database(namespace?: string | null) {
		return {
			select: vi.fn().mockReturnThis(),
			from: vi.fn().mockReturnThis(),
			leftJoin: vi.fn().mockReturnThis(),
			where: vi.fn().mockReturnThis(),
			first: vi.fn().mockResolvedValue({ namespace }),
		};
	}

	test('reads the current authenticated owner mapping from the shared tables', async () => {
		vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'true');
		vi.stubEnv('VIRTUAL_NAMESPACES_DEFAULT', 'main');
		const query = database(' tracking ');

		expect(await resolveLegacyDefaultNamespace(query as unknown as Knex, 'owner')).toBe('tracking');
		expect(query.from).toHaveBeenCalledWith('public.directus_users as u');
		expect(query.leftJoin).toHaveBeenCalledWith('public.directus_roles as r', 'u.role', 'r.id');
		expect(query.where).toHaveBeenCalledWith('u.id', 'owner');
	});

	test.each([undefined, null, '', '   '])(
		'uses the instance default only without an owner mapping: %s',
		async (namespace) => {
			vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'true');
			vi.stubEnv('VIRTUAL_NAMESPACES_DEFAULT', ' main ');
			expect(await resolveLegacyDefaultNamespace(database(namespace) as unknown as Knex, 'owner')).toBe('main');
		}
	);

	test('does not replace an invalid owner target with the instance default', async () => {
		vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'true');
		vi.stubEnv('VIRTUAL_NAMESPACES_DEFAULT', 'main');
		expect(await resolveLegacyDefaultNamespace(database('missing') as unknown as Knex, 'owner')).toBe('missing');
	});

	test('returns no candidate when neither mapping exists', async () => {
		vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'true');
		vi.stubEnv('VIRTUAL_NAMESPACES_DEFAULT', ' ');
		expect(await resolveLegacyDefaultNamespace(database() as unknown as Knex, 'owner')).toBeUndefined();
	});

	test('does no database work in disabled mode or without an authenticated owner', async () => {
		vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'false');
		vi.stubEnv('VIRTUAL_NAMESPACES_DEFAULT', 'main');
		expect(await resolveLegacyDefaultNamespace({} as Knex, 'owner')).toBeUndefined();
		vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'true');
		expect(await resolveLegacyDefaultNamespace({} as Knex, null)).toBeUndefined();
	});
});
