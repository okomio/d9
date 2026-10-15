import api from '@/api';
import { unexpectedError } from '@/utils/unexpected-error';
import { Role } from '@wbce-d9/types';
import { ref, Ref } from 'vue';

let roles: Ref<BasicRole[] | null> | null = null;
let loading: Ref<boolean> | null = null;
let navigationGeneration = 0;

export function resetUserNavigation() {
	navigationGeneration++;
	if (roles) roles.value = null;
	if (loading) loading.value = false;
}

export type BasicRole = Pick<Role, 'id' | 'name' | 'icon' | 'admin_access'>;

export default function useNavigation(): { roles: Ref<BasicRole[] | null>; loading: Ref<boolean> } {
	if (roles === null) {
		roles = ref<BasicRole[] | null>(null);
	}

	if (loading === null) {
		loading = ref(false);
	}

	if (loading?.value === false) {
		fetchRoles();
	}

	return { roles, loading };

	async function fetchRoles() {
		const generation = navigationGeneration;
		if (!loading || !roles) return;
		if (!roles.value) loading.value = true;

		try {
			const rolesResponse = await api.get(`/roles`, {
				params: {
					sort: 'name',
					fields: ['id', 'name', 'icon', 'admin_access'],
				},
			});

			if (generation === navigationGeneration) roles.value = rolesResponse.data.data;
		} catch (error: any) {
			if (generation === navigationGeneration) unexpectedError(error);
		} finally {
			if (generation === navigationGeneration) loading.value = false;
		}
	}
}
