import { describe, expect, it } from 'vitest';
import { globalUsersPath } from './user-filter-route';

describe('Global Administration user links', () => {
	it('keeps the directory filter and active content context through a detail visit', () => {
		const query = { ns: 'content-a', admin_ns: 'tracking', admin_role: 'viewer' };
		expect(globalUsersPath(query, 'user/2')).toBe(
			'/global-admin/users/user%2F2?ns=content-a&admin_ns=tracking&admin_role=viewer'
		);
		expect(globalUsersPath(query)).toBe('/global-admin/users?ns=content-a&admin_ns=tracking&admin_role=viewer');
	});
});
