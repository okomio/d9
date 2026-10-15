/**
 * Paths that always resolve on the shared schema.
 *
 * Identity, sessions and platform discovery must be answerable *before* a
 * namespace is known. A caller without a membership in the requested namespace
 * must still be able to log in, refresh, read its own user record and ask which
 * namespaces it may enter — otherwise a namespace hint could lock a user out of
 * the very endpoints needed to recover.
 *
 * The app mirrors this list in `app/src/api.ts` (`CONTROL_PLANE_PATHS`): it cannot
 * import from here, so a path added on one side has to be added on the other, or
 * the frontend scopes a request the backend answers from the shared schema.
 */
const CONTROL_PLANE_PATHS = ['/auth', '/server', '/assets', '/users/me', '/namespaces'];

function isSameOrChildPath(path: string, prefix: string): boolean {
	return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Whether `path` bypasses virtual-namespace resolution.
 *
 * `path` must be the request path without a query string (Express `req.path`).
 */
export function isControlPlanePath(path: string): boolean {
	return CONTROL_PLANE_PATHS.some((prefix) => isSameOrChildPath(path, prefix));
}
