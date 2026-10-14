import { Router } from 'express';
import { InvalidCredentialsException } from '../exceptions/index.js';
import { respond } from '../middleware/respond.js';
import { AuthenticationService } from '../services/authentication.js';
import asyncHandler from '../utils/async-handler.js';

const router = Router();

/**
 * Mint an access token scoped to another namespace, for the caller's own
 * session.
 *
 * `/namespaces` is a control-plane path, so this request is never itself
 * namespace-scoped: the caller's shared identity and the entry rules in
 * `canEnterNamespace` decide the outcome.
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
