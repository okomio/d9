import { describe, expect, it, vi } from 'vitest';
import {
	destinationAfterLogin,
	internalDestination,
	loginRedirect,
	navigationKey,
	requestedNamespace,
	savedDestination,
	withNamespace,
} from './url';
import { createNamespaceNavigation } from './navigation';

describe('namespace URL identity and redirect safety', () => {
	it('preserves deep link/query/hash through login and namespace canonicalization', () => {
		const destination = '/content/articles/42?filter=mine&ns=tracking#details';

		expect(
			destinationAfterLogin(new URL(loginRedirect(destination), 'https://test').searchParams.get('redirect'))
		).toBe(destination);

		expect(withNamespace('/content/articles?filter=mine#details', 'aaa')).toBe(
			'/content/articles?filter=mine&ns=aaa#details'
		);

		expect(requestedNamespace(destination)).toBe('tracking');
	});

	it.each([
		'https://evil.test',
		'//evil.test',
		'/%2fevil.test',
		'/%5cevil.test',
		'/\\evil.test',
		'/content?access_token=secret',
		'/bad%xx',
		'/bad\npath',
	])('rejects unsafe destination %s', (destination) => {
		expect(() => internalDestination(destination)).toThrow();
	});

	it.each(['/content?ns=', '/content?ns=a&ns=b', '/content?ns=a/b'])(
		'rejects invalid explicit identity instead of silently choosing default %s',
		(destination) => {
			expect(() => requestedNamespace(destination)).toThrow();
		}
	);

	it('uses distinct user/namespace saved state, ignoring legacy and mismatched identity', () => {
		const map = new Map([
			['last-collection', '/content/old'],
			[navigationKey('user', 'tracking'), '/content/articles?ns=aaa'],
		]);

		expect(savedDestination({ getItem: (key) => map.get(key) ?? null }, 'user', 'tracking')).toBeNull();
		expect(navigationKey('u', 'a')).not.toBe(navigationKey('u', 'b'));
	});

	it('permits only the exact internal transaction location once', async () => {
		const navigation = createNamespaceNavigation({
			replace: async (destination) => {
				expect(navigation.consumePermit('/content?ns=aaa')).toBe(false);
				expect(navigation.consumePermit(destination)).toBe(true);
				expect(navigation.consumePermit(destination)).toBe(false);
			},
		});

		await navigation.commit({ namespaceId: 'aaa', source: 'picker' });
		await navigation.finish('/namespace');
	});

	it('lets the router guard own browser history during a namespace switch', async () => {
		const replace = vi.fn(async () => {});
		const push = vi.fn(async () => {});
		const navigation = createNamespaceNavigation({ replace, push });

		await navigation.commit({ namespaceId: 'aaa', source: 'history', destination: '/content?ns=aaa' });
		await navigation.finish('/content?ns=aaa');

		expect(replace).not.toHaveBeenCalled();
		expect(push).not.toHaveBeenCalled();
	});

	it('loads the validated target URL after the loading route has replaced the source view', async () => {
		const push = vi.fn(async () => {});
		const pageReload = vi.fn();
		const navigation = createNamespaceNavigation({ replace: async () => {}, push, pageReload });

		await navigation.commit({ namespaceId: 'aaa', source: 'picker', destination: '/content' });
		await navigation.reload?.('/content');

		expect(push).toHaveBeenCalledWith('/namespace/loading?next=%2Fcontent&ns=aaa');
		expect(pageReload).toHaveBeenCalledWith('/content?ns=aaa');
	});
});
