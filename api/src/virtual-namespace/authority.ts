import type { Accountability } from '@wbce-d9/types';
import type { Knex } from 'knex';
import { ForbiddenException } from '../exceptions/index.js';
import { isVirtualNamespaceEnabled } from './config.js';
import { getActiveNamespaceId } from './context.js';

/**
 * Resolve shared-account authority from the current primary role. A child role
 * cannot become instance authority by appearing in a token or users.role.
 * Explicit shared tables also make this safe inside a child request.
 */
export async function resolveSharedAccountability(
	database: Knex,
	accountability: Accountability
): Promise<Accountability> {
	if (!isVirtualNamespaceEnabled()) return accountability;

	if (accountability.share || accountability.share_scope) {
		return { ...accountability, admin: false, app: false, globalAdmin: false };
	}

	const shared = accountability.user
		? await database
				.select('u.role', 'r.admin_access', 'r.app_access', 'n.kind')
				.from('public.directus_users as u')
				.leftJoin('public.directus_roles as r', 'u.role', 'r.id')
				.leftJoin('public.directus_namespaces as n', 'r.namespace', 'n.id')
				.where('u.id', accountability.user)
				.first()
		: undefined;

	const hasMainRole = shared?.kind === 'main';
	const globalAdmin = hasMainRole && (shared.admin_access === true || shared.admin_access === 1);

	return {
		...accountability,
		role: hasMainRole ? shared.role : null,
		admin: globalAdmin,
		app: hasMainRole && (shared.app_access === true || shared.app_access === 1),
		globalAdmin,
	};
}

export function hasGlobalAuthority(accountability: Accountability | null | undefined): boolean {
	return isVirtualNamespaceEnabled() ? accountability?.globalAdmin === true : accountability?.admin === true;
}

/** Internal calls without accountability retain the established trusted scope. */
export function assertSharedWrite(collection: string, accountability: Accountability | null | undefined): void {
	if (
		!isVirtualNamespaceEnabled() ||
		!getActiveNamespaceId() ||
		!accountability?.admin ||
		hasGlobalAuthority(accountability)
	) {
		return;
	}

	if (collection === 'directus_users' || collection === 'directus_settings') {
		throw new ForbiddenException();
	}
}

/** Shared storage never grants cross-namespace access to a file or folder. */
export async function assertFileLibraryWrite(
	database: Knex,
	collection: string,
	data?: Record<string, unknown>,
	keys?: (string | number)[]
): Promise<void> {
	if (!isVirtualNamespaceEnabled() || !['directus_files', 'directus_folders'].includes(collection)) return;
	const namespace = getActiveNamespaceId() ?? 'main';

	if (data && Object.hasOwn(data, 'namespace') && data['namespace'] !== namespace) throw new ForbiddenException();

	if (keys?.length) {
		const owned = await database(collection)
			.whereIn('id', keys)
			.where('namespace', namespace)
			.count('* as count')
			.first();
		if (Number(owned?.['count'] ?? 0) !== new Set(keys.map(String)).size) throw new ForbiddenException();
	}

	const relation = collection === 'directus_files' ? 'folder' : 'parent';
	const folder = data?.[relation];
	if (folder !== undefined && folder !== null) {
		if (typeof folder !== 'string') throw new ForbiddenException();
		const target = await database('directus_folders').select('namespace').where('id', folder).first();
		if (target?.namespace !== namespace) throw new ForbiddenException();
	}
}

/** The same ownership rule applies to direct, batch and nested mutations. */
export async function assertNamespaceOwnedWrite(
	database: Knex,
	collection: string,
	accountability: Accountability | null | undefined,
	data?: Record<string, unknown>,
	keys?: (string | number)[]
): Promise<void> {
	const namespace = getActiveNamespaceId();

	if (
		!isVirtualNamespaceEnabled() ||
		!namespace ||
		!accountability?.admin ||
		hasGlobalAuthority(accountability) ||
		(collection !== 'directus_roles' && collection !== 'directus_permissions')
	) {
		return;
	}

	if (data && Object.hasOwn(data, 'namespace') && data['namespace'] !== namespace) throw new ForbiddenException();

	if (collection === 'directus_permissions' && data?.['role'] != null) {
		const role = data['role'];
		const roleId = typeof role === 'object' ? (role as { id?: unknown }).id : role;

		// An object without an id creates a role through the nested mutation
		// path, whose own namespace guard runs before that role is written.
		if (roleId != null) {
			if (typeof roleId !== 'string') throw new ForbiddenException();

			const owner = await database('public.directus_roles').select('namespace').where('id', roleId).first();
			if (owner?.namespace !== namespace) throw new ForbiddenException();
		}
	}

	if (keys?.length) {
		const foreign = await database(collection)
			.select('id')
			.whereIn('id', keys)
			.andWhere((query) => query.whereNot('namespace', namespace).orWhereNull('namespace'))
			.first();

		if (foreign) throw new ForbiddenException();

		if (collection === 'directus_permissions') {
			const foreignRole = await database('public.directus_permissions as permission')
				.select('permission.id')
				.leftJoin('public.directus_roles as target_role', 'permission.role', 'target_role.id')
				.whereIn('permission.id', keys)
				.whereNotNull('permission.role')
				.andWhere((query) => query.whereNot('target_role.namespace', namespace).orWhereNull('target_role.namespace'))
				.first();

			if (foreignRole) throw new ForbiddenException();
		}
	}
}
