import type { Request } from 'express';
import { Router } from 'express';
import getDatabase from '../database/index.js';
import { ForbiddenException, InvalidCredentialsException, InvalidPayloadException } from '../exceptions/index.js';
import { respond } from '../middleware/respond.js';
import { AuthenticationService } from '../services/authentication.js';
import asyncHandler from '../utils/async-handler.js';
import { listAccessibleNamespaces } from '../virtual-namespace/access.js';
import {
	addMember,
	canManageMembers,
	listMembers,
	lookupUsers,
	removeMember,
	updateMemberRole,
} from '../virtual-namespace/members.js';
import { getNamespace } from '../virtual-namespace/registry.js';
import { hasGlobalAuthority } from '../virtual-namespace/authority.js';
import { preferredLandingNamespace } from '../virtual-namespace/profile-access.js';

const router = Router();

/**
 * Authority for membership administration of one namespace.
 *
 * Checked explicitly rather than inferred from the namespace context, because
 * `/namespaces` is a control-plane path: being an admin somewhere must not
 * confer the right to hand out roles somewhere else.
 */
async function assertCanManage(req: Request, namespaceId: string): Promise<void> {
	const accountability = req.accountability;

	if (!accountability?.user) {
		throw new InvalidCredentialsException();
	}

	const database = getDatabase();
	const namespace = await getNamespace(database, namespaceId);

	if (!namespace) throw new ForbiddenException();

	const allowed = await canManageMembers(
		database,
		{ user: accountability.user, admin: hasGlobalAuthority(accountability) },
		namespaceId
	);

	if (!allowed) throw new ForbiddenException();
}

function requireString(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new InvalidPayloadException(`"${name}" is required`);
	}

	return value;
}

function optionalNumber(value: unknown): number | undefined {
	const parsed = Number(value);

	return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/**
 * The namespaces the caller may see, with their effective access and the
 * namespace a claim-less token would resolve to.
 */
router.get(
	'/',
	asyncHandler(async (req, res, next) => {
		const accountability = req.accountability;

		if (!accountability?.user) {
			throw new InvalidCredentialsException();
		}

		const { data, default: defaultNamespace } = await listAccessibleNamespaces(getDatabase(), {
			user: accountability.user,
			role: accountability.role ?? null,
			admin: hasGlobalAuthority(accountability),
			app: accountability.app === true,
		});

		const eligible = data
			.filter((namespace) => namespace.kind === 'virtual' && namespace.can_enter && namespace.can_use_app)
			.map((namespace) => namespace.id);

		const preferred = await preferredLandingNamespace(getDatabase(), accountability.user, eligible);
		res.locals['payload'] = { data, default: defaultNamespace, preferred };

		return next();
	}),
	respond
);

/** Role choices for a ready namespace. Never return roles from another area. */
router.get(
	'/:namespace/roles',
	asyncHandler(async (req, res, next) => {
		const namespaceId = req.params['namespace']!;
		await assertCanManage(req, namespaceId);
		const namespace = await getNamespace(getDatabase(), namespaceId);
		if (namespace?.kind !== 'virtual' || namespace.readiness !== 'ready') throw new ForbiddenException();

		const roles = await getDatabase()
			.select(['id', 'name', 'admin_access', 'app_access'])
			.from('directus_roles')
			.where('namespace', namespaceId)
			.orderBy('name');

		res.locals['payload'] = { data: roles };
		return next();
	}),
	respond
);

/**
 * Members of one namespace, with local role counts.
 *
 * Counts come from memberships: `directus_roles.users` is the shared primary-role
 * relation and says nothing about this namespace.
 */
router.get(
	'/:namespace/members',
	asyncHandler(async (req, res, next) => {
		const namespaceId = req.params['namespace']!;
		await assertCanManage(req, namespaceId);

		const search = typeof req.query['search'] === 'string' ? (req.query['search'] as string) : undefined;

		const result = await listMembers(getDatabase(), namespaceId, {
			search,
			roleId: typeof req.query['role_id'] === 'string' ? req.query['role_id'] : undefined,
			limit: optionalNumber(req.query['limit']),
			offset: optionalNumber(req.query['offset']),
		});

		res.locals['payload'] = { data: result.data, meta: { total_count: result.total, role_counts: result.role_counts } };

		return next();
	}),
	respond
);

/**
 * The *Add existing user* picker. Returns agreed identity fields only, one page
 * at a time: a local admin picks an existing account, it does not browse the
 * directory.
 */
router.get(
	'/:namespace/members/lookup',
	asyncHandler(async (req, res, next) => {
		const namespaceId = req.params['namespace']!;
		await assertCanManage(req, namespaceId);

		const search = typeof req.query['search'] === 'string' ? (req.query['search'] as string) : undefined;

		res.locals['payload'] = {
			data: await lookupUsers(getDatabase(), namespaceId, search, optionalNumber(req.query['limit']) ?? 20),
		};

		return next();
	}),
	respond
);

/** Grants a local role. Writes the membership, never the shared user record. */
router.post(
	'/:namespace/members',
	asyncHandler(async (req, res, next) => {
		const namespaceId = req.params['namespace']!;
		await assertCanManage(req, namespaceId);

		await addMember(
			getDatabase(),
			namespaceId,
			requireString(req.body?.user_id, 'user_id'),
			requireString(req.body?.role_id, 'role_id')
		);

		res.status(204);
		res.locals['payload'] = null;

		return next();
	}),
	respond
);

/** Changes a local role. Cannot demote the last admin of the namespace. */
router.patch(
	'/:namespace/members/:user',
	asyncHandler(async (req, res, next) => {
		const namespaceId = req.params['namespace']!;
		await assertCanManage(req, namespaceId);

		if (req.params['user'] === req.accountability?.user && !hasGlobalAuthority(req.accountability)) {
			throw new ForbiddenException();
		}

		await updateMemberRole(
			getDatabase(),
			namespaceId,
			requireString(req.params['user'], 'user'),
			requireString(req.body?.role_id, 'role_id')
		);

		res.status(204);
		res.locals['payload'] = null;

		return next();
	}),
	respond
);

/**
 * Removes one membership. The shared account, its global profile and its
 * memberships elsewhere are untouched, and this cannot revoke inherited Global
 * Admin authority. Cannot remove the last admin.
 */
router.delete(
	'/:namespace/members/:user',
	asyncHandler(async (req, res, next) => {
		const namespaceId = req.params['namespace']!;
		await assertCanManage(req, namespaceId);

		if (req.params['user'] === req.accountability?.user && !hasGlobalAuthority(req.accountability)) {
			throw new ForbiddenException();
		}

		await removeMember(getDatabase(), namespaceId, requireString(req.params['user'], 'user'));

		res.status(204);
		res.locals['payload'] = null;

		return next();
	}),
	respond
);

/**
 * Mint an access token scoped to another namespace, for the caller's own
 * session.
 */
router.post(
	'/:namespace/token',
	asyncHandler(async (req, res, next) => {
		const accountability = req.accountability;

		if (!accountability?.user) {
			throw new InvalidCredentialsException();
		}

		const authenticationService = new AuthenticationService({
			accountability,
			schema: req.schema,
		});

		const { accessToken, expires, namespaceContext } = await authenticationService.mintNamespaceToken(
			req.params['namespace']!
		);

		res.locals['payload'] = {
			data: {
				access_token: accessToken,
				expires,
				...namespaceContext,
			},
		};

		return next();
	}),
	respond
);

export default router;
