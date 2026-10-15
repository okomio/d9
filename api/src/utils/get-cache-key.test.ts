import type { Request } from 'express';
import type { MockInstance } from 'vitest';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { getCacheKey } from './get-cache-key.js';
import * as getGraphqlQueryUtil from './get-graphql-query-and-variables.js';
import { runWithNamespace, setNamespaceResponseCacheFingerprint } from '../virtual-namespace/context.js';

vi.mock('./package.js', () => ({ version: '1.2.3' }));

const baseUrl = 'http://localhost';
const restUrl = `${baseUrl}/items/example`;
const graphQlUrl = `${baseUrl}/graphql`;
const accountability = { user: '00000000-0000-0000-0000-000000000000' };
const method = 'GET';

const requests = [
	{
		name: 'as unauthenticated request',
		params: { method, originalUrl: restUrl },
		key: '2b9dca62ba022e0291e37844fd69dcad8954478a',
	},
	{
		name: 'as authenticated request',
		params: { method, originalUrl: restUrl, accountability },
		key: 'ad4c170276153f1fc1826e73ea575e2c9ae4ac02',
	},
	{
		name: 'a request with a fields query',
		params: { method, originalUrl: restUrl, sanitizedQuery: { fields: ['id', 'name'] } },
		key: '5d91068f6ac145afd06ee7373ddfbf4f4d950fa6',
	},
	{
		name: 'a request with a filter query',
		params: { method, originalUrl: restUrl, sanitizedQuery: { filter: { name: { _eq: 'test' } } } },
		key: '1283c54d8b1fbde3634d06942fa4022b02704a30',
	},
	{
		name: 'a GraphQL GET query request',
		params: { method, originalUrl: graphQlUrl, query: { query: 'query { test { id } }' } },
		key: 'ce2b8c0bf02c3cb4cd98da91937f2a1c328eaf5a',
	},
	{
		name: 'a GraphQL POST query request',
		params: { method: 'POST', originalUrl: graphQlUrl, body: { query: 'query { test { name } }' } },
		key: '619402ab86a0aeb4878f09eb9afedcde79866cd3',
	},
	{
		name: 'an authenticated GraphQL GET query request',
		params: { method, originalUrl: graphQlUrl, accountability, query: { query: 'query { test { id } }' } },
		key: '78aa6b5c3a1c8768548ef5d4f3c959f57072647c',
	},
	{
		name: 'an authenticated GraphQL POST query request',
		params: { method: 'POST', originalUrl: graphQlUrl, accountability, body: { query: 'query { test { name } }' } },
		key: '6299459f227ef8f0ad2dae4047d52a2a068ccaf5',
	},
];

const cases = requests.map(({ name, params, key }) => [name, params, key]);

beforeEach(() => vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'false'));

afterEach(() => {
	vi.clearAllMocks();
	vi.unstubAllEnvs();
});

describe('get cache key', () => {
	describe('isGraphQl', () => {
		let getGraphqlQuerySpy: MockInstance;

		beforeAll(() => {
			getGraphqlQuerySpy = vi.spyOn(getGraphqlQueryUtil, 'getGraphqlQueryAndVariables');
		});

		test.each(['/items/test', '/items/graphql', '/collections/test', '/collections/graphql'])(
			'path "%s" should not be interpreted as a graphql query',
			(path) => {
				getCacheKey({ originalUrl: `${baseUrl}${path}` } as Request);
				expect(getGraphqlQuerySpy).not.toHaveBeenCalled();
			}
		);

		test.each(['/graphql', '/graphql/system'])('path "%s" should be interpreted as a graphql query', (path) => {
			getCacheKey({ originalUrl: `${baseUrl}${path}` } as Request);
			expect(getGraphqlQuerySpy).toHaveBeenCalledOnce();
		});
	});

	test.each(cases)('should create a cache key for %s', (_, params, key) => {
		expect(getCacheKey(params as unknown as Request)).toEqual(key);
	});

	test('should create a unique key for each request', () => {
		const keys = cases.map(([, params]) => getCacheKey(params as unknown as Request));
		const hasDuplicate = keys.some((key) => keys.indexOf(key) !== keys.lastIndexOf(key));

		expect(hasDuplicate).toBeFalsy();
	});

	test('should create a unique key for GraphQL requests with different variables', () => {
		const query = 'query Test ($name: String) { test (filter: { name: { _eq: $name } }) { id } }';
		const operationName = 'test';
		const variables1 = JSON.stringify({ name: 'test 1' });
		const variables2 = JSON.stringify({ name: 'test 2' });
		const req1: any = { method, originalUrl: graphQlUrl, query: { query, operationName, variables: variables1 } };
		const req2: any = { method, originalUrl: graphQlUrl, query: { query, operationName, variables: variables2 } };
		const postReq1: any = { method: 'POST', originalUrl: req1.originalUrl, body: req1.query };
		const postReq2: any = { method: 'POST', originalUrl: req2.originalUrl, body: req2.query };

		expect(getCacheKey(req1)).not.toEqual(getCacheKey(req2));
		expect(getCacheKey(postReq1)).not.toEqual(getCacheKey(postReq2));
		expect(getCacheKey(req1)).toEqual(getCacheKey(postReq1));
		expect(getCacheKey(req2)).toEqual(getCacheKey(postReq2));
	});

	test('separates named operations in the same GraphQL document', () => {
		const query = 'query First { users { id } } query Second { users { email } }';
		const first = { method: 'POST', originalUrl: graphQlUrl, body: { query, operationName: 'First' } } as Request;
		const second = { ...first, body: { query, operationName: 'Second' } } as Request;
		expect(getCacheKey(first)).not.toBe(getCacheKey(second));
	});

	test('separates GraphQL request bodies on case-insensitive transport paths', () => {
		const first = {
			method: 'POST',
			originalUrl: `${baseUrl}/GraphQL/System`,
			body: { query: '{ users { id } }' },
		} as Request;

		const second = { ...first, body: { query: '{ users { email } }' } } as Request;

		expect(getCacheKey(first)).not.toBe(getCacheKey(second));
	});

	test('retains hits for unchanged memberships and separates changed memberships and authority', () => {
		vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'true');

		const request = {
			method,
			originalUrl: restUrl,
			accountability: { ...accountability, role: 'child-role', admin: true, app: true, globalAdmin: false },
		} as Request;

		runWithNamespace({ id: 'child', schema: 'ns_child' }, () => {
			setNamespaceResponseCacheFingerprint('members-before');
			const first = getCacheKey(request);
			expect(getCacheKey(request)).toBe(first);
			setNamespaceResponseCacheFingerprint('members-after');
			expect(getCacheKey(request)).not.toBe(first);
			setNamespaceResponseCacheFingerprint('members-before');

			expect(
				getCacheKey({ ...request, accountability: { ...request.accountability!, globalAdmin: true } } as Request)
			).not.toBe(first);
		});
	});

	test('separates enabled shared identity responses after authority changes without a namespace', () => {
		vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'true');

		const request = {
			method,
			originalUrl: `${baseUrl}/users/me`,
			accountability: { ...accountability, admin: true, globalAdmin: true },
		} as Request;

		const demoted = {
			...request,
			accountability: { ...request.accountability!, admin: false, globalAdmin: false },
		} as Request;

		expect(getCacheKey(request)).not.toBe(getCacheKey(demoted));
	});
});
