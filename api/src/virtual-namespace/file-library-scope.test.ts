import { afterEach, describe, expect, test, vi } from 'vitest';
import { runWithNamespace } from './context.js';
import { limitToNamespace, stampNamespace } from './scope.js';

afterEach(() => vi.unstubAllEnvs());

describe('shared File Library owner scope', () => {
	test('combines a user filter with the active owner and stamps new rows', () => {
		vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'true');
		runWithNamespace({ id: 'tracking', schema: 'ns_tracking' }, () => {
			expect(limitToNamespace('directus_files', { filter: { title: { _contains: 'report' } } })).toEqual({
				filter: { _and: [{ title: { _contains: 'report' } }, { namespace: { _eq: 'tracking' } }] },
			});
			expect(limitToNamespace('directus_folders', {})).toEqual({ filter: { namespace: { _eq: 'tracking' } } });
			expect(stampNamespace('directus_files', { title: 'report' })).toEqual({ title: 'report', namespace: 'tracking' });
		});
	});

	test('anonymous requests stay on main while legacy mode keeps the original query', () => {
		const query = { filter: { name: { _eq: 'root' } } };
		vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'true');
		expect(limitToNamespace('directus_folders', query)).toEqual({
			filter: { _and: [query.filter, { namespace: { _eq: 'main' } }] },
		});
		vi.stubEnv('VIRTUAL_NAMESPACES_ENABLED', 'false');
		expect(limitToNamespace('directus_folders', query)).toBe(query);
	});
});
