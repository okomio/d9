import { getAssetGrantUrl, getAssetUrl } from '@/utils/get-asset-url';
import { cryptoStub } from '@/__utils__/crypto';
import { expect, test, vi } from 'vitest';
import { getPublicURL } from '@/utils/get-root-path';
import { URL } from 'node:url';
import { getNamespaceRuntime } from '@/namespaces/live';
import api from '@/api';

vi.stubGlobal('crypto', cryptoStub);
vi.mock('@/utils/get-root-path');
vi.mock('@/namespaces/live', () => ({ getNamespaceRuntime: vi.fn(() => null) }));
vi.mock('@/api', () => ({ default: { post: vi.fn() } }));

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

test('Browser download URL never contains the full access token', () => {
	vi.mocked(getPublicURL).mockReturnValue('https://directus.io/subdirectory/');

	vi.mocked(getNamespaceRuntime).mockReturnValueOnce({
		state: { active: {}, phase: 'ready' },
		auth: { token: () => 'child-token' },
	} as ReturnType<typeof getNamespaceRuntime>);

	expect(getAssetUrl('child-file', true)).toBe('https://directus.io/subdirectory/assets/child-file?download=');
});

test('Browser link receives a file-only grant without exposing the bearer token', async () => {
	const file = 'a0000000-0000-4000-8000-000000000001';
	vi.mocked(getPublicURL).mockReturnValue('https://directus.io/');

	vi.mocked(getNamespaceRuntime).mockReturnValue({
		state: { active: { namespaceId: 'tracking' }, phase: 'ready' },
	} as ReturnType<typeof getNamespaceRuntime>);

	vi.mocked(api.post).mockResolvedValueOnce({ data: { data: { grant: 'file-only-grant' } } });
	const url = await getAssetGrantUrl(`https://directus.io/assets/${file}?download=`);
	expect(api.post).toHaveBeenCalledWith(`/assets/${file}/grant`, { url: `/assets/${file}?download=` });
	expect(url).toBe(`https://directus.io/assets/${file}?download=&asset_grant=file-only-grant`);
});
