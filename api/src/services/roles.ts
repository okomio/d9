import type { Query } from '@wbce-d9/types';
import { ForbiddenException, UnprocessableEntityException } from '../exceptions/index.js';
import type { AbstractServiceOptions, Alterations, Item, MutationOptions, PrimaryKey } from '../types/index.js';
import { ItemsService } from './items.js';
import { PermissionsService } from './permissions.js';
import { PresetsService } from './presets.js';
import { UsersService } from './users.js';
import { assertNamespaceOwnedWrite } from '../virtual-namespace/authority.js';
import { getActiveNamespaceId, getActiveNamespaceKind } from '../virtual-namespace/context.js';
import { MEMBERSHIP_TABLE } from '../virtual-namespace/membership.js';

export class RolesService extends ItemsService {
	constructor(options: AbstractServiceOptions) {
		super('directus_roles', options);
	}

	private async checkForOtherAdminRoles(excludeKeys: PrimaryKey[]): Promise<void> {
		// Make sure there's at least one admin role left after this deletion is done
		const otherAdminRoles = await this.knex
			.count('*', { as: 'count' })
			.from('directus_roles')
			.whereNotIn('id', excludeKeys)
			.andWhere({ admin_access: true })
			.first();

		const otherAdminRolesCount = +(otherAdminRoles?.count || 0);
		if (otherAdminRolesCount === 0) throw new UnprocessableEntityException(`You can't delete the last admin role.`);
	}

	private async checkForOtherAdminUsers(key: PrimaryKey, users: Alterations | Item[]): Promise<void> {
		const role = await this.knex.select('admin_access').from('directus_roles').where('id', '=', key).first();

		if (!role) throw new ForbiddenException();

		// The users that will now be in this new non-admin role
		let userKeys: PrimaryKey[] = [];

		if (Array.isArray(users)) {
			userKeys = users.map((user) => (typeof user === 'string' ? user : user['id'])).filter((id) => id);
		} else {
			userKeys = users.update.map((user) => user['id']).filter((id) => id);
		}

		const usersThatWereInRoleBefore = (await this.knex.select('id').from('directus_users').where('role', '=', key)).map(
			(user) => user.id
		);

		const usersThatAreRemoved = usersThatWereInRoleBefore.filter((id) =>
			Array.isArray(users) ? userKeys.includes(id) === false : users.delete.includes(id) === true
		);

		const usersThatAreAdded = Array.isArray(users) ? users : users.create;

		// If the role the users are moved to is an admin-role, and there's at least 1 (new) admin
		// user, we don't have to check for other admin
		// users
		if ((role.admin_access === true || role.admin_access === 1) && usersThatAreAdded.length > 0) return;

		const otherAdminUsers = await this.knex
			.count('*', { as: 'count' })
			.from('directus_users')
			.whereNotIn('directus_users.id', [...userKeys, ...usersThatAreRemoved])
			.andWhere({ 'directus_roles.admin_access': true })
			.leftJoin('directus_roles', 'directus_users.role', 'directus_roles.id')
			.first();

		const otherAdminUsersCount = +(otherAdminUsers?.count || 0);

		if (otherAdminUsersCount === 0) {
			throw new UnprocessableEntityException(`You can't remove the last admin user from the admin role.`);
		}

		return;
	}

	override async updateOne(key: PrimaryKey, data: Record<string, any>, opts?: MutationOptions): Promise<PrimaryKey> {
		try {
			if ('users' in data) {
				await this.checkForOtherAdminUsers(key, data['users']);
			}
		} catch (err: any) {
			(opts || (opts = {})).preMutationException = err;
		}

		return super.updateOne(key, data, opts);
	}

	override async updateBatch(data: Record<string, any>[], opts?: MutationOptions): Promise<PrimaryKey[]> {
		const primaryKeyField = this.schema.collections[this.collection]!.primary;

		const keys = data.map((item) => item[primaryKeyField]);
		const setsToNoAdmin = data.some((item) => item['admin_access'] === false);

		try {
			if (setsToNoAdmin) {
				await this.checkForOtherAdminRoles(keys);
			}
		} catch (err: any) {
			(opts || (opts = {})).preMutationException = err;
		}

		return super.updateBatch(data, opts);
	}

	override async updateMany(
		keys: PrimaryKey[],
		data: Record<string, any>,
		opts?: MutationOptions
	): Promise<PrimaryKey[]> {
		try {
			if ('admin_access' in data && data['admin_access'] === false) {
				await this.checkForOtherAdminRoles(keys);
			}
		} catch (err: any) {
			(opts || (opts = {})).preMutationException = err;
		}

		return super.updateMany(keys, data, opts);
	}

	override async deleteOne(key: PrimaryKey): Promise<PrimaryKey> {
		await this.deleteMany([key]);
		return key;
	}

	override async deleteMany(keys: PrimaryKey[]): Promise<PrimaryKey[]> {
		await assertNamespaceOwnedWrite(this.knex, this.collection, this.accountability, undefined, keys);
		const opts: MutationOptions = {};
		const virtualNamespaceId = getActiveNamespaceKind() === 'virtual' ? getActiveNamespaceId() : undefined;

		if (!virtualNamespaceId) {
			try {
				await this.checkForOtherAdminRoles(keys);
			} catch (err: any) {
				opts.preMutationException = err;
			}
		}

		await this.knex.transaction(async (trx) => {
			if (virtualNamespaceId) {
				// Serialize role deletions within an area, then check the actual role
				// ownership and remaining local admin access before any mutation.
				await trx.raw('select id from directus_namespaces where id = ? for update', [virtualNamespaceId]);

				const roles = await trx('directus_roles')
					.select(['id', 'admin_access'])
					.where({ namespace: virtualNamespaceId })
					.whereIn('id', keys);

				if (roles.length !== new Set(keys).size) throw new ForbiddenException();

				if (roles.some((role) => role.admin_access === true || role.admin_access === 1)) {
					const remainingRoles = await trx('directus_roles')
						.where({ namespace: virtualNamespaceId, admin_access: true })
						.whereNotIn('id', keys)
						.count({ count: '*' })
						.first();

					if (Number(remainingRoles?.count ?? 0) === 0) {
						throw new UnprocessableEntityException(`You can't delete the last admin role.`);
					}

					const affectedAdmins = await trx(`${MEMBERSHIP_TABLE} as m`)
						.join('directus_roles as r', 'm.role_id', 'r.id')
						.where('m.namespace_id', virtualNamespaceId)
						.whereIn('m.role_id', keys)
						.andWhere('r.admin_access', true)
						.count({ count: '*' })
						.first();

					if (Number(affectedAdmins?.count ?? 0) > 0) {
						const remainingAdmins = await trx(`${MEMBERSHIP_TABLE} as m`)
							.join('directus_roles as r', 'm.role_id', 'r.id')
							.where('m.namespace_id', virtualNamespaceId)
							.whereNotIn('m.role_id', keys)
							.andWhere('r.admin_access', true)
							.count({ count: '*' })
							.first();

						if (Number(remainingAdmins?.count ?? 0) === 0) {
							throw new UnprocessableEntityException('A namespace must keep at least one admin');
						}
					}
				}

				const foreignMembers = await trx(MEMBERSHIP_TABLE)
					.whereIn('role_id', keys)
					.whereNot('namespace_id', virtualNamespaceId)
					.count({ count: '*' })
					.first();

				if (Number(foreignMembers?.count ?? 0) > 0) {
					throw new UnprocessableEntityException('This role is assigned in another namespace');
				}

				const sharedUsers = await trx('directus_users').whereIn('role', keys).count({ count: '*' }).first();

				if (Number(sharedUsers?.count ?? 0) > 0) {
					throw new UnprocessableEntityException('This role is assigned as a shared user role');
				}
			}

			const itemsService = new ItemsService('directus_roles', {
				knex: trx,
				accountability: this.accountability,
				schema: this.schema,
			});

			const permissionsService = new PermissionsService({
				knex: trx,
				accountability: this.accountability,
				schema: this.schema,
			});

			const presetsService = new PresetsService({
				knex: trx,
				accountability: this.accountability,
				schema: this.schema,
			});

			const usersService = new UsersService({
				knex: trx,
				accountability: this.accountability,
				schema: this.schema,
			});

			// Delete permissions/presets for this role, suspend all remaining users in role

			await permissionsService.deleteByQuery(
				{
					filter: { role: { _in: keys } },
				},
				{ ...opts, bypassLimits: true }
			);

			await presetsService.deleteByQuery(
				{
					filter: { role: { _in: keys } },
				},
				{ ...opts, bypassLimits: true }
			);

			if (virtualNamespaceId) {
				// A local role belongs to membership rows. Never mutate the shared
				// user account or its main role when removing it.
				await trx(MEMBERSHIP_TABLE).where({ namespace_id: virtualNamespaceId }).whereIn('role_id', keys).delete();
			} else {
				await usersService.updateByQuery(
					{
						filter: { role: { _in: keys } },
					},
					{
						status: 'suspended',
						role: null,
					},
					{ ...opts, bypassLimits: true }
				);
			}

			await itemsService.deleteMany(keys, opts);
		});

		return keys;
	}

	override deleteByQuery(query: Query, opts?: MutationOptions): Promise<PrimaryKey[]> {
		return super.deleteByQuery(query, opts);
	}
}
