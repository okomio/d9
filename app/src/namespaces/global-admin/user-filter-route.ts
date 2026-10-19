import type { LocationQuery } from 'vue-router';

/** Carry only the content context and global directory filter through a user detail visit. */
export function globalUsersPath(query: LocationQuery, userId?: string): string {
	const path = userId ? `/global-admin/users/${encodeURIComponent(userId)}` : '/global-admin/users';
	const parameters = new URLSearchParams();
	for (const key of ['ns', 'admin_ns', 'admin_role'] as const) {
		const value = query[key];
		if (typeof value === 'string') parameters.set(key, value);
	}
	const search = parameters.toString();
	return search ? `${path}?${search}` : path;
}
