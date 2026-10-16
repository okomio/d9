import type { Request } from 'express';
import { expect, test } from 'vitest';
import env from '../env.js';
import { verifyJWT } from '../utils/jwt.js';
import { assertAssetGrantRequest, assetGrantPath, mintAssetGrant } from './asset-grant.js';

const file = 'a0000000-0000-4000-8000-000000000001';
const path = `/assets/${file}?download=&key=system-large-contain`;

test('grant is limited to one file, query and namespace', () => {
	const canonical = assetGrantPath(path, file);

	const token = mintAssetGrant(
		{ id: 'user', role: 'role', app_access: true, admin_access: false, session_id: 'session' },
		'tracking',
		canonical
	);

	const payload = verifyJWT(token, env['SECRET']);
	expect(payload['namespace']).toBe('tracking');
	expect(payload['asset_grant_path']).toBe(canonical);
	expect(payload['role']).toBeNull();
	expect(payload['admin_access']).toBe(false);

	const req = (url: string, method = 'GET') =>
		({ originalUrl: url, method, query: { asset_grant: token } } as unknown as Request);

	expect(() => assertAssetGrantRequest(req(`${path}&asset_grant=${token}`), payload)).not.toThrow();
	expect(() => assertAssetGrantRequest(req(`/assets/${file}?asset_grant=${token}`), payload)).toThrow();
	expect(() => assertAssetGrantRequest(req(`${path}&asset_grant=${token}`, 'POST'), payload)).toThrow();
	expect(() => assertAssetGrantRequest(req(`/users?asset_grant=${token}`), payload)).toThrow();
});

test('ordinary bearer token cannot be smuggled through asset_grant', () => {
	const req = { originalUrl: `/assets/${file}?asset_grant=token`, method: 'GET', query: { asset_grant: 'token' } };
	expect(() => assertAssetGrantRequest(req as unknown as Request, {})).toThrow();
});

test('grant URL cannot include an existing bearer token or another file', () => {
	expect(() => assetGrantPath(`/assets/${file}?access_token=secret`, file)).toThrow();
	expect(() => assetGrantPath('/assets/a0000000-0000-4000-8000-000000000002', file)).toThrow();
});
