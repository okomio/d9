import type { RequestHandler } from 'express';
import getDatabase from '../database/index.js';
import { ForbiddenException } from '../exceptions/index.js';
import asyncHandler from '../utils/async-handler.js';
import { getDefaultNamespace, NAMESPACE_HEADER } from './config.js';
import { runWithNamespace } from './context.js';
import { resolveNamespaceRole } from './membership.js';

/**
 * Runs the rest of the request inside a virtual-namespace context.
 *
 * Resolution order for the namespace itself:
 *   1. the namespace claim of the access token (server-asserted);
 *   2. the `X-Namespace` header (internal tooling / debugging only);
 *   3. the configured default.
 *
 * Only *authenticated* requests get a namespace. Identity, sessions and
 * `/auth/*` always stay on the shared schema, and an anonymous request must not
 * be able to select where it reads from.
 *
 * For an authenticated non-admin the role is resolved from the membership
 * table and replaces `accountability.role`; without a membership the request is
 * rejected. Global admins cross every namespace without one.
 */
export function virtualNamespace(): RequestHandler {
	return asyncHandler(async (req, _res, next) => {
		const accountability = req.accountability;

		if (!accountability?.user) {
			next();
			return;
		}

		const namespace = req.virtualNamespace?.trim() || req.header(NAMESPACE_HEADER)?.trim() || getDefaultNamespace();

		if (!namespace) {
			next();
			return;
		}

		if (accountability.admin !== true) {
			// Resolved against the shared schema: this runs before the namespace
			// context is entered, so `getDatabase()` is still the default.
			const role = await resolveNamespaceRole(getDatabase(), accountability.user, namespace);

			if (!role) {
				throw new ForbiddenException();
			}

			accountability.role = role;
		}

		runWithNamespace(namespace, next);
	});
}
