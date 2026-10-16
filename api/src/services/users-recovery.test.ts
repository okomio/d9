import type { Accountability, SchemaOverview } from '@wbce-d9/types';
import { getSimpleHash } from '@wbce-d9/utils';
import jwt from 'jsonwebtoken';
import type { Knex } from 'knex';
import { afterEach, expect, test, vi } from 'vitest';
import { ForbiddenException } from '../exceptions/index.js';
import { getActiveNamespaceId, runWithNamespace } from '../virtual-namespace/context.js';
import { UsersService } from './users.js';

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

const caller: Accountability = {
	user: 'requesting-user',
	role: 'child-admin',
	admin: true,
	globalAdmin: false,
	ip: '127.0.0.1',
	session_id: 'session',
};

function recoveryService() {
	return new UsersService({ knex: {} as Knex, schema: {} as SchemaOverview, accountability: caller });
}

test('verified password recovery keeps audit context and runs only the fixed shared update', async () => {
	vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'true');
	const service = recoveryService();
	const user = { id: 'recovering-user', status: 'active', password: 'stored-password' };

	vi.spyOn(jwt, 'verify').mockReturnValue({
		email: 'recovering@example.com',
		scope: 'password-reset',
		hash: getSimpleHash(user.password),
	} as never);

	vi.spyOn(service as any, 'checkPasswordPolicy').mockResolvedValue(undefined);
	vi.spyOn(service as any, 'getUserByEmail').mockResolvedValue(user);
	let updateAccountability: Accountability | null = null;
	let updateNamespace: string | undefined;

	const update = vi
		.spyOn(UsersService.prototype, 'updateOne')
		.mockImplementation(async function (this: UsersService, key) {
			updateAccountability = this.accountability;
			updateNamespace = getActiveNamespaceId();
			return key;
		});

	await runWithNamespace({ id: 'child', schema: 'ns_child' }, async () => {
		await service.resetPassword('verified-recovery-token', 'replacement-password');
		expect(getActiveNamespaceId()).toBe('child');
	});

	expect(update).toHaveBeenCalledWith(user.id, { password: 'replacement-password', status: 'active' }, {});
	expect(updateAccountability).toEqual(caller);
	expect(updateNamespace).toBeUndefined();
});

test.each([
	{ scope: 'invite', hash: getSimpleHash('stored-password') },
	{ scope: 'password-reset', hash: getSimpleHash('obsolete-password') },
])('invalid recovery proof cannot use the trusted update: %j', async (proof) => {
	vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'true');
	const service = recoveryService();
	vi.spyOn(jwt, 'verify').mockReturnValue({ email: 'recovering@example.com', ...proof } as never);
	vi.spyOn(service as any, 'checkPasswordPolicy').mockResolvedValue(undefined);

	vi.spyOn(service as any, 'getUserByEmail').mockResolvedValue({
		id: 'recovering-user',
		status: 'active',
		password: 'stored-password',
	});

	const update = vi.spyOn(UsersService.prototype, 'updateOne');

	await runWithNamespace({ id: 'child', schema: 'ns_child' }, async () => {
		await expect(service.resetPassword('invalid-recovery-token', 'replacement-password')).rejects.toThrow(
			ForbiddenException
		);
	});

	expect(update).not.toHaveBeenCalled();
});
