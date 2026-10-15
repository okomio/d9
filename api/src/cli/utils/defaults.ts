import type { Knex } from 'knex';
import { InvalidConfigException } from '../../exceptions/index.js';
import { isVirtualNamespaceEnabled } from '../../virtual-namespace/config.js';

export const defaultAdminRole = {
	name: 'Administrator',
	icon: 'verified',
	admin_access: true,
	description: '$t:admin_description',
};

/** Migrations run before the first admin exists, so their backfill cannot stamp it. */
export async function getDefaultAdminRole(database: Knex): Promise<typeof defaultAdminRole & { namespace?: string }> {
	if (!isVirtualNamespaceEnabled()) return defaultAdminRole;

	const main = await database.select('id').from('public.directus_namespaces').where('kind', 'main').first();
	if (!main) throw new InvalidConfigException('The main namespace must exist before creating the first administrator.');

	return { ...defaultAdminRole, namespace: main.id };
}

export const defaultAdminUser = {
	status: 'active',
	first_name: 'Admin',
	last_name: 'User',
};
