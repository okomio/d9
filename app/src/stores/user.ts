import api from '@/api';
import { useLatencyStore } from '@/stores/latency';
import { User } from '@wbce-d9/types';
import { userName } from '@/utils/user-name';
import { merge } from 'lodash';
import { defineStore } from 'pinia';
import { getNamespaceRuntime } from '@/namespaces/live';

type ShareUser = {
	share: string;
	role: {
		id: string;
		admin_access: false;
		app_access: false;
	};
};

/** In a virtual namespace, inherited Global Admin has no local role. */
export type AppUser = Omit<User, 'role'> & { role: User['role'] | null };

export const useUserStore = defineStore({
	id: 'userStore',
	state: () => ({
		currentUser: null as AppUser | ShareUser | null,
		loading: false,
		error: null,
	}),
	getters: {
		fullName(): string | null {
			if (this.currentUser === null || 'share' in this.currentUser) return null;
			return userName(this.currentUser);
		},
		isAdmin(): boolean {
			const active = getNamespaceRuntime()?.state.active;
			if (active) return active.access.isNamespaceAdmin;
			return this.currentUser?.role?.admin_access === true || false;
		},
	},
	actions: {
		async hydrate() {
			this.loading = true;

			try {
				const fields = [
					'id',
					'language',
					'first_name',
					'last_name',
					'email',
					'last_page',
					'theme',
					'tfa_secret',
					'avatar.id',
					'role.admin_access',
					'role.app_access',
					'role.id',
					'role.enforce_tfa',
				];

				const { data } = await api.get(`/users/me`, { params: { fields } });

				this.currentUser = data.data;
			} catch (error: any) {
				this.error = error;
				throw error;
			} finally {
				this.loading = false;
			}
		},
		async dehydrate() {
			this.$reset();
		},
		async hydrateAdditionalFields(fields: string[]) {
			try {
				const { data } = await api.get(`/users/me`, { params: { fields } });
				const incoming = { ...data.data };

				if (getNamespaceRuntime()?.state.active?.namespace.kind === 'virtual') {
					// /users/me carries the shared role. Never merge it over a child role (or null).
					delete incoming.role;
				}

				this.currentUser = merge({}, this.currentUser, incoming);
			} catch (error: any) {
				// Do nothing
			}
		},
		async trackPage(page: string) {
			const latencyStore = useLatencyStore();

			const start = performance.now();

			await api.patch(`/users/me/track/page`, {
				last_page: page,
			});

			const end = performance.now();

			latencyStore.save({
				timestamp: new Date(),
				latency: end - start,
			});

			if (this.currentUser && !('share' in this.currentUser)) {
				this.currentUser.last_page = page;
			}
		},
	},
});
