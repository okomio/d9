import type { ActiveNamespaceContext, PlatformCapabilities } from './types';

export type NamespaceAdminResource = 'schema' | 'roles' | 'members' | 'flows';
/** Specific namespace-management shortcuts; ordinary data field/row ACL remains in the snapshot. */
export function canManageNamespaceResource(
	context: ActiveNamespaceContext | null,
	resource: NamespaceAdminResource
): boolean {
	if (!context?.access.canUseApp) return false;

	switch (resource) {
		case 'schema':
			return context.access.canManageSchema;
		case 'roles':
			return context.access.isNamespaceAdmin;
		case 'members':
			return context.access.canManageMembers;
		case 'flows':
			return context.access.canManageFlows;
	}
}
/** Never accepts local role/admin flags as authority for shared resources. */
export function canManagePlatformResource(
	platform: PlatformCapabilities | null,
	resource: 'namespaces' | 'users' | 'settings'
): boolean {
	if (!platform?.isGlobalAdmin) return false;

	switch (resource) {
		case 'namespaces':
			return platform.canManageNamespaces;
		case 'users':
			return platform.canManageSharedUsers;
		case 'settings':
			return platform.canManageSharedSettings;
	}
}
