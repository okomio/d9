import { describe, expect, test } from 'vitest';
import { pickNamespace } from './resolve.js';

describe('pickNamespace', () => {
	test('prefers the token claim over the header and the default', () => {
		expect(pickNamespace({ claimed: 'ns_a', header: 'ns_b', fallback: 'main' })).toBe('ns_a');
	});

	test('falls back to the header, then to the default', () => {
		expect(pickNamespace({ header: 'ns_b', fallback: 'main' })).toBe('ns_b');
		expect(pickNamespace({ fallback: 'main' })).toBe('main');
	});

	test('ignores blank values', () => {
		expect(pickNamespace({ claimed: '   ', header: '', fallback: 'main' })).toBe('main');
	});

	test('returns nothing when no candidate is present', () => {
		expect(pickNamespace({})).toBeUndefined();
	});

	test('trims candidates', () => {
		expect(pickNamespace({ claimed: ' ns_a ' })).toBe('ns_a');
	});
});
