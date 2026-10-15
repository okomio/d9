import { parse } from 'graphql';
import { describe, expect, test } from 'vitest';
import { isSharedGraphQLOperation } from './graphql.js';

function classify(query: string, operationName: string | null = null, path = '/graphql/system') {
	return isSharedGraphQLOperation(path, { document: parse(query), operationName });
}

describe('shared GraphQL operation routing', () => {
	test('keeps shared identity queries and personal mutations reachable', () => {
		expect(classify('{ users_me { id } server_ping }')).toBe(true);
		expect(classify('mutation { update_users_me(data: { first_name: "Name" }) { id } }')).toBe(true);
		expect(classify('mutation { auth_refresh(refresh_token: "token") { access_token } }')).toBe(true);
	});

	test('uses the selected operation rather than other operations in the document', () => {
		const query = 'query Identity { users_me { id } } query Content { collections { collection } }';
		expect(classify(query, 'Identity')).toBe(true);
		expect(classify(query, 'Content')).toBe(false);
		expect(classify(query)).toBe(false);
		expect(classify(query, 'Missing')).toBe(false);
	});

	test('expands nested root fragments and checks field names behind aliases', () => {
		expect(classify(`query { ...Identity } fragment Identity on Query { ... on Query { me: users_me { id } } }`)).toBe(
			true
		);

		expect(classify('{ users_me: collections { collection } }')).toBe(false);

		expect(
			classify(
				'query { ...Identity } fragment Identity on Query { users_me { id } ...Content } fragment Content on Query { collections { collection } }'
			)
		).toBe(false);
	});

	test('requires a namespace for mixed operations before any mutation can execute', () => {
		expect(classify('mutation { auth_logout(refresh_token: "token") create_users_item(data: {}) { id } }')).toBe(false);
		expect(classify('{ users_me { id } collections @skip(if: true) { collection } }')).toBe(false);
	});

	test('fails closed for cyclic, missing or non-shared fragments and introspection', () => {
		expect(classify('query { ...Missing }')).toBe(false);
		expect(classify('query { ...Loop } fragment Loop on Query { ...Loop }')).toBe(false);
		expect(classify('{ __schema { queryType { name } } }')).toBe(false);
		expect(classify('{ __type(name: "Query") { name } }')).toBe(false);
		expect(classify('{ server_specs_graphql }')).toBe(false);
	});

	test('does not exempt content GraphQL or lookalike paths', () => {
		expect(classify('{ users_me { id } }', null, '/graphql')).toBe(false);
		expect(classify('{ users_me { id } }', null, '/graphql/systematic')).toBe(false);
		expect(classify('{ users_me { id } }', null, '/graphql/system/')).toBe(true);
		expect(classify('{ users_me { id } }', null, '/GRAPHQL/SYSTEM')).toBe(true);
		expect(classify('{ USERS_ME { id } }', null, '/GRAPHQL/SYSTEM')).toBe(false);
		expect(isSharedGraphQLOperation('/graphql/system')).toBe(false);
	});
});
