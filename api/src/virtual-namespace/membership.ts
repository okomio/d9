import type { Knex } from 'knex';

/** Shared control-plane table: which role a user holds in which namespace. */
export const MEMBERSHIP_TABLE = 'directus_user_namespaces';

/**
 * Resolves the role a user holds inside a virtual namespace.
 *
 * Reads from the shared control plane, so it must be called *before* entering
 * the namespace context (i.e. while `getDatabase()` still returns the default).
 */
export async function resolveNamespaceRole(
	database: Knex,
	userId: string,
	namespace: string
): Promise<string | undefined> {
	const membership = await database
		.select('role_id')
		.from(MEMBERSHIP_TABLE)
		.where({ user_id: userId, namespace })
		.first();

	return membership?.role_id ?? undefined;
}
