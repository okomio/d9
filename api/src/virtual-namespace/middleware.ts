import type { RequestHandler } from 'express';
import { getDefaultNamespace, NAMESPACE_HEADER } from './config.js';
import { runWithNamespace } from './context.js';

/**
 * Runs the rest of the request inside a virtual-namespace context.
 *
 * Resolution order:
 *   1. the namespace claim of the access token (server-asserted);
 *   2. the `X-Namespace` header (internal tooling / debugging only);
 *   3. the configured default.
 *
 * Must be registered after `authenticate`, otherwise the claim is not available.
 */
export function virtualNamespace(): RequestHandler {
	return (req, _res, next) => {
		const claimed = req.virtualNamespace?.trim();
		const requested = req.header(NAMESPACE_HEADER)?.trim();
		const namespace = claimed || requested || getDefaultNamespace();

		if (!namespace) {
			next();
			return;
		}

		runWithNamespace(namespace, next);
	};
}
