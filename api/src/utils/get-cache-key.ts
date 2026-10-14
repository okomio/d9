import type { Request } from 'express';
import hash from 'object-hash';
import url from 'url';
import { getActiveNamespace } from '../virtual-namespace/context.js';
import { getGraphqlQueryAndVariables } from './get-graphql-query-and-variables.js';
import { version } from './package.js';

export function getCacheKey(req: Request): string {
	const path = url.parse(req.originalUrl).pathname;
	const isGraphQl = path?.startsWith('/graphql');

	const info = {
		version,
		user: req.accountability?.user || null,
		// The same request in two namespaces is not the same response.
		namespace: getActiveNamespace() ?? null,
		path,
		query: isGraphQl ? getGraphqlQueryAndVariables(req) : req.sanitizedQuery,
	};

	const key = hash(info);
	return key;
}
