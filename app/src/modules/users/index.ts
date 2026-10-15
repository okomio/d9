import { defineModule } from '@wbce-d9/utils';
import ActiveCollection from './routes/active-collection.vue';
import ActiveItem from './routes/active-item.vue';
import { getNamespaceRuntime } from '@/namespaces/live';

export default defineModule({
	id: 'users',
	name: '$t:user_directory',
	icon: 'people_alt',
	routes: [
		{
			name: 'users-collection',
			path: '',
			component: ActiveCollection,
			props: (route) => ({
				role: route.params.role,
				bookmark: route.query.bookmark,
			}),
		},
		{
			name: 'users-item',
			path: ':primaryKey',
			component: ActiveItem,
			props: true,
		},
		{
			path: 'roles',
			redirect: '/users',
		},
		{
			name: 'roles-collection',
			path: 'roles/:role',
			component: ActiveCollection,
			props: true,
		},
		{
			name: 'roles-item-add',
			path: 'roles/:role/+',
			component: ActiveItem,
			props: (route) => ({
				primaryKey: '+',
				role: route.params.role,
			}),
		},
	],
	preRegisterCheck(user, permissions) {
		const active = getNamespaceRuntime()?.state.active;
		if (active?.namespace.kind === 'virtual') return active.access.canManageMembers;
		const admin = user.role.admin_access;
		if (admin) return true;

		const permission = permissions.find(
			(permission) => permission.collection === 'directus_users' && permission.action === 'read'
		);

		return !!permission;
	},
});
