import type { SchemaOverview } from '@wbce-d9/types';
import jwt from 'jsonwebtoken';
import knex from 'knex';
import { createTracker, MockClient } from 'knex-mock-client';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { getAuthProvider } from '../auth.js';
import { AuthenticationService } from './authentication.js';

vi.mock('../auth.js', () => ({ getAuthProvider: vi.fn() }));
vi.mock('../database/index.js', () => ({ default: vi.fn() }));

vi.mock('../emitter.js', () => ({
	default: { emitFilter: vi.fn(async (_event, payload) => payload), emitAction: vi.fn() },
}));

vi.mock('../env.js', () => ({
	default: { SECRET: 'legacy-auth-test', ACCESS_TOKEN_TTL: '15m', REFRESH_TOKEN_TTL: '7d', LOGIN_STALL_TIME: 0 },
}));

vi.mock('../rate-limiter.js', () => ({ createRateLimiter: vi.fn(() => ({})) }));
vi.mock('../utils/stall.js', () => ({ stall: vi.fn() }));

vi.mock('../virtual-namespace/access.js', () => ({
	canEnterNamespace: vi.fn(),
	describeNamespaceContext: vi.fn(async () => ({ is_global_admin: false, namespace: null })),
}));

vi.mock('./activity.js', () => ({ ActivityService: class {} }));

vi.mock('./settings.js', () => ({
	SettingsService: class {
		async readSingleton() {
			return { auth_login_attempts: null };
		}
	},
}));

vi.mock('./tfa.js', () => ({ TFAService: class {} }));

afterEach(() => {
	vi.clearAllMocks();
	vi.unstubAllEnvs();
});

describe('legacy authentication role flags', () => {
	test.each([1, true])('login preserves raw %s flags in provider input and JWT claims', async (flag) => {
		vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'false');
		const database = knex.default({ client: MockClient });
		const tracker = createTracker(database);

		const user = {
			id: 'legacy-user',
			role: 'legacy-admin',
			status: 'active',
			provider: 'default',
			tfa_secret: null,
			admin_access: flag,
			app_access: flag,
		};

		tracker.on.select(/directus_users/).response([user]);
		tracker.on.insert(/directus_sessions/).response([]);
		tracker.on.delete(/directus_sessions/).response(1);
		tracker.on.update(/directus_users/).response(1);
		const provider = { getUserID: vi.fn(async () => user.id), login: vi.fn<(...args: unknown[]) => void>() };
		vi.mocked(getAuthProvider).mockReturnValue(provider as never);

		try {
			const service = new AuthenticationService({ knex: database, schema: {} as SchemaOverview });
			const result = await service.login('default', { email: 'legacy@example.com', password: 'password' });
			expect(provider.login.mock.calls[0]?.[0]).toMatchObject({ admin_access: flag, app_access: flag });
			expect(jwt.decode(result.accessToken)).toMatchObject({ role: user.role, admin_access: flag, app_access: flag });
		} finally {
			await database.destroy();
		}
	});

	test.each([1, true])('refresh preserves raw %s flags in provider input and JWT claims', async (flag) => {
		vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'false');
		const database = knex.default({ client: MockClient });
		const tracker = createTracker(database);

		const record = {
			user_id: 'legacy-user',
			user_status: 'active',
			user_provider: 'default',
			role_id: 'legacy-admin',
			role_admin_access: flag,
			role_app_access: flag,
			session_id: 'session',
			session_fallback_token: 'next-refresh-token',
		};

		tracker.on.select(/directus_sessions/).response([record]);
		tracker.on.delete(/directus_sessions/).response(1);
		tracker.on.update(/directus_sessions/).response(1);
		tracker.on.update(/directus_users/).response(1);
		const provider = { refresh: vi.fn<(...args: unknown[]) => void>() };
		vi.mocked(getAuthProvider).mockReturnValue(provider as never);

		try {
			const service = new AuthenticationService({ knex: database, schema: {} as SchemaOverview });
			const result = await service.refresh('current-refresh-token');
			expect(provider.refresh.mock.calls[0]?.[0]).toMatchObject({ admin_access: flag, app_access: flag });

			expect(jwt.decode(result['accessToken'])).toMatchObject({
				role: record.role_id,
				admin_access: flag,
				app_access: flag,
			});
		} finally {
			await database.destroy();
		}
	});
});
