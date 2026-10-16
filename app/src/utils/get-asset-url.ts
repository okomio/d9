import { getPublicURL } from '@/utils/get-root-path';
import { getNamespaceRuntime } from '@/namespaces/live';

/** Browser media requests cannot set Authorization headers. Bind them to this tab's active area. */
export function withAssetToken(url: string): string {
	const runtime = getNamespaceRuntime();
	if (!runtime?.state.active) return url;
	const token = runtime.auth.token();
	if (!token) return url;
	const parsed = new URL(url, getPublicURL());
	parsed.searchParams.set('access_token', token);
	return parsed.href;
}

export function getAssetUrl(filename: string, isDownload?: boolean): string {
	const assetUrl = new URL(`assets/${filename}`, getPublicURL());

	if (isDownload) {
		assetUrl.searchParams.set('download', '');
	}

	return withAssetToken(assetUrl.href);
}
