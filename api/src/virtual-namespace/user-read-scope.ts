import type { Accountability } from '@wbce-d9/types';
import type { Knex } from 'knex';
import { ForbiddenException } from '../exceptions/index.js';
import { isVirtualNamespaceEnabled } from './config.js';
import { getActiveNamespaceId, getActiveNamespaceKind } from './context.js';

/** Only explicit identity operations may read the caller outside a namespace. */
export type SharedUserScope = 'self';

/**
 * Constrain the shared user source for the entire SQL statement. The CTE also
 * covers relational joins, filter/sort aliases and relational count subqueries,
 * which are not necessarily represented by a selected user node in the AST.
 */
export function applySharedUserReadScope<T extends Knex.QueryBuilder>(
	knex: Knex,
	query: T,
	accountability: Accountability | null | undefined,
	scope?: SharedUserScope
): T {
	if (
		!isVirtualNamespaceEnabled() ||
		!accountability ||
		accountability.share ||
		accountability.share_scope ||
		(!accountability.user && !accountability.role && accountability.admin !== true)
	) {
		return query;
	}

	if (scope === 'self' && !accountability.user) throw new ForbiddenException();

	const namespace = getActiveNamespaceId();

	if (scope !== 'self' && (!namespace || getActiveNamespaceKind() === 'main' || accountability.globalAdmin === true)) {
		return query;
	}

	const users = knex.select('shared_user.*').from({ shared_user: 'public.directus_users' });

	if (scope === 'self') {
		users.where('shared_user.id', accountability.user);
	} else {
		users.whereExists(
			knex
				.select(knex.raw('1'))
				.from({ membership: 'public.directus_user_namespaces' })
				.whereRaw('?? = ??', ['membership.user_id', 'shared_user.id'])
				.where('membership.namespace_id', namespace!)
		);
	}

	query.with('directus_users', users);
	return query;
}
