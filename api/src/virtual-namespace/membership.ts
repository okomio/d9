import type { Knex } from 'knex';

/** Shared control-plane table: which role a user holds in which namespace. */
export const MEMBERSHIP_TABLE = 'directus_user_namespaces';

/** Roles live in the shared control plane, alongside the memberships. */
export const ROLES_TABLE = 'directus_roles';

export type NamespaceMembership = {
	role: string;
	admin_access: boolean;
	app_access: boolean;
};

/**
 * Resolves the role a user holds inside a virtual namespace, with its access
 * flags.
 *
 * The flags are part of this lookup on purpose: `getPermissions()` reads
 * `admin_access` and `app_access` from accountability and never re-reads the
 * role row, so a namespace role that is an admin stays a non-admin unless the
 * middleware applies them here.
 *
 * `namespaceId` is the registry id, not the physical schema.
 *
 * Reads from the shared control plane, so it must be called *before* entering
 * the namespace context (i.e. while `getDatabase()` still returns the default).
 */
export async function resolveNamespaceMembership(
	database: Knex,
	userId: string,
	namespaceId: string
): Promise<NamespaceMembership | undefined> {
	const membership = await database
		.select({
			role: 'm.role_id',
			admin_access: 'r.admin_access',
			app_access: 'r.app_access',
		})
		.from(`${MEMBERSHIP_TABLE} as m`)
		.leftJoin(`${ROLES_TABLE} as r`, 'm.role_id', 'r.id')
		.where('m.user_id', userId)
		.andWhere('m.namespace_id', namespaceId)
		.first();

	if (!membership?.role) return undefined;

	return {
		role: membership.role,
		admin_access: membership.admin_access === true || membership.admin_access === 1,
		app_access: membership.app_access === true || membership.app_access === 1,
	};
}
