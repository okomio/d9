import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { isCacheableRequest } from './is-cacheable-request.js';

function graphqlRequest(query: string, operationName?: string): Request {
	return { method: 'POST', originalUrl: '/graphql/system', body: { query, operationName } } as Request;
}

describe('response cache admission', () => {
	it('caches ordinary GETs and GraphQL queries', () => {
		expect(isCacheableRequest({ method: 'GET', originalUrl: '/users?fields=id' } as Request)).toBe(true);
		expect(isCacheableRequest(graphqlRequest('{ users { id } }'))).toBe(true);
	});

	it('never admits selected mutations, subscriptions, invalid or ambiguous GraphQL operations', () => {
		for (const query of [
			'mutation { utils_cache_clear }',
			'subscription { users { id } }',
			'query First { users { id } } query Second { users { email } }',
			'query {',
		]) {
			expect(isCacheableRequest(graphqlRequest(query))).toBe(false);
		}
	});

	it('classifies the named operation when a document contains a query and mutation', () => {
		const query = 'query Read { users { id } } mutation Write { utils_cache_clear }';
		expect(isCacheableRequest(graphqlRequest(query, 'Read'))).toBe(true);
		expect(isCacheableRequest(graphqlRequest(query, 'Write'))).toBe(false);
	});

	it.each([
		'/namespaces',
		'/namespaces/child/members',
		'/namespaces/child/members/lookup',
		'/Namespaces/child/Members',
		'/NAMESPACES/child/members/lookup',
	])('keeps control checks ahead of responses for %s', (originalUrl) =>
		expect(isCacheableRequest({ method: 'GET', originalUrl } as Request)).toBe(false)
	);

	it('does not cache REST mutations', () => {
		expect(isCacheableRequest({ method: 'PATCH', originalUrl: '/users/me' } as Request)).toBe(false);
	});
});
