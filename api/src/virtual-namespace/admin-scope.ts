/**
 * Control-plane write policy for a namespace-scoped admin.
 *
 * A namespace admin legitimately needs admin rights over their *namespace*:
 * schema, flows, webhooks, presets, dashboards, the content in it, and now its
 * own roles and permissions. What they must not get is authority over the shared
 * control plane, because that is instance-wide: users, settings and files are one
 * set of rows shared by every namespace.
 *
 * This guard exists because `admin_access` is a single boolean meaning "skip ACL
 * checks" everywhere. Before it, a local admin could read the whole user
 * directory and PATCH a role belonging to another namespace. The durable fix is
 * the effective-capability split D04 describes; this is the edge restriction that
 * closes the escalation meanwhile.
 *
 * Reads stay open: a namespace admin is required to *see* all users.
 */

/** Writes that are never available to a namespace-scoped admin. */
const ALWAYS_BLOCKED = ['/users', '/settings', '/files'];

/**
 * Writes to namespace-owned rows. These carry a `namespace` column, so the
 * target can be checked against the admin's own namespace.
 */
const NAMESPACE_OWNED = [
	{ prefix: '/roles', table: 'directus_roles' },
	{ prefix: '/permissions', table: 'directus_permissions' },
];

function isRead(method: string): boolean {
	const upper = method.toUpperCase();

	return upper === 'GET' || upper === 'HEAD';
}

function isSameOrChildPath(path: string, prefix: string): boolean {
	return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Whether this request would write to a surface that is shared instance-wide.
 *
 * `path` must be the request path without a query string (Express `req.path`).
 */
export function isAlwaysBlockedWrite(method: string, path: string): boolean {
	if (isRead(method)) return false;

	return ALWAYS_BLOCKED.some((prefix) => isSameOrChildPath(path, prefix));
}

/**
 * The namespace-owned table this request would write to, if any.
 */
export function namespaceOwnedWrite(
	method: string,
	path: string
): { prefix: string; table: string } | undefined {
	if (isRead(method)) return undefined;

	return NAMESPACE_OWNED.find((entry) => isSameOrChildPath(path, entry.prefix));
}

/**
 * The primary key addressed by the request, or undefined for a create.
 *
 * A create has no target yet: the row is stamped with the active namespace, so
 * it necessarily lands in the admin's own area.
 */
export function targetIdFromPath(path: string, prefix: string): string | undefined {
	const [id] = path
		.slice(prefix.length)
		.replace(/^\/+/, '')
		.split('/');

	return id ? id : undefined;
}
