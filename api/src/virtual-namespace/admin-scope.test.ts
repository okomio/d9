import { describe, expect, test } from 'vitest';
import { isControlPlaneWrite } from './admin-scope.js';

describe('isControlPlaneWrite', () => {
	test('blocks writes to shared control-plane surfaces', () => {
		expect(isControlPlaneWrite('POST', '/users')).toBe(true);
		expect(isControlPlaneWrite('PATCH', '/users/abc')).toBe(true);
		expect(isControlPlaneWrite('DELETE', '/roles/abc')).toBe(true);
		expect(isControlPlaneWrite('POST', '/permissions')).toBe(true);
		expect(isControlPlaneWrite('PATCH', '/settings')).toBe(true);
		expect(isControlPlaneWrite('POST', '/files')).toBe(true);
		expect(isControlPlaneWrite('DELETE', '/files/abc')).toBe(true);
	});

	test('leaves reads open — a namespace admin must see all users', () => {
		expect(isControlPlaneWrite('GET', '/users')).toBe(false);
		expect(isControlPlaneWrite('GET', '/users/abc')).toBe(false);
		expect(isControlPlaneWrite('GET', '/roles')).toBe(false);
		expect(isControlPlaneWrite('HEAD', '/files/abc')).toBe(false);
	});

	test('leaves namespace-owned surfaces writable', () => {
		expect(isControlPlaneWrite('POST', '/items/tracking_events')).toBe(false);
		expect(isControlPlaneWrite('PATCH', '/collections/aaa')).toBe(false);
		expect(isControlPlaneWrite('POST', '/flows')).toBe(false);
		expect(isControlPlaneWrite('PATCH', '/webhooks/1')).toBe(false);
		expect(isControlPlaneWrite('POST', '/presets')).toBe(false);
	});

	test('does not match lookalike paths', () => {
		expect(isControlPlaneWrite('POST', '/usersomething')).toBe(false);
		expect(isControlPlaneWrite('POST', '/settings-backup')).toBe(false);
	});
});
