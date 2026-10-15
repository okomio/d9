import type { Accountability, SchemaOverview } from '@wbce-d9/types';
import type { Knex } from 'knex';
import { afterEach, expect, test, vi } from 'vitest';
import { ForbiddenException } from '../exceptions/index.js';
import { assertSharedWrite } from '../virtual-namespace/authority.js';
import { runWithNamespace } from '../virtual-namespace/context.js';
import { getAccountabilityForRole } from './get-accountability-for-role.js';

afterEach(() => vi.unstubAllEnvs());

test.each([
	{ label: 'Global Admin', caller: { role: 'main-admin', admin: true, globalAdmin: true }, allowed: true },
	{ label: 'local admin', caller: { role: 'local-admin', admin: true, globalAdmin: false }, allowed: false },
	{ label: 'unverified admin flag', caller: { role: 'admin', admin: true }, allowed: false },
	{ label: 'execution without a caller', caller: null, allowed: false },
])('system Flow execution preserves only established authority: $label', async ({ caller, allowed }) => {
	vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'true');

	const identity = await getAccountabilityForRole('system', {
		accountability: caller as Accountability | null,
		schema: {} as SchemaOverview,
		database: {} as Knex,
	});

	expect(identity).toEqual({ user: null, role: null, admin: true, app: true, permissions: [], globalAdmin: allowed });

	runWithNamespace({ id: 'child', schema: 'ns_child' }, () => {
		if (allowed) {
			expect(() => assertSharedWrite('directus_users', identity)).not.toThrow();
		} else {
			expect(() => assertSharedWrite('directus_users', identity)).toThrow(ForbiddenException);
		}
	});
});

test('disabled system Flow identity retains its exact previous shape', async () => {
	vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'false');

	const identity = await getAccountabilityForRole('system', {
		accountability: { role: 'main-admin', admin: true, globalAdmin: true },
		schema: {} as SchemaOverview,
		database: {} as Knex,
	});

	expect(identity).toEqual({ user: null, role: null, admin: true, app: true, permissions: [] });
});
