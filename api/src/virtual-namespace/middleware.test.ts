import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import getDatabase from '../database/index.js';
import { resolveNamespaceRole } from './access.js';
import { getActiveNamespaceId } from './context.js';
import { virtualNamespace } from './middleware.js';
import { getNamespace } from './registry.js';
import { resolveLegacyDefaultNamespace } from './resolve.js';

vi.mock('../database/index.js', () => ({ default: vi.fn(() => ({})) }));
vi.mock('./access.js', () => ({ resolveNamespaceRole: vi.fn() }));
vi.mock('./registry.js', () => ({ getNamespace: vi.fn() }));

vi.mock('./resolve.js', async (original) => ({
	...(await original<typeof import('./resolve.js')>()),
	resolveLegacyDefaultNamespace: vi.fn(),
}));

beforeEach(() => {
	vi.stubEnv('NODE_ENV', 'test');
	vi.stubEnv('VIRTUAL_NAMESPACES_ALLOW_HEADER', 'true');
	vi.mocked(resolveLegacyDefaultNamespace).mockResolvedValue('main');

	vi.mocked(getNamespace).mockImplementation(async (_database, id) => ({
		id,
		name: id,
		schema_name: id === 'main' ? 'public' : 'ns_peer',
		kind: id === 'main' ? 'main' : 'virtual',
		readiness: 'ready',
	}));

	vi.mocked(resolveNamespaceRole).mockResolvedValue({
		id: 'local-role',
		name: 'Reader',
		admin_access: false,
		app_access: true,
	});
});

afterEach(() => {
	vi.clearAllMocks();
	vi.unstubAllEnvs();
});

async function request({
	claim,
	header,
	path = '/items/example',
	globalAdmin = false,
}: {
	claim?: string;
	header?: string;
	path?: string;
	globalAdmin?: boolean;
} = {}) {
	const req = {
		path,
		virtualNamespace: claim,
		header: vi.fn(() => header),
		accountability: { user: 'owner', role: 'shared-role', admin: globalAdmin, globalAdmin, app: true },
	} as unknown as Request;

	let active: ReturnType<typeof getActiveNamespaceId>;

	const next = vi.fn((error?: unknown) => {
		if (!error) active = getActiveNamespaceId();
	});

	await virtualNamespace()(req, { locals: {} } as Response, next);
	return { req, next, active: active! };
}

describe('request namespace selection', () => {
	test('normalizes matching selectors and skips the default lookup', async () => {
		const result = await request({ claim: ' peer ', header: 'peer' });
		expect(result.active).toBe('peer');
		expect(resolveLegacyDefaultNamespace).not.toHaveBeenCalled();
	});

	test('rejects conflicts before registry, authorization or namespace entry', async () => {
		const result = await request({ claim: 'peer', header: 'main' });
		expect(result.next.mock.calls[0]?.[0]).toMatchObject({ code: 'INVALID_PAYLOAD' });
		expect(getNamespace).not.toHaveBeenCalled();
		expect(resolveNamespaceRole).not.toHaveBeenCalled();
		expect(result.active).toBeUndefined();
	});

	test('uses authorized tooling headers before the owner default', async () => {
		const result = await request({ claim: ' ', header: ' peer ' });
		expect(result.active).toBe('peer');
		expect(resolveLegacyDefaultNamespace).not.toHaveBeenCalled();
	});

	test('blank selectors resolve the authenticated owner default', async () => {
		const result = await request({ claim: ' ', header: '' });
		expect(result.active).toBe('main');
		expect(resolveLegacyDefaultNamespace).toHaveBeenCalledWith(getDatabase(), 'owner');
	});

	test.each(['flag-disabled', 'production'])('ignores headers in %s mode', async (mode) => {
		if (mode === 'production') vi.stubEnv('NODE_ENV', 'production');
		else vi.stubEnv('VIRTUAL_NAMESPACES_ALLOW_HEADER', 'false');
		expect((await request({ header: 'peer' })).active).toBe('main');
		expect((await request({ claim: 'peer', header: 'main' })).active).toBe('peer');
	});

	test.each(['missing', 'unknown', 'unready', 'unauthorized'])('fails closed for %s defaults', async (failure) => {
		if (failure === 'missing') vi.mocked(resolveLegacyDefaultNamespace).mockResolvedValue(undefined);
		if (failure === 'unknown') vi.mocked(getNamespace).mockResolvedValue(undefined);
		if (failure === 'unready')
			vi.mocked(getNamespace).mockResolvedValue({
				id: 'main',
				name: 'Main',
				schema_name: 'public',
				kind: 'main',
				readiness: 'provisioning',
			});
		if (failure === 'unauthorized') vi.mocked(resolveNamespaceRole).mockResolvedValue(undefined);
		const result = await request();
		expect(result.next.mock.calls[0]?.[0]).toMatchObject({ code: 'FORBIDDEN' });
		expect(result.active).toBeUndefined();
	});

	test('retains global authority without a local membership', async () => {
		vi.mocked(resolveNamespaceRole).mockResolvedValue(undefined);
		const result = await request({ claim: 'peer', globalAdmin: true });
		expect(result.active).toBe('peer');
		expect(resolveNamespaceRole).not.toHaveBeenCalled();
	});

	test('shared identity bypasses namespace selection', async () => {
		await request({ path: '/users/me', claim: 'missing', header: 'conflict' });
		expect(resolveLegacyDefaultNamespace).not.toHaveBeenCalled();
		expect(getNamespace).not.toHaveBeenCalled();
	});
});
