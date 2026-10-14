/**
 * Control-plane surfaces a namespace-scoped admin must not write to.
 *
 * A namespace admin legitimately needs admin rights over their *namespace*:
 * schema, flows, webhooks, presets, dashboards, and the content in it. What they
 * must not get is authority over the shared control plane, because that is
 * instance-wide: users, roles, permissions, settings and files are one set of
 * tables shared by every namespace.
 *
 * This guard exists because `admin_access` is a single boolean that means "skip
 * ACL checks" everywhere. Before it, a local admin could read the whole user
 * directory, read every namespace's roles, and PATCH a role belonging to another
 * namespace. The durable fix is the capability split the frontend plan calls for
 * in D04; this is the edge restriction that closes the escalation meanwhile.
 *
 * Reads stay open: a namespace admin is required to *see* all users.
 */
const CONTROL_PLANE_WRITE_PATHS = ['/users', '/roles', '/permissions', '/settings', '/files'];

function isSameOrChildPath(path: string, prefix: string): boolean {
	return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Whether this request would write to the shared control plane.
 *
 * `path` must be the request path without a query string (Express `req.path`).
 */
export function isControlPlaneWrite(method: string, path: string): boolean {
	if (method.toUpperCase() === 'GET' || method.toUpperCase() === 'HEAD') return false;

	return CONTROL_PLANE_WRITE_PATHS.some((prefix) => isSameOrChildPath(path, prefix));
}
