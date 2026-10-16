import { describe, expect, test } from 'vitest';
import { canManagePlatformResource, canManageSharedSettings } from './capabilities';
import type { ActiveNamespaceContext, PlatformCapabilities } from './types';

const platform = (overrides: Partial<PlatformCapabilities> = {}): PlatformCapabilities => ({
	isGlobalAdmin: false,
	canManageNamespaces: false,
	canManageSharedUsers: false,
	canManageSharedSettings: false,
	...overrides,
});

const active = (kind: 'main' | 'virtual', caps: Partial<PlatformCapabilities>): ActiveNamespaceContext =>
	({ namespace: { kind }, platform: platform(caps) } as ActiveNamespaceContext);

describe('canManageSharedSettings', () => {
	test('keeps the shared screen available when the namespace feature is off', () => {
		expect(canManageSharedSettings(null)).toBe(true);
	});

	test('requires platform settings authority inside a namespace', () => {
		expect(canManageSharedSettings(active('main', { isGlobalAdmin: true, canManageSharedSettings: true }))).toBe(true);
		expect(canManageSharedSettings(active('virtual', { isGlobalAdmin: true, canManageSharedSettings: true }))).toBe(
			true
		);
		expect(canManageSharedSettings(active('main', { isGlobalAdmin: true }))).toBe(false);
		expect(canManageSharedSettings(active('virtual', {}))).toBe(false);
	});
});

describe('canManagePlatformResource', () => {
	test('never accepts a local role as authority for a shared resource', () => {
		expect(canManagePlatformResource(null, 'settings')).toBe(false);
		expect(canManagePlatformResource(platform({ canManageSharedUsers: true }), 'users')).toBe(false);
		expect(canManagePlatformResource(platform({ isGlobalAdmin: true, canManageSharedUsers: true }), 'users')).toBe(
			true
		);
	});
});
