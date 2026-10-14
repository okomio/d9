import type { Knex } from 'knex';
import { resolveNamespaceMembership } from './membership.js';

/**
 * Whether a user may enter a namespace.
 *
 * A global admin — a user whose main-namespace role grants admin access, which
 * is the only meaning of the `admin_access` flag in an access token — may enter
 * every namespace without a membership. Everyone else needs one.
 *
 * Callers pass `isGlobalAdmin` from their own source of truth: the access token
 * during a request, the joined role row during refresh and login.
 */
export async function canEnterNamespace(
	database: Knex,
	userId: string,
	namespace: string,
	options: { isGlobalAdmin?: boolean } = {}
): Promise<boolean> {
	if (options.isGlobalAdmin === true) return true;

	const membership = await resolveNamespaceMembership(database, userId, namespace);

	return membership !== undefined;
}
