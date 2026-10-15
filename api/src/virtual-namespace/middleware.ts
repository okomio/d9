import type { Request, RequestHandler } from 'express';
import getDatabase from '../database/index.js';
import { ForbiddenException, InvalidPayloadException } from '../exceptions/index.js';
import asyncHandler from '../utils/async-handler.js';
import { isNamespaceHeaderEnabled, NAMESPACE_HEADER } from './config.js';
import { runWithNamespace } from './context.js';
import { resolveNamespaceRole } from './access.js';
import { isControlPlanePath } from './paths.js';
import { isSharedGraphQLOperation } from './graphql.js';
import { getNamespace } from './registry.js';
import { pickNamespace, resolveLegacyDefaultNamespace } from './resolve.js';
import { getActiveNamespaceId } from './context.js';
import { isAlwaysBlockedWrite, namespaceOwnedWrite, targetIdFromPath } from './admin-scope.js';

/**
 * The namespace the request asks for, keeping the claim and the header separate
 * because a contradiction between them is an error rather than a preference.
 */
function readRequestedNamespace(req: Request): { claimed?: string | undefined; header?: string | undefined } {
	return {
		claimed: pickNamespace({ claimed: req.virtualNamespace }),
		header: isNamespaceHeaderEnabled() ? pickNamespace({ header: req.header(NAMESPACE_HEADER) }) : undefined,
	};
}

/**
 * Runs the rest of the request inside a virtual-namespace context.
 *
 * Only authenticated requests get a namespace, and never a control-plane path:
 * an anonymous caller must not be able to select where it reads from, and the
 * endpoints needed to recover from a bad namespace must stay reachable.
 *
 * The requested value is a namespace *id*, resolved through the registry. Both
 * an unknown id and a namespace that is not ready fail closed: silently falling
 * back to the default would serve the wrong data under a correct-looking label.
 *
 * For an authenticated non-admin main uses the shared primary role, while a
 * child uses its membership role and access flags. Global admins cross every
 * namespace without a membership.
 */
export function virtualNamespace(): RequestHandler {
	return asyncHandler(async (req, res, next) => {
		const accountability = req.accountability;

		if (
			!accountability?.user ||
			isControlPlanePath(req.path) ||
			isSharedGraphQLOperation(req.path, res.locals['graphqlParams'])
		) {
			next();
			return;
		}

		const { claimed, header } = readRequestedNamespace(req);

		if (claimed && header && claimed !== header) {
			throw new InvalidPayloadException(`"${NAMESPACE_HEADER}" conflicts with the namespace of the supplied token`);
		}

		const database = getDatabase();

		const requested =
			pickNamespace({ claimed, header }) ?? (await resolveLegacyDefaultNamespace(database, accountability.user));

		if (!requested) {
			throw new ForbiddenException();
		}

		// Resolved against the shared schema: this runs before the namespace
		// context is entered, so `getDatabase()` is still the default.
		const namespace = await getNamespace(database, requested);

		if (!namespace || namespace.readiness !== 'ready') {
			throw new ForbiddenException();
		}

		if (accountability.globalAdmin !== true) {
			const membership = await resolveNamespaceRole(
				database,
				{
					user: accountability.user,
					role: accountability.role ?? null,
					admin: false,
					app: accountability.app === true,
				},
				namespace
			);

			if (!membership) {
				throw new ForbiddenException();
			}

			// Remember where this admin authority came from. The guard mounted
			// after this middleware uses it to keep a namespace admin off the
			// shared control plane, which is instance-wide.
			if (namespace.kind !== 'main' && membership.admin_access) req.namespaceScopedAdmin = true;

			accountability.role = membership.id;
			accountability.admin = membership.admin_access;
			accountability.app = membership.app_access;
		}

		// The context carries the physical schema: `search_path` and the caches
		// work in terms of the schema, while the id is what belongs in `namespace`
		// columns, memberships and token claims.
		runWithNamespace({ id: namespace.id, schema: namespace.schema_name, kind: namespace.kind }, next);
	});
}

/**
 * Keeps a namespace-scoped admin off the shared control plane, while leaving
 * them in charge of their own namespace — including its roles and permissions,
 * whose rows now carry a namespace.
 *
 * Must be mounted after `virtualNamespace()`, which is what records that the
 * caller's admin authority came from a membership rather than from the shared
 * role.
 */
export function namespaceAdminScope(): RequestHandler {
	return asyncHandler(async (req, _res, next) => {
		if (req.namespaceScopedAdmin !== true) {
			next();
			return;
		}

		if (isAlwaysBlockedWrite(req.method, req.path)) {
			throw new ForbiddenException();
		}

		const owned = namespaceOwnedWrite(req.method, req.path);

		if (owned) {
			const targetId = targetIdFromPath(req.path, owned.prefix);

			// A create has no target: `stampNamespace` puts it in the admin's own
			// namespace, so there is nothing to check.
			if (targetId) {
				const row = await getDatabase().select('namespace').from(owned.table).where({ id: targetId }).first();

				if (row && row.namespace !== getActiveNamespaceId()) {
					throw new ForbiddenException();
				}
			}
		}

		next();
	});
}
