import type { Knex } from 'knex';
import { ForbiddenException, InvalidPayloadException } from '../exceptions/index.js';
import { listAccessibleNamespaces } from './access.js';
import { MEMBERSHIP_TABLE, ROLES_TABLE } from './membership.js';

const USERS = 'directus_users';

/** A preference is an app landing, not an entitlement or the server's token fallback. */
export async function eligibleDefaultNamespaces(database: Knex, userId: string) {
	const user = await database
		.select({
			id: 'u.id',
			role: 'u.role',
			admin_access: 'r.admin_access',
			app_access: 'r.app_access',
			role_namespace: 'r.namespace',
			status: 'u.status',
		})
		.from(`${USERS} as u`)
		.leftJoin(`${ROLES_TABLE} as r`, 'u.role', 'r.id')
		.where('u.id', userId)
		.first();

	if (!user) throw new InvalidPayloadException('Unknown user');
	if (user.status !== 'active') return [];

	const access = await listAccessibleNamespaces(database, {
		user: userId,
		role: user.role ?? null,
		admin: user.role_namespace === 'main' && (user.admin_access === true || user.admin_access === 1),
		app: user.app_access === true || user.app_access === 1,
	});

	return access.data.filter(
		(namespace) => namespace.kind === 'virtual' && namespace.can_enter && namespace.can_use_app
	);
}

export async function assertEligibleDefault(database: Knex, userId: string, namespaceId: unknown): Promise<void> {
	if (namespaceId === null) return;

	if (
		typeof namespaceId !== 'string' ||
		!(await eligibleDefaultNamespaces(database, userId)).some((item) => item.id === namespaceId)
	) {
		throw new ForbiddenException();
	}
}

/** Clear revoked preferences and persist the sole eligible child on discovery. */
export async function preferredLandingNamespace(
	database: Knex,
	userId: string,
	eligibleIds: string[]
): Promise<string | null> {
	const user = await database.select('default_namespace').from(USERS).where({ id: userId }).first();
	const saved = user?.default_namespace ?? null;
	const preferred = saved && eligibleIds.includes(saved) ? saved : eligibleIds.length === 1 ? eligibleIds[0]! : null;

	if (saved !== preferred) await database(USERS).where({ id: userId }).update({ default_namespace: preferred });
	return preferred;
}

export async function userProfileAccess(database: Knex, userId: string) {
	const user = await database
		.select({
			id: 'u.id',
			default_namespace: 'u.default_namespace',
			role_namespace: 'r.namespace',
			admin_access: 'r.admin_access',
			status: 'u.status',
		})
		.from(`${USERS} as u`)
		.leftJoin(`${ROLES_TABLE} as r`, 'u.role', 'r.id')
		.where('u.id', userId)
		.first();

	if (!user) throw new InvalidPayloadException('Unknown user');

	const memberships = await database
		.select({
			namespace_id: 'm.namespace_id',
			namespace_name: 'n.name',
			role_id: 'r.id',
			role_name: 'r.name',
			admin_access: 'r.admin_access',
		})
		.from(`${MEMBERSHIP_TABLE} as m`)
		.join('directus_namespaces as n', 'm.namespace_id', 'n.id')
		.leftJoin(`${ROLES_TABLE} as r`, 'm.role_id', 'r.id')
		.where('m.user_id', userId)
		.orderBy('n.name');

	return {
		memberships,
		eligible_defaults: (await eligibleDefaultNamespaces(database, userId)).map(({ id, name }) => ({ id, name })),
		default_namespace: user.default_namespace ?? null,
		inherited_global_admin:
			user.status === 'active' &&
			user.role_namespace === 'main' &&
			(user.admin_access === true || user.admin_access === 1),
	};
}
