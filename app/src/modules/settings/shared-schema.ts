/** Mirrors the backend's shared control-plane tables for Data Model navigation guards. */
const sharedCollections = new Set([
	'directus_activity',
	'directus_files',
	'directus_folders',
	'directus_migrations',
	'directus_namespaces',
	'directus_permissions',
	'directus_revisions',
	'directus_roles',
	'directus_sessions',
	'directus_settings',
	'directus_user_namespaces',
	'directus_users',
]);

export function isSharedControlPlaneCollection(collection: string): boolean {
	return sharedCollections.has(collection);
}

/** Shared user/file/settings grants need resource-specific backend policy first. */
export function isChildRolePermissionSupported(collection: string): boolean {
	return ![
		'directus_users',
		'directus_files',
		'directus_folders',
		'directus_settings',
		'directus_sessions',
		'directus_namespaces',
		'directus_user_namespaces',
		'directus_shares',
	].includes(collection);
}
