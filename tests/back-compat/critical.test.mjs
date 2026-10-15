/* eslint-env es2022 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { collections, credentials, groups, peer, row, tokens } from './fixtures.mjs';
import { claims, error, Fixture, ok } from './harness.mjs';

const fixture = new Fixture();
before(() => fixture.start(), { timeout: 180_000 });
after(() => fixture.stop(), { timeout: 30_000 });

function projected(collection, id = 'first', namespace = 'main') {
	const { name, enabled } = row(collection, id, namespace);
	return { id, name, enabled };
}

async function login(mode, user = 'admin', extra = {}) {
	const body = ok(
		await fixture.request(mode, '/auth/login', {
			method: 'POST',
			token: null,
			body: {
				email: user === 'admin' ? credentials.email : `${user}@compat.example.com`,
				password: credentials.password,
				...extra,
			},
		})
	);

	assert.equal(typeof body.data.access_token, 'string');
	return body.data;
}

async function scoped(user = 'admin', namespace = peer.id) {
	const session = await login('legacy', user);
	return ok(
		await fixture.request('legacy', `/namespaces/${namespace}/token`, {
			method: 'POST',
			token: session.access_token,
		})
	).data.access_token;
}

function cookieHeader(response) {
	const values = new Map();

	for (const header of response.headers.getSetCookie()) {
		const cookie = header.split(';')[0];
		const separator = cookie.indexOf('=');
		const name = cookie.slice(0, separator);
		// Refresh may clear an old access cookie before setting the replacement.
		if (/Expires=Thu, 01 Jan 1970/i.test(header)) values.delete(name);
		else values.set(name, cookie);
	}

	return [...values.values()].join('; ');
}

function rankedReads(mode, group) {
	describe(`${group.rank} ${group.priority} ${group.name}`, () => {
		for (const collection of group.collections) {
			it(`${collection}: projections, filter, sort, pagination, meta and headers`, async () => {
				const response = await fixture.request(mode, `/items/${collection}`, {
					query: { fields: 'id,name,enabled', filter: { enabled: { _eq: true } }, sort: '-rank', limit: 1, meta: '*' },
				});

				assert.deepEqual(ok(response), {
					data: [projected(collection)],
					meta: { total_count: 2, filter_count: 1 },
				});

				assert.ok(response.headers.has('cache-control'));
				assert.match(response.headers.get('vary') ?? '', /Cache-Control/i);

				const page = ok(
					await fixture.request(mode, `/items/${collection}`, {
						query: { fields: 'id', sort: 'rank', limit: 1, page: 2 },
					})
				);

				assert.deepEqual(page, { data: [{ id: 'second' }] });

				const offset = ok(
					await fixture.request(mode, `/items/${collection}`, {
						query: { fields: 'id', sort: 'rank', offset: 1, limit: 1 },
					})
				);

				assert.deepEqual(offset, page);
			});

			it(`${collection}: SEARCH keys and body query replace the URL query`, async () => {
				const response = await fixture.request(mode, `/items/${collection}`, {
					method: 'SEARCH',
					query: { filter: { id: { _eq: 'second' } }, fields: 'secret' },
					body: { keys: ['first'], query: { fields: ['id', 'name', 'enabled'] } },
				});

				assert.deepEqual(ok(response), { data: [projected(collection)] });
			});

			it(`${collection}: row and field ACLs, forbidden writes and missing detail`, async () => {
				const response = await fixture.request(mode, `/items/${collection}`, {
					token: tokens.member,
					query: { fields: '*', sort: 'id' },
				});

				const { data } = ok(response);
				assert.equal(data.length, 1);
				assert.equal(data[0].id, 'first');
				assert.equal(data[0].name, projected(collection).name);
				assert.equal(data[0].secret, undefined);
				error(await fixture.request(mode, `/items/${collection}/second`, { token: tokens.member }), 403, 'FORBIDDEN');
				error(await fixture.request(mode, `/items/${collection}/missing`), 403, 'FORBIDDEN');

				error(
					await fixture.request(mode, `/items/${collection}`, {
						method: 'POST',
						token: tokens.member,
						body: { id: 'forbidden' },
					}),
					403,
					'FORBIDDEN'
				);

				assert.equal(await fixture.database(collection).where({ id: 'forbidden' }).first(), undefined);
			});
		}
	});
}

for (const mode of ['disabled', 'legacy']) {
	describe(
		`Infrastructure contracts: ${mode === 'disabled' ? 'namespaces disabled' : 'unchanged legacy defaults'}`,
		{ concurrency: false },
		() => {
			for (const group of groups.filter((entry) => entry.rank < 4)) rankedReads(mode, group);

			it('1 P0 Tracking: nested relation and deep selection retain envelopes', async () => {
				const response = await fixture.request(mode, '/items/collector_event_validation_config/first', {
					query: {
						fields: 'id,event.id,event.context.id,event.context.name',
						deep: { event: { context: { _filter: { enabled: { _eq: true } } } } },
					},
				});

				assert.deepEqual(ok(response), {
					data: { id: 'first', event: { id: 'first', context: { id: 'first', name: row('tracking_contexts').name } } },
				});
			});

			it('2 P0 Features/hooks: casing, relational configuration and JSON fields', async () => {
				assert.deepEqual(
					ok(
						await fixture.request(mode, '/items/hooks/first', {
							query: { fields: 'id,feature.id,feature.configuration' },
						})
					),
					{ data: { id: 'first', feature: { id: 'first', configuration: { namespace: 'main', version: 1 } } } }
				);

				error(await fixture.request(mode, '/items/features'), 403, 'FORBIDDEN');
			});

			it('3 P0 Advertising: related projections and deep queries', async () => {
				for (const collection of ['sponsored_listings', 'native_ad', 'banner_ad']) {
					const response = await fixture.request(mode, `/items/${collection}`, {
						query: {
							fields: 'id,feature.id,feature.name',
							filter: { enabled: { _eq: true } },
							deep: { feature: { _filter: { enabled: { _eq: true } } } },
						},
					});

					assert.deepEqual(ok(response), {
						data: [{ id: 'first', feature: { id: 'first', name: row('Features').name } }],
					});
				}
			});

			describe('4 P0 Authentication', () => {
				it('JSON login, claim-less JWT, millisecond expiry and full /users/me hydration', async () => {
					const session = await login(mode);
					assert.equal(session.expires, 900_000);
					assert.equal(typeof session.refresh_token, 'string');
					const payload = claims(session.access_token);
					assert.equal(payload.namespace, undefined);
					assert.equal(payload.id, fixture.data.users.admin);
					assert.equal(payload.exp - payload.iat, 900);

					const { data } = ok(
						await fixture.request(mode, '/users/me', {
							token: session.access_token,
							query: { fields: 'id,email,role.id,role.admin_access,role.app_access' },
						})
					);

					assert.equal(data.id, payload.id);
					assert.equal(data.email, credentials.email);
					assert.equal(data.role.admin_access, true);
					assert.equal(data.role.app_access, true);
				});

				it('JSON refresh preserves session identity, legacy context and existing access tokens', async () => {
					const original = await login(mode);

					const next = ok(
						await fixture.request(mode, '/auth/refresh', {
							method: 'POST',
							token: null,
							body: { refresh_token: original.refresh_token },
						})
					).data;

					assert.equal(next.expires, 900_000);
					assert.equal(typeof next.refresh_token, 'string');
					assert.equal(claims(next.access_token).session_id, claims(original.access_token).session_id);

					for (const token of [original.access_token, next.access_token]) {
						assert.equal(claims(token).namespace, undefined);

						assert.deepEqual(
							ok(await fixture.request(mode, '/items/tracking_events/first', { token, query: { fields: 'id' } })),
							{ data: { id: 'first' } }
						);
					}

					ok(
						await fixture.request(mode, '/auth/logout', {
							method: 'POST',
							token: null,
							body: { refresh_token: next.refresh_token },
						}),
						204
					);

					const denied = await fixture.request(mode, '/auth/refresh', {
						method: 'POST',
						token: null,
						body: { refresh_token: next.refresh_token },
					});

					error(denied, 401, 'INVALID_CREDENTIALS');
				});

				it('cookie login/refresh/logout retain cookie mode and successful empty logout', async () => {
					const response = await fixture.request(mode, '/auth/login', {
						method: 'POST',
						token: null,
						body: { ...credentials, mode: 'cookie' },
					});

					assert.equal(ok(response).data.refresh_token, undefined);
					assert.equal(response.headers.getSetCookie().length, 2);

					for (const cookie of response.headers.getSetCookie()) {
						assert.match(cookie, /HttpOnly/i);
						assert.match(cookie, /SameSite=Lax/i);
					}

					const refresh = await fixture.request(mode, '/auth/refresh', {
						method: 'POST',
						token: null,
						headers: { Cookie: cookieHeader(response) },
						body: {},
					});

					assert.equal(ok(refresh).data.expires, 900_000);
					assert.equal(refresh.body.data.refresh_token, undefined);

					const refreshedCookies = refresh.headers
						.getSetCookie()
						.filter((cookie) => !/Expires=Thu, 01 Jan 1970/i.test(cookie));

					assert.equal(refreshedCookies.length, 2);

					assert.ok(
						refreshedCookies.some((cookie) => cookie.startsWith('compat_access=') && cookie.includes('Path=/assets'))
					);

					assert.ok(
						refreshedCookies.some((cookie) => cookie.startsWith('compat_refresh=') && cookie.includes('Path=/auth'))
					);

					const logout = await fixture.request(mode, '/auth/logout', {
						method: 'POST',
						token: null,
						headers: { Cookie: cookieHeader(refresh) },
						body: {},
					});

					ok(logout, 204);
					assert.equal(logout.headers.getSetCookie().length, 2);
					assert.ok(logout.headers.getSetCookie().every((cookie) => /Expires=Thu, 01 Jan 1970/i.test(cookie)));
				});

				it('static/query tokens and case-insensitive Bearer precedence remain compatible', async () => {
					const query = { fields: 'id', access_token: tokens.member };

					assert.deepEqual(ok(await fixture.request(mode, '/users/me', { token: null, query })), {
						data: { id: fixture.data.users.member },
					});

					assert.deepEqual(
						ok(
							await fixture.request(mode, '/users/me', { query, headers: { Authorization: `bEaReR ${tokens.admin}` } })
						),
						{ data: { id: fixture.data.users.admin } }
					);

					assert.deepEqual(
						ok(await fixture.request(mode, '/users/me', { query, headers: { Authorization: 'Basic ignored' } })),
						{ data: { id: fixture.data.users.member } }
					);

					error(
						await fixture.request(mode, '/users/me', { token: 'invalid-static-token' }),
						401,
						'INVALID_CREDENTIALS'
					);
				});

				it('configured SSO discovery, authorization redirect, POST callback and invalid state', async () => {
					const providers = ok(await fixture.request(mode, '/auth', { token: null }));
					assert.ok(providers.data.some((provider) => provider.name === 'compat'));
					assert.equal(providers.disableDefault, false);
					const authorize = await fixture.request(mode, '/auth/login/compat', { token: null });
					assert.equal(authorize.status, 302);
					const location = new URL(authorize.headers.get('location'));
					assert.equal(location.origin, 'https://identity.compat.invalid');
					assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
					assert.ok(location.searchParams.get('state'));
					assert.match(cookieHeader(authorize), /oauth2\.compat=/);

					const callback = await fixture.request(mode, '/auth/login/compat/callback', {
						method: 'POST',
						token: null,
						headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
						rawBody: 'code=fixture&state=fixture-state',
					});

					assert.equal(callback.status, 303);
					assert.equal(callback.headers.get('location'), './callback?code=fixture&state=fixture-state');

					error(
						await fixture.request(mode, '/auth/login/compat/callback', {
							token: null,
							query: { code: 'fixture', state: 'forged' },
						}),
						401,
						'INVALID_CREDENTIALS'
					);
				});

				it('invalid credentials retain the documented error envelope', async () => {
					error(
						await fixture.request(mode, '/auth/login', {
							method: 'POST',
							token: null,
							body: { ...credentials, password: 'wrong' },
						}),
						401,
						'INVALID_CREDENTIALS'
					);
				});
			});

			rankedReads(
				mode,
				groups.find((entry) => entry.rank === 5)
			);

			describe('6 P1 Editor/schema/writes', () => {
				it('collections, fields, relations, permissions, roles and users hydrate with their native shapes', async () => {
					for (const path of ['/collections', '/fields', '/relations', '/permissions', '/roles', '/users']) {
						const { data } = ok(await fixture.request(mode, path));
						assert.ok(Array.isArray(data), path);
						if (path === '/collections') assert.ok(data.some((entry) => entry.collection === 'tracking_events'));
						if (path === '/fields')
							assert.ok(data.some((entry) => entry.collection === 'tracking_events' && entry.field === 'context'));
						if (path === '/relations')
							assert.ok(
								data.some(
									(entry) =>
										entry.collection === 'tracking_events' &&
										entry.field === 'context' &&
										entry.related_collection === 'tracking_contexts'
								)
							);
						if (path === '/users') assert.ok(data.some((entry) => entry.id === fixture.data.users.admin));
					}
				});

				it('Tracking single and array writes preserve 200/object/array and 204/delete contracts', async () => {
					const id = `write-${mode}`;

					try {
						assert.deepEqual(
							ok(
								await fixture.request(mode, '/items/tracking_events', {
									method: 'POST',
									query: { fields: 'id,name' },
									body: { id, name: 'created' },
								})
							),
							{ data: { id, name: 'created' } }
						);

						assert.deepEqual(
							ok(
								await fixture.request(mode, `/items/tracking_events/${id}`, {
									method: 'PATCH',
									query: { fields: 'id,name' },
									body: { name: 'updated' },
								})
							),
							{ data: { id, name: 'updated' } }
						);

						const batch = [
							{ id: `${id}-a`, name: 'array a' },
							{ id: `${id}-b`, name: 'array b' },
						];

						assert.deepEqual(
							ok(
								await fixture.request(mode, '/items/tracking_events', {
									method: 'POST',
									query: { fields: 'id,name' },
									body: batch,
								})
							),
							{ data: batch }
						);

						const updated = ok(
							await fixture.request(mode, '/items/tracking_events', {
								method: 'PATCH',
								query: { fields: 'id,name', sort: 'id' },
								body: { keys: batch.map((item) => item.id), data: { name: 'batch update' } },
							})
						);

						assert.deepEqual(
							updated.data,
							batch.map(({ id }) => ({ id, name: 'batch update' }))
						);

						const byQuery = ok(
							await fixture.request(mode, '/items/tracking_events', {
								method: 'PATCH',
								query: { fields: 'id,name', sort: 'id' },
								body: {
									query: { filter: { id: { _in: batch.map((item) => item.id) } } },
									data: { name: 'query update' },
								},
							})
						);

						assert.deepEqual(
							byQuery.data,
							batch.map(({ id }) => ({ id, name: 'query update' }))
						);

						ok(
							await fixture.request(mode, '/items/tracking_events', {
								method: 'DELETE',
								body: { keys: batch.map((item) => item.id) },
							}),
							204
						);

						ok(await fixture.request(mode, `/items/tracking_events/${id}`, { method: 'DELETE' }), 204);
					} finally {
						await fixture
							.database('tracking_events')
							.whereIn('id', [id, `${id}-a`, `${id}-b`])
							.delete();
					}
				});

				it('successful write with forbidden read-back returns empty 204 and persists exactly one record', async () => {
					const name = `write-only-${mode}`;

					try {
						ok(
							await fixture.request(mode, '/items/tracking_events', {
								method: 'POST',
								token: tokens.writer,
								body: { name },
							}),
							204
						);

						const records = await fixture.database('tracking_events').where({ name });
						assert.equal(records.length, 1, 'a 204 must not trigger a duplicate write');

						ok(
							await fixture.request(mode, `/items/tracking_events/${records[0].id}`, {
								method: 'PATCH',
								token: tokens.writer,
								body: { enabled: true },
							}),
							204
						);

						assert.equal((await fixture.database('tracking_events').where({ name }).first()).enabled, true);
					} finally {
						await fixture.database('tracking_events').where({ name }).delete();
					}
				});

				it('invalid batch selectors and query values fail before writes', async () => {
					error(
						await fixture.request(mode, '/items/tracking_events', {
							method: 'PATCH',
							body: { keys: ['first'], query: {}, data: { name: 'must-not-change' } },
						}),
						400,
						'FAILED_VALIDATION'
					);

					assert.equal(
						(await fixture.database('tracking_events').where({ id: 'first' }).first()).name,
						row('tracking_events').name
					);

					error(await fixture.request(mode, '/items/tracking_events', { query: { limit: -2 } }), 400, 'INVALID_QUERY');
				});

				it('singleton object/upsert contracts and unsupported key PATCH stay distinct', async () => {
					const path = '/items/competitor_scraper_technical_config';
					assert.equal(ok(await fixture.request(mode, path)).data.id, 'default');

					const updated = ok(
						await fixture.request(mode, path, {
							method: 'PATCH',
							query: { fields: 'id,name' },
							body: { name: `singleton-${mode}` },
						})
					);

					assert.deepEqual(updated, { data: { id: 'default', name: `singleton-${mode}` } });

					error(
						await fixture.request(mode, `${path}/default`, { method: 'PATCH', body: { name: 'unsupported' } }),
						404,
						'ROUTE_NOT_FOUND'
					);

					error(
						await fixture.request(mode, path, { method: 'POST', body: { name: 'unsupported' } }),
						404,
						'ROUTE_NOT_FOUND'
					);
				});

				it('preset create/update retain ordinary read-back semantics', async () => {
					const preset = ok(
						await fixture.request(mode, '/presets', {
							method: 'POST',
							body: { collection: 'tracking_events', layout: 'tabular', bookmark: `compat-${mode}` },
						})
					).data;

					try {
						const updated = ok(
							await fixture.request(mode, `/presets/${preset.id}`, {
								method: 'PATCH',
								query: { fields: 'id,layout_query' },
								body: { layout_query: { tabular: { fields: ['id', 'name'] } } },
							})
						);

						assert.deepEqual(updated, {
							data: { id: preset.id, layout_query: { tabular: { fields: ['id', 'name'] } } },
						});
					} finally {
						ok(await fixture.request(mode, `/presets/${preset.id}`, { method: 'DELETE' }), 204);
					}
				});

				it('field aliases and grouped aggregates preserve query semantics', async () => {
					assert.deepEqual(
						ok(
							await fixture.request(mode, '/items/tracking_contexts/first', {
								query: { fields: 'id,label', alias: { label: 'name' } },
							})
						),
						{ data: { id: 'first', label: row('tracking_contexts').name } }
					);

					const grouped = ok(
						await fixture.request(mode, '/items/tracking_contexts', {
							query: { aggregate: { count: '*' }, groupBy: 'enabled' },
						})
					).data;

					assert.equal(grouped.length, 2);
					assert.deepEqual(grouped.map((entry) => String(entry.enabled)).sort(), ['false', 'true']);
					assert.ok(grouped.every((entry) => Number(entry.count) === 1));
				});

				it('aggregate and textual search preserve query semantics', async () => {
					const aggregate = ok(
						await fixture.request(mode, '/items/tracking_contexts', { query: { aggregate: { count: '*' } } })
					);

					assert.equal(Number(aggregate.data[0].count), 2);

					assert.deepEqual(
						ok(await fixture.request(mode, '/items/translation_keys', { query: { search: 'alpha', fields: 'id' } })),
						{ data: [{ id: 'first' }] }
					);
				});
			});

			describe('7 P1 GraphQL', () => {
				it('POST mutations retain object cardinality and persist their result', async () => {
					const id = `gql-${mode}`;

					try {
						const response = ok(
							await fixture.request(mode, '/graphql', {
								method: 'POST',
								body: {
									query: `mutation { create_tracking_events_item(data: {id: "${id}", name: "GraphQL created"}) { id name } }`,
								},
							})
						);

						assert.deepEqual(response, { data: { create_tracking_events_item: { id, name: 'GraphQL created' } } });
						assert.equal((await fixture.database('tracking_events').where({ id }).first()).name, 'GraphQL created');
					} finally {
						await fixture.database('tracking_events').where({ id }).delete();
					}
				});

				it('generated schemas and results enforce field and row permissions', async () => {
					assert.deepEqual(
						ok(
							await fixture.request(mode, '/graphql', {
								method: 'POST',
								token: tokens.member,
								body: { query: '{ tracking_events { id name } }' },
							})
						),
						{ data: { tracking_events: [{ id: 'first', name: row('tracking_events').name }] } }
					);

					error(
						await fixture.request(mode, '/graphql', {
							method: 'POST',
							token: tokens.member,
							body: { query: '{ tracking_events { id secret } }' },
						}),
						400,
						'GRAPHQL_VALIDATION_EXCEPTION'
					);
				});

				it('POST and GET queries return GraphQL results rather than REST list envelopes', async () => {
					const query = '{ tracking_events(filter: {id: {_eq: "first"}}) { id name context { id name } } }';

					const expected = {
						data: {
							tracking_events: [
								{
									id: 'first',
									name: row('tracking_events').name,
									context: { id: 'first', name: row('tracking_contexts').name },
								},
							],
						},
					};

					assert.deepEqual(ok(await fixture.request(mode, '/graphql', { method: 'POST', body: { query } })), expected);
					assert.deepEqual(ok(await fixture.request(mode, '/graphql', { query: { query } })), expected);
				});

				it('system scope retains permission-filtered shared user queries', async () => {
					const response = ok(
						await fixture.request(mode, '/graphql/system', {
							method: 'POST',
							body: {
								query: 'query($id: ID!) { users_by_id(id: $id) { id email } }',
								variables: { id: fixture.data.users.admin },
							},
						})
					);

					assert.deepEqual(response, {
						data: { users_by_id: { id: fixture.data.users.admin, email: credentials.email } },
					});
				});

				it('schema validation returns a REST 400 and GET mutations return 405 with Allow', async () => {
					error(
						await fixture.request(mode, '/graphql', {
							method: 'POST',
							body: { query: '{ definitely_missing_collection { id } }' },
						}),
						400,
						'GRAPHQL_VALIDATION_EXCEPTION'
					);

					const response = await fixture.request(mode, '/graphql', {
						query: { query: 'mutation { create_tracking_events_item(data: {id: "forbidden-get"}) { id } }' },
					});

					error(response, 405, 'METHOD_NOT_ALLOWED');
					assert.match(response.headers.get('allow') ?? '', /POST/);
					assert.equal(await fixture.database('tracking_events').where({ id: 'forbidden-get' }).first(), undefined);
				});

				it('execution errors can coexist with partial data at HTTP 200', async () => {
					const response = ok(
						await fixture.request(mode, '/graphql/system', {
							method: 'POST',
							body: {
								query: 'mutation { good: utils_random_string(length: 8) invalid: utils_random_string(length: 0) }',
							},
						})
					);

					assert.equal(response.data.good.length, 8);
					assert.equal(response.data.invalid, null);
					assert.ok(response.errors?.length > 0);
					assert.equal(response.errors[0].extensions.code, 'INVALID_PAYLOAD');
				});

				it('non-null domain execution errors also use HTTP 200 and expose error codes', async () => {
					const response = ok(
						await fixture.request(mode, '/graphql', {
							method: 'POST',
							body: { query: '{ tracking_events(limit: -2) { id } }' },
						})
					);

					assert.ok(response.errors?.length > 0);
					assert.equal(response.errors[0].extensions.code, 'INVALID_QUERY');
					assert.ok(response.data == null);
				});
			});

			describe('Unmeasured enabled surfaces: source contract smoke checks', () => {
				it('files, flows, shares, settings and schema retain their specialized envelopes', async () => {
					for (const path of ['/files', '/flows', '/shares', '/webhooks'])
						assert.ok(Array.isArray(ok(await fixture.request(mode, path)).data), path);
					assert.equal(typeof ok(await fixture.request(mode, '/settings')).data, 'object');
					const snapshot = ok(await fixture.request(mode, '/schema/snapshot')).data;
					assert.ok(Array.isArray(snapshot.collections));
					assert.ok(Array.isArray(snapshot.fields));
					assert.ok(Array.isArray(snapshot.relations));
				});

				it('asset bytes, Range and HEAD retain their HTTP contracts', async () => {
					const path = `/assets/${fixture.data.fileId}/compat.png`;
					const image = await fixture.request(mode, path);
					assert.equal(image.status, 200);
					assert.equal(image.bytes.length, fixture.data.fileSize);
					assert.match(image.headers.get('content-type'), /^image\/png/);
					assert.equal(image.headers.get('accept-ranges'), 'bytes');
					const range = await fixture.request(mode, path, { headers: { Range: 'bytes=0-7' } });
					assert.equal(range.status, 206);
					assert.deepEqual(range.bytes, image.bytes.subarray(0, 8));
					assert.equal(range.headers.get('content-range'), `bytes 0-7/${fixture.data.fileSize}`);
					const head = await fixture.request(mode, path, { method: 'HEAD' });
					assert.equal(head.status, 200);
					assert.equal(head.bytes.length, 0);
					assert.equal(Number(head.headers.get('content-length')), fixture.data.fileSize);
				});

				it('legacy asset GET cookie overrides explicit credentials, while HEAD does not', async () => {
					const path = `/assets/${fixture.data.fileId}`;
					const headers = { Cookie: 'compat_access=invalid-static-token' };

					error(
						await fixture.request(mode, path, { headers, query: { access_token: tokens.admin } }),
						401,
						'INVALID_CREDENTIALS'
					);

					const head = await fixture.request(mode, path, { method: 'HEAD', headers });
					assert.equal(head.status, 200);
					assert.equal(head.bytes.length, 0);
				});
			});
		}
	);
}

describe('Namespace acceptance: synthetic peer, unchanged Infrastructure context', { concurrency: false }, () => {
	it('claim-less static and legacy JWT requests retain the same data as disabled mode', async () => {
		const session = await login('legacy', 'member');
		assert.equal(claims(session.access_token).namespace, undefined);

		for (const collection of collections) {
			const options = { token: session.access_token, query: { fields: 'id,name', sort: 'id' } };

			assert.deepEqual(
				ok(await fixture.request('legacy', `/items/${collection}`, options)),
				ok(await fixture.request('disabled', `/items/${collection}`, options))
			);
		}
	});

	it('verified claim and matching header select the peer; conflict fails before a write', async () => {
		const token = await scoped();
		assert.equal(claims(token).namespace, peer.id);

		assert.deepEqual(
			ok(
				await fixture.request('legacy', '/items/tracking_events/first', {
					token,
					headers: { 'x-namespace': peer.id },
					query: { fields: 'id,name' },
				})
			),
			{ data: { id: 'first', name: row('tracking_events', 'first', peer.id).name } }
		);

		const id = randomUUID();

		error(
			await fixture.request('legacy', '/items/tracking_events', {
				token,
				method: 'POST',
				headers: { 'x-namespace': 'main' },
				body: { id },
			}),
			400,
			'INVALID_PAYLOAD'
		);

		for (const schema of ['public', peer.schema])
			assert.equal(await fixture.database.withSchema(schema).table('tracking_events').where({ id }).first(), undefined);
	});

	it('authorized header fallback works only in enabled development/tooling mode', async () => {
		for (const [mode, namespace] of [
			['disabled', 'main'],
			['legacy', peer.id],
		]) {
			assert.deepEqual(
				ok(
					await fixture.request(mode, '/items/Features/first', {
						headers: { 'x-namespace': peer.id },
						query: { fields: 'id,name' },
					})
				),
				{ data: { id: 'first', name: row('Features', 'first', namespace).name } }
			);
		}
	});

	it('unknown, unready and inaccessible explicit targets fail closed', async () => {
		for (const namespace of ['does-not-exist', 'compat_unready']) {
			error(
				await fixture.request('legacy', '/items/tracking_events', { headers: { 'x-namespace': namespace } }),
				403,
				'FORBIDDEN'
			);
		}

		error(
			await fixture.request('legacy', '/items/tracking_events', {
				token: tokens.outsider,
				headers: { 'x-namespace': peer.id },
			}),
			403,
			'FORBIDDEN'
		);

		const session = await login('legacy', 'outsider');

		error(
			await fixture.request('legacy', `/namespaces/${peer.id}/token`, { method: 'POST', token: session.access_token }),
			403,
			'FORBIDDEN'
		);
	});

	it('missing defaults keep shared identity reachable and fail closed for content', async () => {
		const session = await login('defaultless', 'unmapped');
		assert.equal(session.namespace, null);
		ok(await fixture.request('defaultless', '/users/me', { token: session.access_token }));

		assert.equal(
			ok(await fixture.request('defaultless', '/namespaces', { token: session.access_token })).default,
			null
		);

		const response = await fixture.request('defaultless', '/items/tracking_events', { token: session.access_token });

		assert.ok(
			response.status >= 400 && response.status < 500 && response.status !== 401,
			`Missing-default content must fail as a namespace error, received HTTP ${response.status}: ${response.text}`
		);
	});

	it('defaultless GraphQL resolves the selected shared operation through aliases and fragments', async () => {
		const token = (await login('defaultless', 'unmapped')).access_token;

		const query = `query Identity { ...IdentityFields } fragment IdentityFields on Query { me: users_me { id } ping: server_ping }
			query Scoped { users { id } }`;

		const response = ok(
			await fixture.request('defaultless', '/graphql/system', {
				token,
				method: 'POST',
				body: { query, operationName: 'Identity' },
			})
		);

		assert.deepEqual(response, { data: { me: { id: fixture.data.users.unmapped }, ping: 'pong' } });

		assert.deepEqual(
			ok(
				await fixture.request('defaultless', '/GraphQL/System', {
					token,
					method: 'POST',
					body: { query, operationName: 'Identity' },
				})
			),
			response
		);

		error(
			await fixture.request('defaultless', '/graphql/system', {
				token,
				method: 'POST',
				body: { query, operationName: 'Scoped' },
			}),
			403,
			'FORBIDDEN'
		);
	});

	it('defaultless shared GraphQL mutation works, while a mixed mutation fails before side effects', async () => {
		const token = (await login('defaultless', 'unmapped')).access_token;
		const id = fixture.data.users.unmapped;
		const original = await fixture.database('directus_users').where({ id }).first();

		try {
			const personal = ok(
				await fixture.request('defaultless', '/graphql/system', {
					token,
					method: 'POST',
					body: {
						query: 'mutation { update_users_me(data: { first_name: "personal-defaultless" }) { id first_name } }',
					},
				})
			);

			assert.equal(personal.data.update_users_me.first_name, 'personal-defaultless');

			error(
				await fixture.request('defaultless', '/graphql/system', {
					token,
					method: 'POST',
					body: {
						query: `mutation { update_users_me(data: { first_name: "mixed-must-not-run" }) { id } update_users_item(id: "${id}", data: { first_name: "generic-must-not-run" }) { id } }`,
					},
				}),
				403,
				'FORBIDDEN'
			);

			assert.equal((await fixture.database('directus_users').where({ id }).first()).first_name, 'personal-defaultless');
		} finally {
			await fixture.database('directus_users').where({ id }).update({ first_name: original.first_name });
		}
	});

	it('GraphQL response cache distinguishes selected operations in the same document', async () => {
		const token = await scoped();

		const query =
			'query First { tracking_events_by_id(id: "first") { id } } query Second { tracking_events_by_id(id: "second") { id } }';

		for (let round = 0; round < 2; round++) {
			for (const [operationName, id] of [
				['First', 'first'],
				['Second', 'second'],
			]) {
				const response = await fixture.request('legacy', '/graphql', {
					token,
					method: 'POST',
					body: { query, operationName },
				});

				assert.deepEqual(ok(response), { data: { tracking_events_by_id: { id } } });
				if (round > 0) assert.equal(response.headers.get('x-compat-cache'), 'HIT');
			}
		}
	});

	it('warm response/permission caches retain each namespace and local role for the same user', async () => {
		const main = (await login('legacy', 'member')).access_token;
		const child = await scoped('member');

		for (let round = 0; round < 3; round++) {
			for (const [token, namespace, canReadName] of [
				[main, 'main', true],
				[child, peer.id, false],
			]) {
				const response = await fixture.request('legacy', '/items/tracking_events', {
					token,
					query: { fields: '*', sort: 'id' },
				});

				const { data } = ok(response);
				assert.equal(data.length, 1);
				assert.equal(data[0].configuration.namespace, namespace);
				assert.equal(Object.hasOwn(data[0], 'name'), canReadName);
				assert.equal(data[0].secret, undefined);
				if (round > 0) assert.equal(response.headers.get('x-compat-cache'), 'HIT');
			}
		}
	});

	it('warm collection metadata and direct reads do not expose legacy-only tables', async () => {
		const main = (await login('legacy')).access_token;
		const child = await scoped();

		for (let round = 0; round < 2; round++) {
			for (const [token, inPeer] of [
				[main, false],
				[child, true],
			]) {
				const metadata = ok(await fixture.request('legacy', '/collections', { token })).data;

				assert.equal(
					metadata.some((entry) => entry.collection === 'compat_legacy_only'),
					!inPeer
				);
			}
		}

		error(await fixture.request('legacy', '/items/compat_legacy_only/first', { token: child }), 403, 'FORBIDDEN');
	});

	it('PostgreSQL schema overview preserves readable partitioned parent tables in both legacy modes', async () => {
		for (const mode of ['disabled', 'legacy']) {
			assert.deepEqual(ok(await fixture.request(mode, '/items/compat_partitioned', { query: { fields: 'id,name' } })), {
				data: [{ id: 1, name: 'partitioned-parent' }],
			});
		}
	});

	it('REST field metadata alternates between colliding schemas without losing peer fields', async () => {
		const main = (await login('legacy')).access_token;
		const child = await scoped();

		for (let round = 0; round < 2; round++) {
			for (const [token, inPeer] of [
				[main, false],
				[child, true],
			]) {
				const fields = ok(await fixture.request('legacy', '/fields/tracking_events', { token })).data;
				assert.equal(new Set(fields.map((field) => field.field)).size, fields.length);

				assert.equal(
					fields.some((field) => field.field === 'main_marker'),
					!inPeer
				);

				assert.equal(
					fields.some((field) => field.field === 'peer_marker'),
					inPeer,
					`REST metadata must describe ${inPeer ? 'the peer' : 'main'}, including only its own fields`
				);
			}
		}
	});

	it('REST single-field and relation metadata follow the owning table and foreign key schema', async () => {
		for (const [token, schema, marker] of [
			[(await login('legacy')).access_token, 'public', 'main_marker'],
			[await scoped(), peer.schema, 'peer_marker'],
		]) {
			const field = ok(await fixture.request('legacy', `/fields/tracking_events/${marker}`, { token })).data;
			assert.equal(field.schema.schema, schema);
			const relations = ok(await fixture.request('legacy', '/relations/tracking_events', { token })).data;
			const context = relations.find((entry) => entry.field === 'context');
			assert.equal(context.schema.table, 'tracking_events');
			assert.equal(context.schema.foreign_key_schema, schema);
			const owner = relations.find((entry) => entry.field === 'compat_owner');
			assert.equal(owner.schema.foreign_key_schema, 'public');
		}
	});

	it('generated GraphQL schemas alternate between colliding names without field leakage', async () => {
		const main = (await login('legacy')).access_token;
		const child = await scoped();

		for (let round = 0; round < 2; round++) {
			for (const [token, inPeer] of [
				[main, false],
				[child, true],
			]) {
				const response = ok(
					await fixture.request('legacy', '/graphql', {
						token,
						method: 'POST',
						body: { query: '{ __type(name: "tracking_events") { fields { name } } }' },
					})
				);

				assert.equal(
					response.data.__type.fields.some((field) => field.name === 'peer_marker'),
					inPeer,
					`GraphQL must describe ${inPeer ? 'the peer' : 'main'}, including only its own fields`
				);

				assert.equal(
					response.data.__type.fields.some((field) => field.name === 'main_marker'),
					!inPeer
				);
			}
		}
	});

	it('Global Admin enters without membership and retains authority with a lower child role', async () => {
		const user = fixture.data.users.admin;
		const child = await scoped();

		assert.equal(
			await fixture.database('directus_user_namespaces').where({ user_id: user, namespace_id: peer.id }).first(),
			undefined
		);

		ok(await fixture.request('legacy', '/items/tracking_events', { token: child, query: { fields: 'secret' } }));

		try {
			await fixture
				.database('directus_user_namespaces')
				.insert({ id: randomUUID(), user_id: user, namespace_id: peer.id, role_id: fixture.data.roles.peerReader });

			const response = ok(
				await fixture.request('legacy', '/items/tracking_events/first', { token: child, query: { fields: 'secret' } })
			);

			assert.equal(response.data.secret, `${peer.id}-private`);
		} finally {
			await fixture.database('directus_user_namespaces').where({ user_id: user, namespace_id: peer.id }).delete();
		}
	});

	it('local admin cannot write shared accounts', async () => {
		const token = await scoped('localAdmin');

		error(
			await fixture.request('legacy', `/users/${fixture.data.users.admin}`, {
				method: 'PATCH',
				token,
				body: { first_name: 'escalated' },
			}),
			403,
			'FORBIDDEN'
		);

		assert.notEqual(
			(await fixture.database('directus_users').where({ id: fixture.data.users.admin }).first()).first_name,
			'escalated'
		);
	});

	it('local admin cannot write shared accounts through GraphQL system mutations', async () => {
		const token = await scoped('localAdmin');
		const id = fixture.data.users.admin;
		const original = await fixture.database('directus_users').where({ id }).first();

		try {
			const response = await fixture.request('legacy', '/graphql/system', {
				token,
				method: 'POST',
				body: {
					query: `mutation { update_users_item(id: "${id}", data: {first_name: "gql-escalated"}) { id first_name } }`,
				},
			});

			assert.equal(
				(await fixture.database('directus_users').where({ id }).first()).first_name,
				original.first_name,
				'GraphQL must not let a child admin edit a shared user'
			);

			assert.ok(response.body?.errors?.length > 0, 'A shared-account mutation must return an authorization error');
			assert.ok(response.body.data?.update_users_item == null);
		} finally {
			await fixture.database('directus_users').where({ id }).update({ first_name: original.first_name });
		}
	});

	it('local admin cannot clear the instance response cache', async () => {
		const token = await scoped('localAdmin');
		error(await fixture.request('legacy', '/utils/cache/clear', { method: 'POST', token }), 403, 'FORBIDDEN');
	});

	it('GraphQL cache clearing requires global authority', async () => {
		const denied = ok(
			await fixture.request('legacy', '/graphql/system', {
				token: await scoped('localAdmin'),
				method: 'POST',
				body: { query: 'mutation { utils_cache_clear }' },
			})
		);

		assert.equal(denied.errors?.[0]?.extensions?.code, 'FORBIDDEN');

		const allowed = ok(
			await fixture.request('legacy', '/graphql/system', {
				token: await scoped(),
				method: 'POST',
				body: { query: 'mutation { utils_cache_clear }' },
			})
		);

		assert.equal(allowed.errors, undefined);
	});

	it('batch and nested shared-account writes cannot use local admin authority', async () => {
		const token = await scoped('localAdmin');
		const id = fixture.data.users.member;
		const original = await fixture.database('directus_users').where({ id }).first();

		try {
			error(
				await fixture.request('legacy', '/users', {
					token,
					method: 'PATCH',
					body: { keys: [id], data: { first_name: 'batch-escalated' } },
				}),
				403,
				'FORBIDDEN'
			);

			error(
				await fixture.request('legacy', '/items/tracking_events/first', {
					token,
					method: 'PATCH',
					body: { compat_owner: { id, first_name: 'nested-escalated' } },
				}),
				403,
				'FORBIDDEN'
			);

			const response = ok(
				await fixture.request('legacy', '/graphql/system', {
					token,
					method: 'POST',
					body: {
						query: `mutation { update_users_items(ids: ["${id}"], data: { first_name: "gql-batch-escalated" }) { id } }`,
					},
				})
			);

			assert.ok(response.errors?.length);
			// Generic mutation resolvers preserve their legacy GraphQL error wrapper.
			assert.equal(response.errors[0].extensions?.code, 'INTERNAL_SERVER_ERROR');
			assert.ok(response.data?.update_users_items == null);
			assert.equal((await fixture.database('directus_users').where({ id }).first()).first_name, original.first_name);
		} finally {
			await fixture.database('directus_users').where({ id }).update({ first_name: original.first_name });
		}
	});

	it('mixed GraphQL personal mutations retain shared self-service ACL without authorizing generic shared writes', async () => {
		const token = await scoped('localAdmin');
		const id = fixture.data.users.localAdmin;
		const original = await fixture.database('directus_users').where({ id }).first();
		const admin = await fixture.database('directus_users').where({ id: fixture.data.users.admin }).first();

		try {
			const response = ok(
				await fixture.request('legacy', '/graphql/system', {
					token,
					method: 'POST',
					body: {
						query: `mutation { update_users_me(data: { first_name: "allowed-personal" }) { id first_name } update_users_item(id: "${admin.id}", data: { first_name: "generic-escalated" }) { id } }`,
					},
				})
			);

			assert.deepEqual(response.data.update_users_me, { id, first_name: 'allowed-personal' });
			assert.equal(response.errors?.[0]?.extensions?.code, 'INTERNAL_SERVER_ERROR');
			assert.equal(response.data.update_users_item, null);

			assert.equal(
				(await fixture.database('directus_users').where({ id: admin.id }).first()).first_name,
				admin.first_name
			);

			const identity = ok(
				await fixture.request('legacy', '/graphql/system', {
					token,
					method: 'POST',
					body: { query: '{ users_me { id first_name } users { id } }' },
				})
			);

			assert.deepEqual(identity.data.users_me, { id, first_name: 'allowed-personal' });
			assert.equal(identity.data.users.length, 2);
		} finally {
			await fixture.database('directus_users').where({ id }).update({ first_name: original.first_name });
			await fixture.database('directus_users').where({ id: admin.id }).update({ first_name: admin.first_name });
		}
	});

	it('local admin cannot edit a role owned by main', async () => {
		const token = await scoped('localAdmin');
		const mainRole = (await fixture.database('directus_users').where({ id: fixture.data.users.admin }).first()).role;

		error(
			await fixture.request('legacy', `/roles/${mainRole}`, { method: 'PATCH', token, body: { name: 'escalated' } }),
			403,
			'FORBIDDEN'
		);

		assert.notEqual((await fixture.database('directus_roles').where({ id: mainRole }).first()).name, 'escalated');
	});

	it('local permission rows cannot grant privileges to a role owned by main', async () => {
		const token = await scoped('localAdmin');
		const role = fixture.data.roles.outsider;
		const collection = 'compat_legacy_only';
		const original = await fixture.database('directus_permissions').select('id').where({ role, collection });

		const [localPermission] = await fixture
			.database('directus_permissions')
			.insert({ role: fixture.data.roles.peerReader, collection, namespace: peer.id, action: 'read', fields: 'id' })
			.returning('id');

		try {
			error(
				await fixture.request('legacy', '/permissions', {
					token,
					method: 'POST',
					body: { role, collection, namespace: peer.id, action: 'read', fields: ['id'] },
				}),
				403,
				'FORBIDDEN'
			);

			const graphql = ok(
				await fixture.request('legacy', '/graphql/system', {
					token,
					method: 'POST',
					body: {
						query: `mutation { update_permissions_item(id: "${localPermission.id}", data: { role: { id: "${role}" } }) { id } }`,
					},
				})
			);

			assert.ok(graphql.errors?.length);
			assert.ok(graphql.data?.update_permissions_item == null);

			assert.deepEqual(
				await fixture.database('directus_permissions').select('id').where({ role, collection }),
				original
			);

			assert.equal(
				(await fixture.database('directus_permissions').where({ id: localPermission.id }).first()).role,
				fixture.data.roles.peerReader
			);
		} finally {
			await fixture.database('directus_permissions').where({ id: localPermission.id }).delete();

			await fixture
				.database('directus_permissions')
				.where({ role, collection })
				.whereNotIn(
					'id',
					original.map((entry) => entry.id)
				)
				.delete();
		}
	});

	it('namespace admin user lists contain local members rather than the global directory', async () => {
		const token = await scoped('localAdmin');
		const users = ok(await fixture.request('legacy', '/users', { token, query: { fields: 'id', sort: 'id' } })).data;
		const labels = new Map(Object.entries(fixture.data.users).map(([label, id]) => [id, label]));
		assert.deepEqual(users.map((user) => labels.get(user.id) ?? user.id).sort(), ['localAdmin', 'member']);
	});

	it('scoped user reads, SEARCH, pagination and counts share membership boundaries', async () => {
		const token = await scoped('localAdmin');
		const local = [fixture.data.users.localAdmin, fixture.data.users.member].sort();

		const page = ok(
			await fixture.request('legacy', '/users', { token, query: { fields: 'id', sort: 'id', limit: 1, meta: '*' } })
		);

		assert.deepEqual(page, { data: [{ id: local[0] }], meta: { total_count: 2, filter_count: 2 } });

		const searched = ok(
			await fixture.request('legacy', '/users', {
				token,
				method: 'SEARCH',
				body: { keys: Object.values(fixture.data.users), query: { fields: ['id'], sort: ['id'] } },
			})
		);

		assert.deepEqual(
			searched.data.map((user) => user.id),
			local
		);

		ok(await fixture.request('legacy', `/users/${local[0]}`, { token, query: { fields: 'id' } }));
		error(await fixture.request('legacy', `/users/${fixture.data.users.outsider}`, { token }), 403, 'FORBIDDEN');

		const filtered = ok(
			await fixture.request('legacy', '/users', {
				token,
				query: { fields: 'id', filter: { id: { _eq: fixture.data.users.outsider } }, meta: '*' },
			})
		);

		assert.deepEqual(filtered, { data: [], meta: { total_count: 2, filter_count: 0 } });
	});

	it('GraphQL user lists, individual reads and aggregates stay scoped', async () => {
		const token = await scoped('localAdmin');

		const response = ok(
			await fixture.request('legacy', '/graphql/system', {
				token,
				method: 'POST',
				body: {
					query: `{ users(sort: ["id"]) { id } users_aggregated { count { id } } outside: users_by_id(id: "${fixture.data.users.outsider}") { id } }`,
				},
			})
		);

		assert.deepEqual(
			response.data.users.map((user) => user.id),
			[fixture.data.users.localAdmin, fixture.data.users.member].sort()
		);

		assert.equal(Number(response.data.users_aggregated[0].count.id), 2);
		assert.equal(response.data.outside, null);
		assert.equal(response.errors, undefined);
	});

	it('expanded user relations and relational filters cannot expose nonmembers', async () => {
		const token = await scoped('localAdmin');

		const expected = [
			{ id: 'first', compat_owner: { id: fixture.data.users.member, email: 'member@compat.example.com' } },
			{ id: 'second', compat_owner: null },
		];

		assert.deepEqual(
			ok(
				await fixture.request('legacy', '/items/tracking_events', {
					token,
					query: { fields: 'id,compat_owner.id,compat_owner.email', sort: 'id' },
				})
			).data,
			expected
		);

		assert.deepEqual(
			ok(
				await fixture.request('legacy', '/graphql', {
					token,
					method: 'POST',
					body: { query: '{ tracking_events(sort: ["id"]) { id compat_owner { id email } } }' },
				})
			),
			{ data: { tracking_events: expected } }
		);

		const filtered = ok(
			await fixture.request('legacy', '/items/tracking_events', {
				token,
				query: { fields: 'id', filter: { compat_owner: { email: { _eq: 'outsider@compat.example.com' } } }, meta: '*' },
			})
		);

		assert.deepEqual(filtered, { data: [], meta: { total_count: 2, filter_count: 0 } });
	});

	it('inverse user relations and relational counts exclude nonmembers', async () => {
		const token = await scoped('localAdmin');
		const ids = [fixture.data.users.member, fixture.data.users.outsider];
		const original = await fixture.database('directus_users').select('id', 'role').whereIn('id', ids);

		try {
			await fixture.database('directus_users').whereIn('id', ids).update({ role: fixture.data.roles.peerReader });

			const response = ok(
				await fixture.request('legacy', `/roles/${fixture.data.roles.peerReader}`, {
					token,
					query: { fields: 'id,users.id,count(users)' },
				})
			);

			assert.equal(response.data.id, fixture.data.roles.peerReader);
			assert.deepEqual(response.data.users, [{ id: fixture.data.users.member }]);
			assert.equal(Number(response.data.users_count), 1);

			const graphql = ok(
				await fixture.request('legacy', '/graphql/system', {
					token,
					method: 'POST',
					body: {
						query: `{ roles_by_id(id: "${fixture.data.roles.peerReader}") { id users { id } users_func { count } } }`,
					},
				})
			);

			assert.deepEqual(graphql, {
				data: {
					roles_by_id: {
						id: fixture.data.roles.peerReader,
						users: [{ id: fixture.data.users.member }],
						users_func: { count: 1 },
					},
				},
			});

			const filtered = ok(
				await fixture.request('legacy', '/roles', {
					token,
					query: { fields: 'id', filter: { id: { _eq: fixture.data.roles.peerReader }, 'count(users)': { _eq: 2 } } },
				})
			);

			assert.deepEqual(filtered.data, []);
		} finally {
			for (const user of original)
				await fixture.database('directus_users').where({ id: user.id }).update({ role: user.role });
		}
	});

	it('membership removal invalidates warmed user lists, counts and nested results without losing cache HITs', async () => {
		const token = await scoped('localAdmin');

		const membership = await fixture
			.database('directus_user_namespaces')
			.where({ user_id: fixture.data.users.member, namespace_id: peer.id })
			.first();

		const requests = [
			['/users', { fields: 'id', sort: 'id', meta: '*' }],
			['/items/tracking_events', { fields: 'id,compat_owner.id', sort: 'id' }],
		];

		for (const [path, query] of requests) {
			ok(await fixture.request('legacy', path, { token, query }));
			const repeat = await fixture.request('legacy', path, { token, query });
			ok(repeat);
			assert.equal(repeat.headers.get('x-compat-cache'), 'HIT');
		}

		try {
			await fixture.database('directus_user_namespaces').where({ id: membership.id }).delete();
			const users = await fixture.request('legacy', requests[0][0], { token, query: requests[0][1] });
			assert.notEqual(users.headers.get('x-compat-cache'), 'HIT');

			assert.deepEqual(ok(users), {
				data: [{ id: fixture.data.users.localAdmin }],
				meta: { total_count: 1, filter_count: 1 },
			});

			const nested = ok(await fixture.request('legacy', requests[1][0], { token, query: requests[1][1] }));

			assert.deepEqual(nested.data, [
				{ id: 'first', compat_owner: null },
				{ id: 'second', compat_owner: null },
			]);
		} finally {
			await fixture.database('directus_user_namespaces').insert(membership);
		}
	});

	it('revoked namespace admins cannot reuse warmed member-list or lookup responses', async () => {
		const token = await scoped('localAdmin');

		const membership = await fixture
			.database('directus_user_namespaces')
			.where({ user_id: fixture.data.users.localAdmin, namespace_id: peer.id })
			.first();

		const paths = [`/namespaces/${peer.id}/members`, `/namespaces/${peer.id}/members/lookup`];

		for (const path of paths) {
			ok(await fixture.request('legacy', path, { token }));
			const response = await fixture.request('legacy', path, { token });
			ok(response);
			assert.notEqual(response.headers.get('x-compat-cache'), 'HIT');
		}

		try {
			await fixture.database('directus_user_namespaces').where({ id: membership.id }).delete();
			for (const path of paths) error(await fixture.request('legacy', path, { token }), 403, 'FORBIDDEN');
		} finally {
			await fixture.database('directus_user_namespaces').insert(membership);
		}
	});

	it('case-insensitive namespace control routes cannot bypass cache revocation checks', async () => {
		const token = (await login('legacy', 'localAdmin')).access_token;

		const membership = await fixture
			.database('directus_user_namespaces')
			.where({ user_id: fixture.data.users.localAdmin, namespace_id: peer.id })
			.first();

		const mainMembership = {
			id: randomUUID(),
			user_id: fixture.data.users.localAdmin,
			namespace_id: 'main',
			role_id: fixture.data.roles.outsider,
		};

		const paths = [`/Namespaces/${peer.id}/members`, `/Namespaces/${peer.id}/members/lookup`];
		const options = { token, headers: { 'x-namespace': 'main' } };

		try {
			await fixture.database('directus_user_namespaces').insert(mainMembership);

			for (const path of paths) {
				ok(await fixture.request('legacy', path, options));
				const response = await fixture.request('legacy', path, options);
				ok(response);
				assert.notEqual(response.headers.get('x-compat-cache'), 'HIT');
			}

			await fixture.database('directus_user_namespaces').where({ id: membership.id }).delete();
			for (const path of paths) error(await fixture.request('legacy', path, options), 403, 'FORBIDDEN');
		} finally {
			await fixture.database('directus_user_namespaces').where({ id: mainMembership.id }).delete();

			if (!(await fixture.database('directus_user_namespaces').where({ id: membership.id }).first())) {
				await fixture.database('directus_user_namespaces').insert(membership);
			}
		}
	});

	it('a child-owned primary admin role cannot grant platform authority through static or JWT credentials', async () => {
		const id = fixture.data.users.localAdmin;
		const original = await fixture.database('directus_users').where({ id }).first();

		try {
			await fixture.database('directus_users').where({ id }).update({ role: fixture.data.roles.localAdmin });
			const session = await login('legacy', 'localAdmin');

			error(
				await fixture.request('legacy', '/namespaces/main/token', { token: session.access_token, method: 'POST' }),
				403,
				'FORBIDDEN'
			);

			for (const token of [tokens.localAdmin, session.access_token]) {
				error(await fixture.request('legacy', '/namespaces/main/members', { token }), 403, 'FORBIDDEN');

				error(
					await fixture.request('legacy', '/utils/cache/clear', {
						token,
						method: 'POST',
						headers: { 'x-namespace': peer.id },
					}),
					403,
					'FORBIDDEN'
				);
			}
		} finally {
			await fixture.database('directus_users').where({ id }).update({ role: original.role });
		}
	});

	it('demotion from global authority cannot reuse a warmed global user directory', async () => {
		const id = fixture.data.users.admin;
		const original = await fixture.database('directus_users').where({ id }).first();
		const token = await scoped();
		const query = { fields: 'id', sort: 'id' };

		assert.deepEqual(
			ok(await fixture.request('legacy', '/users', { token, query })).data.map((user) => user.id),
			Object.values(fixture.data.users).sort()
		);

		const membership = { id: randomUUID(), user_id: id, namespace_id: peer.id, role_id: fixture.data.roles.localAdmin };

		try {
			await fixture.database('directus_user_namespaces').insert(membership);
			await fixture.database('directus_users').where({ id }).update({ role: fixture.data.roles.outsider });
			const response = await fixture.request('legacy', '/users', { token, query });
			assert.notEqual(response.headers.get('x-compat-cache'), 'HIT');

			assert.deepEqual(
				ok(response).data.map((user) => user.id),
				[id, fixture.data.users.localAdmin, fixture.data.users.member].sort()
			);
		} finally {
			await fixture.database('directus_users').where({ id }).update({ role: original.role });
			await fixture.database('directus_user_namespaces').where({ id: membership.id }).delete();
		}
	});

	it('revocation denies warmed content without ending the shared session or other namespace access', async () => {
		const token = await scoped('member');
		const options = { token, query: { fields: 'id', sort: 'id' } };
		ok(await fixture.request('legacy', '/items/tracking_events', options));

		const membership = await fixture
			.database('directus_user_namespaces')
			.where({ user_id: fixture.data.users.member, namespace_id: peer.id })
			.first();

		try {
			await fixture.database('directus_user_namespaces').where({ id: membership.id }).delete();
			error(await fixture.request('legacy', '/items/tracking_events', options), 403, 'FORBIDDEN');
			ok(await fixture.request('legacy', '/users/me', { token }));
			ok(await fixture.request('legacy', '/items/tracking_events', { token: tokens.member }));
		} finally {
			await fixture.database('directus_user_namespaces').insert(membership);
		}
	});

	it('two tabs retain their namespace across shared-session refresh and source-bound writes', async () => {
		const session = await login('legacy');

		const child = ok(
			await fixture.request('legacy', `/namespaces/${peer.id}/token`, { method: 'POST', token: session.access_token })
		).data.access_token;

		const [mainTab, childTab] = await Promise.all(
			['main', peer.id].map(
				async (namespace) =>
					ok(
						await fixture.request('legacy', '/auth/refresh', {
							method: 'POST',
							token: null,
							body: { refresh_token: session.refresh_token, namespace },
						})
					).data
			)
		);

		assert.equal(claims(mainTab.access_token).namespace, 'main');
		assert.equal(claims(childTab.access_token).namespace, peer.id);
		assert.equal(claims(mainTab.access_token).session_id, claims(childTab.access_token).session_id);
		const id = randomUUID();

		try {
			ok(
				await fixture.request('legacy', '/items/tracking_events', {
					method: 'POST',
					token: session.access_token,
					body: { id, name: 'source-bound' },
				})
			);

			await fixture.request('legacy', '/items/tracking_events/first', { token: child });

			assert.equal(
				await fixture.database.withSchema(peer.schema).table('tracking_events').where({ id }).first(),
				undefined
			);

			assert.equal((await fixture.database('tracking_events').where({ id }).first()).name, 'source-bound');

			const activity = await fixture
				.database('directus_activity')
				.where({ collection: 'tracking_events', item: id, action: 'create' })
				.first();

			assert.equal(activity.namespace, 'main');
		} finally {
			await fixture.database('tracking_events').where({ id }).delete();
		}
	});
});

describe('T6: owner defaults and tooling header fallback', { concurrency: false }, () => {
	it('static tokens and stale claim-less JWTs use each current owner default', async () => {
		const user = fixture.data.users.member;
		const original = await fixture.database('directus_users').where({ id: user }).first();
		const memberSession = await login('legacy', 'member');
		const adminSession = await login('legacy');
		assert.equal(claims(memberSession.access_token).role, original.role);

		try {
			await fixture.database('directus_users').where({ id: user }).update({ role: fixture.data.roles.peerReader });

			for (const [namespace, credentials] of [
				['main', [tokens.admin, adminSession.access_token]],
				[peer.id, [tokens.member, memberSession.access_token]],
			]) {
				for (const token of credentials) {
					assert.equal(
						ok(
							await fixture.request('legacy', '/items/tracking_events/first', {
								token,
								query: { fields: 'id,configuration' },
							})
						).data.configuration.namespace,
						namespace
					);

					assert.equal(ok(await fixture.request('legacy', '/namespaces', { token })).default, namespace);
				}
			}

			const fresh = await login('legacy', 'member');
			assert.equal(claims(fresh.access_token).namespace, undefined);
			assert.equal(fresh.namespace.id, peer.id);
			assert.equal(fresh.namespace.local_role.id, fixture.data.roles.peerReader);
			assert.equal(fresh.is_global_admin, false);

			const refreshed = ok(
				await fixture.request('legacy', '/auth/refresh', {
					method: 'POST',
					token: null,
					body: { refresh_token: fresh.refresh_token },
				})
			).data;

			assert.equal(claims(refreshed.access_token).namespace, undefined);
			assert.equal(refreshed.namespace.id, peer.id);
			assert.equal(claims(refreshed.access_token).session_id, claims(fresh.access_token).session_id);
			ok(await fixture.request('legacy', '/items/tracking_events', { token: memberSession.access_token }));

			error(
				await fixture.request('legacy', '/items/tracking_events', {
					token: refreshed.access_token,
					query: { fields: 'secret' },
				}),
				403,
				'FORBIDDEN'
			);
		} finally {
			await fixture.database('directus_users').where({ id: user }).update({ role: original.role });
		}
	});

	it('main-role access and token minting need no redundant main membership', async () => {
		const membership = await fixture
			.database('directus_user_namespaces')
			.where({ user_id: fixture.data.users.member, namespace_id: 'main' })
			.first();

		try {
			await fixture.database('directus_user_namespaces').where({ id: membership.id }).delete();
			const session = await login('legacy', 'member');
			assert.equal(session.namespace.id, 'main');

			for (const token of [tokens.member, session.access_token]) {
				ok(await fixture.request('legacy', '/items/tracking_events', { token }));
				assert.equal(ok(await fixture.request('legacy', '/namespaces', { token })).default, 'main');
			}

			const scopedMain = await scoped('member', 'main');
			ok(await fixture.request('legacy', '/items/tracking_events', { token: scopedMain }));
		} finally {
			await fixture.database('directus_user_namespaces').insert(membership);
		}
	});

	it('instance fallback is used only without an owner mapping, never an arbitrary accessible namespace', async () => {
		const membership = {
			id: randomUUID(),
			user_id: fixture.data.users.unmapped,
			namespace_id: peer.id,
			role_id: fixture.data.roles.peerReader,
		};

		try {
			await fixture.database('directus_user_namespaces').insert(membership);

			for (const mode of ['legacy', 'defaultless']) {
				const session = await login(mode, 'unmapped');
				assert.equal(session.namespace, null);
				const listing = ok(await fixture.request(mode, '/namespaces', { token: session.access_token }));
				assert.equal(listing.default, null);
				assert.ok(listing.data.some((namespace) => namespace.id === peer.id && namespace.can_enter));
				error(await fixture.request(mode, '/items/tracking_events', { token: session.access_token }), 403, 'FORBIDDEN');
				ok(await fixture.request(mode, '/users/me', { token: session.access_token }));
			}

			const session = await login('peerDefault', 'unmapped');
			assert.equal(session.namespace.id, peer.id);

			for (const token of [tokens.unmapped, session.access_token]) {
				ok(await fixture.request('peerDefault', '/items/tracking_events', { token }));
				assert.equal(ok(await fixture.request('peerDefault', '/namespaces', { token })).default, peer.id);
			}
		} finally {
			await fixture.database('directus_user_namespaces').where({ id: membership.id }).delete();
		}
	});

	it('revoked owner-default membership denies warmed content without rerouting or losing the session', async () => {
		const user = fixture.data.users.member;
		const original = await fixture.database('directus_users').where({ id: user }).first();

		const membership = await fixture
			.database('directus_user_namespaces')
			.where({ user_id: user, namespace_id: peer.id })
			.first();

		const session = await login('legacy', 'member');

		try {
			await fixture.database('directus_users').where({ id: user }).update({ role: fixture.data.roles.peerReader });

			for (const token of [tokens.member, session.access_token]) {
				ok(await fixture.request('legacy', '/items/tracking_events', { token }));
			}

			await fixture.database('directus_user_namespaces').where({ id: membership.id }).delete();

			for (const token of [tokens.member, session.access_token]) {
				error(await fixture.request('legacy', '/items/tracking_events', { token }), 403, 'FORBIDDEN');
				assert.equal(ok(await fixture.request('legacy', '/namespaces', { token })).default, null);
				ok(await fixture.request('legacy', '/users/me', { token }));
			}

			const refreshed = ok(
				await fixture.request('legacy', '/auth/refresh', {
					method: 'POST',
					token: null,
					body: { refresh_token: session.refresh_token },
				})
			).data;

			assert.equal(refreshed.namespace, null);
		} finally {
			await fixture.database('directus_user_namespaces').where({ id: membership.id }).delete();
			await fixture.database('directus_user_namespaces').insert(membership);
			await fixture.database('directus_users').where({ id: user }).update({ role: original.role });
		}
	});

	it('an unready owner default cannot fall back to main', async () => {
		const user = fixture.data.users.member;
		const original = await fixture.database('directus_users').where({ id: user }).first();

		try {
			await fixture.database('directus_users').where({ id: user }).update({ role: fixture.data.roles.peerReader });
			await fixture.database('directus_namespaces').where({ id: peer.id }).update({ readiness: 'provisioning' });
			const session = await login('legacy', 'member');
			assert.equal(session.namespace, null);
			assert.equal(ok(await fixture.request('legacy', '/namespaces', { token: session.access_token })).default, null);

			error(
				await fixture.request('legacy', '/items/tracking_events', { token: session.access_token }),
				403,
				'FORBIDDEN'
			);

			error(
				await fixture.request('legacy', `/namespaces/${peer.id}/token`, {
					method: 'POST',
					token: session.access_token,
				}),
				403,
				'FORBIDDEN'
			);
		} finally {
			await fixture.database('directus_namespaces').where({ id: peer.id }).update({ readiness: 'ready' });
			await fixture.database('directus_users').where({ id: user }).update({ role: original.role });
		}
	});

	it('authorized tooling headers override owner defaults while disabled headers are ignored', async () => {
		for (const [mode, namespace] of [
			['legacy', peer.id],
			['peerDefault', 'main'],
		]) {
			const response = ok(
				await fixture.request(mode, '/items/tracking_events/first', {
					token: tokens.member,
					headers: { 'x-namespace': peer.id },
					query: { fields: 'id,configuration' },
				})
			);

			assert.equal(response.data.configuration.namespace, namespace);
		}
	});
});
