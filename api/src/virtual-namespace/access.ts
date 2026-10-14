import type { Knex } from 'knex';
import { getDefaultNamespace } from './config.js';
import { MEMBERSHIP_TABLE, resolveNamespaceMembership, ROLES_TABLE } from './membership.js';
import { listNamespaces, type NamespaceKind, type NamespaceReadiness } from './registry.js';

export type NamespaceRole = {
	id: string;
	name: string;
	admin_access: boolean;
	app_access: boolean;
};

/** The caller as established by authentication, before any namespace applies. */
export type CallerIdentity = {
	user: string | null;
	role: string | null;
	admin: boolean;
	app: boolean;
};

export type NamespaceAccess = {
	id: string;
	name: string;
	kind: NamespaceKind;
	readiness: NamespaceReadiness;
	local_role: NamespaceRole | null;
	inherited_admin: boolean;
	can_enter: boolean;
	can_use_app: boolean;
};

const isTrue = (value: unknown): boolean => value === true || value === 1;

async function getRole(database: Knex, roleId: string): Promise<NamespaceRole | undefined> {
	const role = await database.select(['id', 'name', 'admin_access', 'app_access']).from(ROLES_TABLE).where({ id: roleId }).first();

	if (!role) return undefined;

	return {
		id: role.id,
		name: role.name,
		admin_access: isTrue(role.admin_access),
		app_access: isTrue(role.app_access),
	};
}

async function listMemberships(database: Knex, userId: string): Promise<Map<string, NamespaceRole>> {
	const rows = await database
		.select({
			namespace_id: 'm.namespace_id',
			role_id: 'r.id',
			role_name: 'r.name',
			admin_access: 'r.admin_access',
			app_access: 'r.app_access',
		})
		.from(`${MEMBERSHIP_TABLE} as m`)
		.leftJoin(`${ROLES_TABLE} as r`, 'm.role_id', 'r.id')
		.where('m.user_id', userId);

	const memberships = new Map<string, NamespaceRole>();

	for (const row of rows) {
		if (!row.role_id) continue;

		memberships.set(row.namespace_id, {
			id: row.role_id,
			name: row.role_name,
			admin_access: isTrue(row.admin_access),
			app_access: isTrue(row.app_access),
		});
	}

	return memberships;
}

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
	namespaceId: string,
	options: { isGlobalAdmin?: boolean } = {}
): Promise<boolean> {
	if (options.isGlobalAdmin === true) return true;

	const membership = await resolveNamespaceMembership(database, userId, namespaceId);

	return membership !== undefined;
}

/**
 * The namespaces a caller may see, with their effective access.
 *
 * A global admin sees every namespace, including ones that are not ready, so the
 * UI can render them as not enterable. Everyone else sees only namespaces they
 * hold something in. Readiness is reported, never assumed: `can_enter` is the
 * only field that should gate an entry.
 *
 * Read from the shared control plane, so it must be called before entering a
 * namespace context.
 */
export async function listAccessibleNamespaces(
	database: Knex,
	caller: CallerIdentity
): Promise<{ data: NamespaceAccess[]; default: string | null }> {
	const namespaces = await listNamespaces(database);
	const memberships = caller.user ? await listMemberships(database, caller.user) : new Map<string, NamespaceRole>();
	const mainRole = caller.role ? await getRole(database, caller.role) : undefined;

	const data: NamespaceAccess[] = [];

	for (const namespace of namespaces) {
		const isMain = namespace.kind === 'main';
		const membership = isMain ? mainRole : memberships.get(namespace.id);

		if (caller.admin !== true && membership === undefined) continue;

		data.push({
			id: namespace.id,
			name: namespace.name,
			kind: namespace.kind,
			readiness: namespace.readiness,
			local_role: membership ?? null,
			inherited_admin: !isMain && caller.admin === true,
			can_enter: namespace.readiness === 'ready',
			can_use_app: isMain ? caller.app === true : membership?.app_access === true,
		});
	}

	// What a claim-less token would resolve to, so a client can render the same
	// context the server would pick.
	const enterable = data.filter((namespace) => namespace.can_enter).map((namespace) => namespace.id);
	const configured = getDefaultNamespace();

	const fallback =
		(configured && enterable.includes(configured) ? configured : undefined) ??
		(enterable.includes('main') ? 'main' : undefined) ??
		enterable[0] ??
		null;

	return { data, default: fallback };
}
