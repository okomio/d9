import type { Request, RequestHandler } from 'express';
import getDatabase from '../database/index.js';
import { ForbiddenException } from '../exceptions/index.js';
import asyncHandler from '../utils/async-handler.js';
import { getDefaultNamespace, isNamespaceHeaderEnabled, NAMESPACE_HEADER } from './config.js';
import { runWithNamespace } from './context.js';
import { resolveNamespaceMembership } from './membership.js';
import { isControlPlanePath } from './paths.js';
import { pickNamespace } from './resolve.js';

/**
 * Namespace requested by the request itself: token claim, then the
 * development-only header, then the configured default.
 */
function readRequestedNamespace(req: Request): string | undefined {
	return pickNamespace({
		claimed: req.virtualNamespace,
		header: isNamespaceHeaderEnabled() ? req.header(NAMESPACE_HEADER) : undefined,
		fallback: getDefaultNamespace(),
	});
}

/**
 * Runs the rest of the request inside a virtual-namespace context.
 *
 * Only authenticated requests get a namespace, and never a control-plane path:
 * an anonymous caller must not be able to select where it reads from, and the
 * endpoints needed to recover from a bad namespace must stay reachable.
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

		const namespace = readRequestedNamespace(req);

		if (!namespace) {
			next();
			return;
		}

		if (accountability.admin !== true) {
			// Resolved against the shared schema: this runs before the namespace
			// context is entered, so `getDatabase()` is still the default.
			const membership = await resolveNamespaceMembership(getDatabase(), accountability.user, namespace);

			if (!membership) {
				throw new ForbiddenException();
			}

			accountability.role = membership.role;
			accountability.admin = membership.admin_access;
			accountability.app = membership.app_access;
		}

		runWithNamespace(namespace, next);
	});
}
