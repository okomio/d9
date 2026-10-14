import type { Request, RequestHandler } from 'express';
import getDatabase from '../database/index.js';
import { ForbiddenException, InvalidPayloadException } from '../exceptions/index.js';
import asyncHandler from '../utils/async-handler.js';
import { getDefaultNamespace, isNamespaceHeaderEnabled, NAMESPACE_HEADER } from './config.js';
import { runWithNamespace } from './context.js';
import { resolveNamespaceMembership } from './membership.js';
import { isControlPlanePath } from './paths.js';
import { getNamespace } from './registry.js';
import { pickNamespace } from './resolve.js';

/**
 * The namespace the request asks for, keeping the claim and the header separate
 * because a contradiction between them is an error rather than a preference.
 */
function readRequestedNamespace(req: Request): { claimed?: string | undefined; header?: string | undefined } {
	return {
		claimed: req.virtualNamespace,
		header: isNamespaceHeaderEnabled() ? req.header(NAMESPACE_HEADER) : undefined,
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
 * For an authenticated non-admin the role is resolved from the membership table
 * together with its access flags, and replaces `accountability.role`. Without a
 * membership the request is rejected. Global admins cross every namespace
 * without one.
 */
export function virtualNamespace(): RequestHandler {
	return asyncHandler(async (req, _res, next) => {
		const accountability = req.accountability;

		if (!accountability?.user || isControlPlanePath(req.path)) {
			next();
			return;
		}

		const { claimed, header } = readRequestedNamespace(req);

		if (claimed && header && claimed !== header) {
			throw new InvalidPayloadException(`"${NAMESPACE_HEADER}" conflicts with the namespace of the supplied token`);
		}

		const requested = pickNamespace({ claimed, header, fallback: getDefaultNamespace() });

		if (!requested) {
			next();
			return;
		}

		// Resolved against the shared schema: this runs before the namespace
		// context is entered, so `getDatabase()` is still the default.
		const database = getDatabase();
		const namespace = await getNamespace(database, requested);

		if (!namespace || namespace.readiness !== 'ready') {
			throw new ForbiddenException();
		}

		if (accountability.admin !== true) {
			const membership = await resolveNamespaceMembership(database, accountability.user, namespace.id);

			if (!membership) {
				throw new ForbiddenException();
			}

			accountability.role = membership.role;
			accountability.admin = membership.admin_access;
			accountability.app = membership.app_access;
		}

		// The context carries the physical schema: `search_path` and the caches
		// work in terms of the schema, while the id stays the external identifier.
		runWithNamespace(namespace.schema_name, next);
	});
}
