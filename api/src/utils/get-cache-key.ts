import type { Request } from 'express';
import hash from 'object-hash';
import url from 'url';
import { getActiveNamespace, getNamespaceResponseCacheFingerprint } from '../virtual-namespace/context.js';
import { isVirtualNamespaceEnabled } from '../virtual-namespace/config.js';
import { getGraphqlQueryAndVariables } from './get-graphql-query-and-variables.js';
import { version } from './package.js';

export function getCacheKey(req: Request): string {
	const path = url.parse(req.originalUrl).pathname;
	const isGraphQl = path?.toLowerCase().startsWith('/graphql');
	const namespace = getActiveNamespace();

	const info = {
		version,
		user: req.accountability?.user || null,
		// The same request in two namespaces is not the same response.
		namespace: namespace ?? null,
		...(isVirtualNamespaceEnabled()
			? {
					access: {
						memberships: getNamespaceResponseCacheFingerprint() ?? null,
						role: req.accountability?.role ?? null,
						admin: req.accountability?.admin === true,
						app: req.accountability?.app === true,
						globalAdmin: req.accountability?.globalAdmin === true,
					},
			  }
			: {}),
		path,
		query: isGraphQl ? getGraphqlQueryAndVariables(req) : req.sanitizedQuery,
	};

	const key = hash(info);
	return key;
}
