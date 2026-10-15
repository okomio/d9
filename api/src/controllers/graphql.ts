import { Router } from 'express';
import { respond } from '../middleware/respond.js';
import { GraphQLService } from '../services/graphql/index.js';
import asyncHandler from '../utils/async-handler.js';

const router = Router();

router.use(
	'/system',
	asyncHandler(async (req, res, next) => {
		const service = new GraphQLService({
			accountability: req.accountability,
			schema: req.schema,
			scope: 'system',
		});

		res.locals['payload'] = await service.execute(res.locals['graphqlParams']);

		if (res.locals['payload']?.errors?.length > 0) {
			res.locals['cache'] = false;
		}

		return next();
	}),
	respond
);

router.use(
	'/',
	asyncHandler(async (req, res, next) => {
		const service = new GraphQLService({
			accountability: req.accountability,
			schema: req.schema,
			scope: 'items',
		});

		res.locals['payload'] = await service.execute(res.locals['graphqlParams']);

		if (res.locals['payload']?.errors?.length > 0) {
			res.locals['cache'] = false;
		}

		return next();
	}),
	respond
);

export default router;
