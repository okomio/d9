import { getAssetUrl } from '@/utils/get-asset-url';
import { cryptoStub } from '@/__utils__/crypto';
import { expect, test, vi } from 'vitest';
import { getPublicURL } from '@/utils/get-root-path';
import { URL } from 'node:url';
import { getNamespaceRuntime } from '@/namespaces/live';

vi.stubGlobal('crypto', cryptoStub);
vi.mock('@/utils/get-root-path');
vi.mock('@/namespaces/live', () => ({ getNamespaceRuntime: vi.fn(() => null) }));

Object.defineProperty(window, 'URL', {
	value: URL,
});

test('Get asset url', () => {
	vi.mocked(getPublicURL).mockReturnValueOnce('https://directus.io/');
	const output = getAssetUrl('test.jpg');
	expect(output).toBe(`https://directus.io/assets/test.jpg`);
});

test('Get asset url for download', () => {
	vi.mocked(getPublicURL).mockReturnValueOnce('https://directus.io/');
	const output = getAssetUrl('test.jpg', true);
	expect(output).toBe(`https://directus.io/assets/test.jpg?download=`);
});

test('Subdirectory Install: Get asset url', () => {
	vi.mocked(getPublicURL).mockReturnValueOnce('https://directus.io/subdirectory/');
	const output = getAssetUrl('test.jpg');
	expect(output).toBe(`https://directus.io/subdirectory/assets/test.jpg`);
});

test('Subdirectory Install: Get asset url for download', () => {
	vi.mocked(getPublicURL).mockReturnValueOnce('https://directus.io/subdirectory/');
	const output = getAssetUrl('test.jpg', true);
	expect(output).toBe(`https://directus.io/subdirectory/assets/test.jpg?download=`);
});

test('Browser download uses the current tab token when a namespace is active', () => {
	vi.mocked(getPublicURL).mockReturnValue('https://directus.io/subdirectory/');
	vi.mocked(getNamespaceRuntime).mockReturnValueOnce({
		state: { active: {} },
		auth: { token: () => 'child-token' },
	} as ReturnType<typeof getNamespaceRuntime>);
	expect(getAssetUrl('child-file', true)).toBe(
		'https://directus.io/subdirectory/assets/child-file?download=&access_token=child-token'
	);
});
