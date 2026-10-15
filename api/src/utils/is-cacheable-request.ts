import type { Request } from 'express';
import { getOperationAST, parse } from 'graphql';
import url from 'url';

/** Classify before cache lookup: a cached mutation must never skip execution. */
export function isCacheableRequest(req: Request): boolean {
	const path = (url.parse(req.originalUrl).pathname ?? '').toLowerCase();

	// These control operations perform their membership checks in the controller.
	if (path === '/namespaces' || path.startsWith('/namespaces/')) return false;

	if (path === '/graphql' || path.startsWith('/graphql/')) {
		const input = req.method.toUpperCase() === 'GET' ? req.query : req.body;

		if (typeof input?.query !== 'string') return false;
		if (input.operationName != null && typeof input.operationName !== 'string') return false;

		try {
			const operation = getOperationAST(parse(input.query), input.operationName);
			return operation?.operation === 'query';
		} catch {
			// GraphQL supplies its normal validation error downstream.
			return false;
		}
	}

	return req.method.toUpperCase() === 'GET';
}
