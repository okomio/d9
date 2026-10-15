/**
 * The schema that holds the shared control plane.
 *
 * Namespace pools run with `search_path = [namespace, public]`, so this is the
 * schema that shared tables fall through to.
 */
export const CONTROL_PLANE_SCHEMA = 'public';

/**
 * Shared control-plane tables — the ones a namespace must NOT own a copy of.
 *
 * Two consumers depend on this list and must agree:
 * - the provisioner, which must not create these inside a namespace schema
 *   (a private `directus_sessions` breaks authentication outright, because the
 *   session created at login lives here);
 * - the schema filter, which must keep these visible through the `search_path`
 *   fallback while hiding everything else that still lives in `public`.
 */
export const SHARED_TABLES = [
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
];

/**
 * Tables deliberately left in `public` instead of moving into an area's namespace.
 *
 * `directus_users` holds foreign keys into both, and the shared user table must not depend on a
 * namespace. They stay visible from every namespace — `public` is in every `search_path` — so the
 * ownership filter has to count them as reachable. Otherwise a relation pointing at one of them
 * (`tracking_tags.team` → `tracking_teams`) cannot resolve, and the request fails with
 * `Cannot read properties of undefined (reading 'primary')`.
 */
export const EXCLUDED_TABLES = ['tracking_teams', 'tracking_tiers'];
