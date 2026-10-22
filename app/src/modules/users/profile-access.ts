import api from '@/api';

export type ProfileAccess = {
	memberships: {
		namespace_id: string;
		namespace_name: string;
		role_id: string | null;
		role_name: string | null;
		admin_access: boolean;
	}[];
	eligible_defaults: { id: string; name: string }[];
	default_namespace: string | null;
	inherited_global_admin: boolean;
};

export async function getProfileAccess(userId: string): Promise<ProfileAccess> {
	const path = userId === 'me' ? '/users/me/profile-access' : `/users/${encodeURIComponent(userId)}/profile-access`;
	const response = await api.get<{ data: ProfileAccess }>(path);
	return response.data.data;
}
