import { ForbiddenException, InvalidPayloadException, UnprocessableEntityException } from '../exceptions/index.js';
import type { Knex } from 'knex';
import { MEMBERSHIP_TABLE, resolveNamespaceMembership, ROLES_TABLE } from './membership.js';

const USERS_TABLE = 'directus_users';

/** The minimal identity a member list or user picker may expose. */
export type Member = {
	user_id: string;
	email: string | null;
	first_name: string | null;
	last_name: string | null;
	status: string | null;
	role: { id: string; name: string; admin_access: boolean } | null;
};

export type MemberList = {
	data: Member[];
	total: number;
	role_counts: Record<string, number>;
};

export type MemberCandidate = Pick<Member, 'user_id' | 'email' | 'first_name' | 'last_name' | 'status'> & {
	role_id: string | null;
};

/** Include roles without members; membership counts cannot supply the navigation tree. */
export async function listNamespaceRoles(database: Knex, namespaceId: string): Promise<{ id: string; name: string }[]> {
	return database.select('id', 'name').from(ROLES_TABLE).where({ namespace: namespaceId }).orderBy('name', 'asc');
}

/**
 * Whether this caller may administer the namespace's members.
 *
 * Deliberately not derived from `accountability.admin`: that flag means "skip
 * ACL checks" and, for membership-derived authority, says nothing about *which*
 * namespace. Being an admin somewhere must not confer the right to hand out
 * roles somewhere else.
 */
export async function canManageMembers(
	database: Knex,
	caller: { user: string | null; admin: boolean },
	namespaceId: string
): Promise<boolean> {
	if (caller.admin === true) return true;
	if (!caller.user) return false;

	const membership = await resolveNamespaceMembership(database, caller.user, namespaceId);

	return membership?.admin_access === true;
}

/**
 * A role may only be handed out inside the namespace that owns it. Handing out
 * another namespace's role is how a local admin would escalate.
 */
async function assertRoleBelongs(database: Knex, namespaceId: string, roleId: string): Promise<void> {
	const role = await database.select(['id', 'namespace']).from(ROLES_TABLE).where({ id: roleId }).first();

	if (!role) throw new InvalidPayloadException(`Unknown role "${roleId}"`);

	if (role.namespace !== namespaceId) {
		throw new ForbiddenException();
	}
}

async function countAdmins(database: Knex, namespaceId: string, excludeUserId?: string): Promise<number> {
	const query = database
		.count({ count: '*' })
		.from(`${MEMBERSHIP_TABLE} as m`)
		.join(`${ROLES_TABLE} as r`, 'm.role_id', 'r.id')
		.where('m.namespace_id', namespaceId)
		.andWhere('r.admin_access', true);

	if (excludeUserId) query.andWhereNot('m.user_id', excludeUserId);

	const [row] = (await query) as { count?: string | number }[];

	return Number(row?.count ?? 0);
}

/** Refuses the change that would leave a namespace with no admin at all. */
async function assertKeepsAnAdmin(database: Knex, namespaceId: string, userId: string): Promise<void> {
	if ((await countAdmins(database, namespaceId, userId)) === 0) {
		throw new UnprocessableEntityException('A namespace must keep at least one admin');
	}
}

export async function listMembers(
	database: Knex,
	namespaceId: string,
	options: {
		search?: string | undefined;
		roleId?: string | undefined;
		limit?: number | undefined;
		offset?: number | undefined;
	} = {}
): Promise<MemberList> {
	const base = () => {
		const query = database
			.from(`${MEMBERSHIP_TABLE} as m`)
			.leftJoin(`${USERS_TABLE} as u`, 'm.user_id', 'u.id')
			.leftJoin(`${ROLES_TABLE} as r`, 'm.role_id', 'r.id')
			.where('m.namespace_id', namespaceId);

		if (options.roleId) query.andWhere('m.role_id', options.roleId);

		if (options.search) {
			const like = `%${options.search}%`;

			query.andWhere((sub) =>
				sub.where('u.email', 'ilike', like).orWhere('u.first_name', 'ilike', like).orWhere('u.last_name', 'ilike', like)
			);
		}

		return query;
	};

	const rows = await base()
		.select({
			user_id: 'm.user_id',
			email: 'u.email',
			first_name: 'u.first_name',
			last_name: 'u.last_name',
			status: 'u.status',
			role_id: 'r.id',
			role_name: 'r.name',
			admin_access: 'r.admin_access',
		})
		.orderBy('u.email', 'asc')
		.limit(options.limit ?? 50)
		.offset(options.offset ?? 0);

	const [totals] = (await base().count({ count: '*' })) as { count?: string | number }[];

	// Counts come from memberships, not from `directus_roles.users`, which is the
	// shared primary-role relation and says nothing about this namespace.
	const counts = (await database
		.select('m.role_id')
		.count({ count: '*' })
		.from(`${MEMBERSHIP_TABLE} as m`)
		.where('m.namespace_id', namespaceId)
		.groupBy('m.role_id')) as { role_id: string | null; count?: string | number }[];

	const role_counts: Record<string, number> = {};

	for (const row of counts) {
		if (row.role_id) role_counts[row.role_id] = Number(row.count ?? 0);
	}

	return {
		data: rows.map((row) => ({
			user_id: row.user_id,
			email: row.email ?? null,
			first_name: row.first_name ?? null,
			last_name: row.last_name ?? null,
			status: row.status ?? null,
			role: row.role_id ? { id: row.role_id, name: row.role_name, admin_access: row.admin_access === true } : null,
		})),
		total: Number(totals?.count ?? 0),
		role_counts,
	};
}

/**
 * Candidates for the *Add existing user* picker.
 *
 * Searches the shared directory but returns only agreed identity fields and a
 * small bounded result. It never supports browsing without a search.
 */
export async function lookupUsers(
	database: Knex,
	namespaceId: string,
	search: string | undefined,
	limit = 20
): Promise<MemberCandidate[]> {
	const term = search?.trim();

	if (!term || [...term.matchAll(/[\p{L}\p{N}]/gu)].length < 2 || term.length > 100) {
		throw new InvalidPayloadException('Search must contain at least two letters or digits and at most 100 characters');
	}

	const boundedLimit = Number.isFinite(limit) ? Math.min(20, Math.max(1, Math.trunc(limit))) : 20;
	const like = `%${term.replace(/[\\%_]/g, '\\$&')}%`;

	const query = database
		.select({
			user_id: 'u.id',
			email: 'u.email',
			first_name: 'u.first_name',
			last_name: 'u.last_name',
			status: 'u.status',
			role_id: 'm.role_id',
		})
		.from(`${USERS_TABLE} as u`)
		.leftJoin(`${MEMBERSHIP_TABLE} as m`, function () {
			this.on('m.user_id', '=', 'u.id').andOn('m.namespace_id', '=', database.raw('?', [namespaceId]));
		});

	query.where((sub) =>
		sub.where('u.email', 'ilike', like).orWhere('u.first_name', 'ilike', like).orWhere('u.last_name', 'ilike', like)
	);

	const rows = await query.orderBy('u.email', 'asc').limit(boundedLimit);

	return rows.map((row) => ({
		user_id: row.user_id,
		email: row.email ?? null,
		first_name: row.first_name ?? null,
		last_name: row.last_name ?? null,
		status: row.status ?? null,
		role_id: row.role_id ?? null,
	}));
}

/** Grants a local role. This writes the membership, never the user record. */
export async function addMember(database: Knex, namespaceId: string, userId: string, roleId: string): Promise<void> {
	await assertRoleBelongs(database, namespaceId, roleId);

	const user = await database.select('id').from(USERS_TABLE).where({ id: userId }).first();

	if (!user) throw new InvalidPayloadException(`Unknown user "${userId}"`);

	const existing = await database
		.select('id')
		.from(MEMBERSHIP_TABLE)
		.where({ user_id: userId, namespace_id: namespaceId })
		.first();

	if (existing) throw new UnprocessableEntityException('Already a member of this namespace');

	await database(MEMBERSHIP_TABLE).insert({
		id: database.raw('gen_random_uuid()'),
		user_id: userId,
		namespace_id: namespaceId,
		role_id: roleId,
	});
}

/** Changes a local role. Cannot demote the last admin. */
export async function updateMemberRole(
	database: Knex,
	namespaceId: string,
	userId: string,
	roleId: string
): Promise<void> {
	await assertRoleBelongs(database, namespaceId, roleId);

	const current = await database
		.select(['m.role_id', 'r.admin_access'])
		.from(`${MEMBERSHIP_TABLE} as m`)
		.leftJoin(`${ROLES_TABLE} as r`, 'm.role_id', 'r.id')
		.where({ 'm.user_id': userId, 'm.namespace_id': namespaceId })
		.first();

	if (!current) throw new InvalidPayloadException(`"${userId}" is not a member of this namespace`);

	const next = await database.select('admin_access').from(ROLES_TABLE).where({ id: roleId }).first();

	if (current.admin_access === true && next?.admin_access !== true) {
		await assertKeepsAnAdmin(database, namespaceId, userId);
	}

	await database(MEMBERSHIP_TABLE).where({ user_id: userId, namespace_id: namespaceId }).update({ role_id: roleId });
}

/**
 * Removes one membership.
 *
 * Deletes the membership only: the shared account, its global profile and its
 * memberships elsewhere are untouched, and this cannot revoke inherited Global
 * Admin authority. Cannot remove the last admin.
 */
export async function removeMember(database: Knex, namespaceId: string, userId: string): Promise<void> {
	const current = await database
		.select(['m.role_id', 'r.admin_access'])
		.from(`${MEMBERSHIP_TABLE} as m`)
		.leftJoin(`${ROLES_TABLE} as r`, 'm.role_id', 'r.id')
		.where({ 'm.user_id': userId, 'm.namespace_id': namespaceId })
		.first();

	if (!current) throw new InvalidPayloadException(`"${userId}" is not a member of this namespace`);

	if (current.admin_access === true) {
		await assertKeepsAnAdmin(database, namespaceId, userId);
	}

	await database(MEMBERSHIP_TABLE).where({ user_id: userId, namespace_id: namespaceId }).delete();
}
