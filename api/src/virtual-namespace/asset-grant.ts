import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import env from '../env.js';
import { InvalidTokenException } from '../exceptions/index.js';
import type { DirectusTokenPayload } from '../types/index.js';

const GRANT_QUERY = 'asset_grant';
const GRANT_TTL = '5m';

/** A URL grant can only retrieve the exact asset URL for which it was issued. */
export function assetGrantPath(rawUrl: string, fileId: string): string {
	if (!rawUrl.startsWith('/') || rawUrl.startsWith('//') || rawUrl.includes('#') || rawUrl.length > 2048) {
		throw new InvalidTokenException('Invalid asset URL.');
	}

	const url = new URL(rawUrl, 'http://directus.invalid');

	if (
		url.pathname !== `/assets/${fileId}` ||
		url.searchParams.has(GRANT_QUERY) ||
		url.searchParams.has('access_token')
	) {
		throw new InvalidTokenException('Invalid asset URL.');
	}

	url.searchParams.sort();
	return url.pathname + url.search;
}

export function mintAssetGrant(access: DirectusTokenPayload, namespace: string, assetPath: string): string {
	return jwt.sign(
		{
			id: access.id,
			// Authentication re-reads shared authority and namespace membership on every request.
			// The URL grant carries no reusable role or privilege claims.
			role: null,
			app_access: false,
			admin_access: false,
			session_id: access.session_id,
			namespace,
			asset_grant_path: assetPath,
		},
		env['SECRET'] as string,
		{ expiresIn: GRANT_TTL, issuer: 'directus' }
	);
}

/** Enforced before any normal authentication filter can accept this JWT. */
export function assertAssetGrantRequest(req: Request, payload: Record<string, unknown>): void {
	if (!Object.hasOwn(payload, 'asset_grant_path')) {
		if (req.query?.[GRANT_QUERY] !== undefined) throw new InvalidTokenException('Invalid asset grant.');
		return;
	}

	if (typeof payload['asset_grant_path'] !== 'string' || req.method !== 'GET') {
		throw new InvalidTokenException('Invalid asset grant.');
	}

	const url = new URL(req.originalUrl, 'http://directus.invalid');
	if (!/^\/assets\/[0-9a-f-]{36}$/i.test(url.pathname)) throw new InvalidTokenException('Invalid asset grant.');
	if (url.searchParams.getAll(GRANT_QUERY).length > 1) throw new InvalidTokenException('Invalid asset grant.');
	url.searchParams.delete(GRANT_QUERY);
	url.searchParams.sort();
	if (url.pathname + url.search !== payload['asset_grant_path'])
		throw new InvalidTokenException('Invalid asset grant.');
}
