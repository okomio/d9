import { describe, expect, test } from 'vitest';
import type { Request, Response } from 'express';
import { isAlwaysBlockedWrite, namespaceOwnedWrite, targetIdFromPath } from './admin-scope.js';
import { namespaceAdminScope } from './middleware.js';

describe('isAlwaysBlockedWrite', () => {
	test('blocks instance-wide surfaces', () => {
		expect(isAlwaysBlockedWrite('POST', '/users')).toBe(true);
		expect(isAlwaysBlockedWrite('PATCH', '/users/abc')).toBe(true);
		expect(isAlwaysBlockedWrite('PATCH', '/settings')).toBe(true);
		expect(isAlwaysBlockedWrite('POST', '/files')).toBe(true);
		expect(isAlwaysBlockedWrite('DELETE', '/files/abc')).toBe(true);
	});

	test('leaves reads to service-level membership and permission checks', () => {
		expect(isAlwaysBlockedWrite('GET', '/users')).toBe(false);
		expect(isAlwaysBlockedWrite('GET', '/users/abc')).toBe(false);
		expect(isAlwaysBlockedWrite('HEAD', '/files/abc')).toBe(false);
	});

	test('leaves namespace-owned surfaces writable', () => {
		expect(isAlwaysBlockedWrite('POST', '/roles')).toBe(false);
		expect(isAlwaysBlockedWrite('PATCH', '/roles/abc')).toBe(false);
		expect(isAlwaysBlockedWrite('POST', '/permissions')).toBe(false);
		expect(isAlwaysBlockedWrite('POST', '/items/tracking_events')).toBe(false);
		expect(isAlwaysBlockedWrite('PATCH', '/collections/aaa')).toBe(false);
		expect(isAlwaysBlockedWrite('POST', '/flows')).toBe(false);
	});

	test('does not match lookalike paths', () => {
		expect(isAlwaysBlockedWrite('POST', '/usersomething')).toBe(false);
		expect(isAlwaysBlockedWrite('POST', '/settings-backup')).toBe(false);
	});
});

describe('namespaceAdminScope user reads', () => {
	async function check(path: string, scopedAdmin: boolean): Promise<unknown> {
		return new Promise((resolve) => {
			namespaceAdminScope()(
				{ method: 'GET', path, namespaceScopedAdmin: scopedAdmin } as Request,
				{} as Response,
				(error) => resolve(error)
			);
		});
	}

	test('leaves user reads to the service membership scope', async () => {
		expect(await check('/users', true)).toBeUndefined();
		expect(await check('/users/other-user', true)).toBeUndefined();
		expect(await check('/users/me', true)).toBeUndefined();
		expect(await check('/users', false)).toBeUndefined();
	});
});

describe('namespaceOwnedWrite', () => {
	test('identifies the owned table a write targets', () => {
		expect(namespaceOwnedWrite('POST', '/roles')?.table).toBe('directus_roles');
		expect(namespaceOwnedWrite('PATCH', '/roles/abc')?.table).toBe('directus_roles');
		expect(namespaceOwnedWrite('DELETE', '/permissions/7')?.table).toBe('directus_permissions');
	});

	test('is undefined for reads and for other surfaces', () => {
		expect(namespaceOwnedWrite('GET', '/roles')).toBeUndefined();
		expect(namespaceOwnedWrite('POST', '/items/x')).toBeUndefined();
		expect(namespaceOwnedWrite('POST', '/users')).toBeUndefined();
	});
});

describe('targetIdFromPath', () => {
	test('extracts a create (no target) and a target id', () => {
		expect(targetIdFromPath('/roles', '/roles')).toBeUndefined();
		expect(targetIdFromPath('/roles/', '/roles')).toBeUndefined();
		expect(targetIdFromPath('/roles/abc', '/roles')).toBe('abc');
		expect(targetIdFromPath('/roles/abc/extra', '/roles')).toBe('abc');
	});
});
