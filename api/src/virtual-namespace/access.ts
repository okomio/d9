import type { Knex } from 'knex';
import { getDefaultNamespace } from './config.js';
import { MEMBERSHIP_TABLE, resolveNamespaceMembership, ROLES_TABLE } from './membership.js';
import { getNamespace, listNamespaces, type NamespaceKind, type NamespaceReadiness, type NamespaceRecord } from './registry.js';

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

/**
 * The namespace context attached to a token response, so a client never has to
 * infer the effective role or capabilities from the token's own flags.
 */
export type NamespaceContextPayload = {
	is_global_admin: boolean;
	namespace: NamespaceAccess | null;
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

async function listMemberships(
	database: Knex,
	userId: string,
	namespaceId?: string
): Promise<Map<string, NamespaceRole>> {
	const query = database
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

	if (namespaceId) query.andWhere('m.namespace_id', namespaceId);

	const rows = await query;
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
 * The role a caller holds in a namespace: the membership role, or the shared
 * (main-namespace) role for the main namespace itself.
 *
 * Returns undefined when the caller holds nothing, which is what makes the
 * Global Admin case representable: authority with no membership row.
 */
async function resolveRole(
	database: Knex,
	caller: CallerIdentity,
	namespace: NamespaceRecord
): Promise<NamespaceRole | undefined> {
	if (namespace.kind === 'main') {
		return caller.role ? await getRole(database, caller.role) : undefined;
	}

	if (!caller.user) return undefined;

	return (await listMemberships(database, caller.user, namespace.id)).get(namespace.id);
}

/**
 * Whether the caller may use the app in this namespace.
 *
 * Entry authority is namespace-independent for a Global Admin, so app entitlement
 * has to be too. Reading `app_access` alone made the two flags contradict each
 * other — enterable, but reported unable to use the app — and the shell treats
 * that as `app-denied` and refuses to enter at all, which strands a Global Admin
 * with no membership on the chooser.
 *
 * A role that bypasses every ACL is likewise not "API only": the surfaces it
 * exists to administer require app access. A member whose role grants neither
 * keeps the API-only label.
 */
function hasEffectiveAppAccess(
	isMain: boolean,
	membership: NamespaceRole | undefined,
	caller: CallerIdentity
): boolean {
	if (caller.admin === true) return true;
	if (isMain) return caller.app === true;

	return membership?.app_access === true || membership?.admin_access === true;
}

function buildAccess(namespace: NamespaceRecord, membership: NamespaceRole | undefined, caller: CallerIdentity): NamespaceAccess {
	const isMain = namespace.kind === 'main';

	return {
		id: namespace.id,
		name: namespace.name,
		kind: namespace.kind,
		readiness: namespace.readiness,
		local_role: membership ?? null,
		inherited_admin: !isMain && caller.admin === true,
		can_enter: namespace.readiness === 'ready',
		can_use_app: hasEffectiveAppAccess(isMain, membership, caller),
	};
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
		const membership = namespace.kind === 'main' ? mainRole : memberships.get(namespace.id);

		if (caller.admin !== true && membership === undefined) continue;

		data.push(buildAccess(namespace, membership, caller));
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

/**
 * The effective access for one namespace, shaped for a token response.
 *
 * `namespaceId` defaults to the configured default, which is what a claim-less
 * token would resolve to. `namespace` is null when nothing resolves, so a client
 * never has to guess whether the field is absent or empty.
 */
export async function describeNamespaceContext(
	database: Knex,
	caller: CallerIdentity,
	namespaceId?: string
): Promise<NamespaceContextPayload> {
	const is_global_admin = caller.admin === true;
	const target = namespaceId ?? getDefaultNamespace();

	if (!target) return { is_global_admin, namespace: null };

	const namespace = await getNamespace(database, target);

	if (!namespace) return { is_global_admin, namespace: null };

	const membership = await resolveRole(database, caller, namespace);

	return { is_global_admin, namespace: buildAccess(namespace, membership, caller) };
}
