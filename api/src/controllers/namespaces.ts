import { Router } from 'express';
import getDatabase from '../database/index.js';
import { InvalidCredentialsException } from '../exceptions/index.js';
import { respond } from '../middleware/respond.js';
import { AuthenticationService } from '../services/authentication.js';
import asyncHandler from '../utils/async-handler.js';
import { listAccessibleNamespaces } from '../virtual-namespace/access.js';

const router = Router();

/**
 * The namespaces the caller may see, with their effective access and the
 * namespace a claim-less token would resolve to.
 *
 * `/namespaces` is a control-plane path, so this request is never itself
 * namespace-scoped: `accountability` still holds the caller's shared identity,
 * which is exactly what the listing is about.
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
			admin: accountability.admin === true,
			app: accountability.app === true,
		});

		res.locals['payload'] = { data, default: defaultNamespace };

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

		const { accessToken, expires } = await authenticationService.mintNamespaceToken(req.params['namespace']!);

		res.locals['payload'] = {
			data: {
				access_token: accessToken,
				expires,
			},
		};

		return next();
	}),
	respond
);

export default router;
