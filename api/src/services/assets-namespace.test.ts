import type { Knex } from 'knex';
import { afterEach, expect, test, vi } from 'vitest';
import { ForbiddenException } from '../exceptions/index.js';
import { runWithNamespace } from '../virtual-namespace/context.js';
import { AssetsService } from './assets.js';

const location = vi.fn();
vi.mock('../storage/index.js', () => ({ getStorage: async () => ({ location }) }));
vi.mock('./authorization.js', () => ({
	AuthorizationService: class {
		checkAccess = vi.fn();
	},
}));
afterEach(() => vi.unstubAllEnvs());

test('an asset URL cannot stream a foreign file even to a child admin', async () => {
	vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'true');
	const id = '11111111-1111-4111-8111-111111111111';
	const query = {
		select: vi.fn().mockReturnThis(),
		from: vi.fn().mockReturnThis(),
		where: vi.fn().mockReturnThis(),
		first: vi
			.fn()
			.mockResolvedValueOnce({ project_logo: null, public_background: null, public_foreground: null })
			.mockResolvedValueOnce({ id, namespace: 'main' }),
	};
	const service = new AssetsService({
		knex: query as unknown as Knex,
		accountability: { user: 'admin', role: 'child-admin', admin: true },
		schema: {} as any,
	});

	await runWithNamespace({ id: 'child', schema: 'ns_child' }, async () => {
		await expect(service.getAsset(id, {})).rejects.toThrow(ForbiddenException);
	});
	expect(location).not.toHaveBeenCalled();
});
