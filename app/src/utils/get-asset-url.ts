import { getPublicURL } from '@/utils/get-root-path';
import { getNamespaceRuntime } from '@/namespaces/live';
import api from '@/api';
import { NamespaceError } from '@/namespaces/adapter';
import { unexpectedError } from '@/utils/unexpected-error';

/** VImage already uses an Authorization header. Direct browser links use a file-only grant. */
export async function getAssetGrantUrl(url: string): Promise<string> {
	const runtime = getNamespaceRuntime();
	const active = runtime?.state.active;
	if (!active) return url;
	if (runtime.state.phase !== 'ready') throw new NamespaceError('cancelled', 'Namespace is switching');

	const parsed = new URL(url, getPublicURL());
	if (parsed.origin !== new URL(getPublicURL()).origin) throw new Error('Asset URL must be local');
	const match = /\/assets\/([0-9a-f-]{36})$/i.exec(parsed.pathname);
	if (!match) throw new Error('Invalid asset URL');
	const assetPath = `/assets/${match[1]}`;

	const response = await api.post<{ data: { grant: string } }>(`${assetPath}/grant`, {
		url: assetPath + parsed.search,
	});

	if (runtime?.state.active?.namespaceId !== active.namespaceId || runtime.state.phase !== 'ready') {
		throw new NamespaceError('cancelled', 'Namespace switched while preparing asset');
	}

	parsed.searchParams.set('asset_grant', response.data.data.grant);
	return parsed.href;
}

/** Preserve Directus's download/open controls while resolving their scoped URL on click. */
export async function openAsset(
	filename: string | undefined,
	isDownload = false,
	downloadName?: string
): Promise<void> {
	if (!filename) return;
	const tab = !isDownload ? window.open('', '_blank') : null;

	try {
		const url = await getAssetGrantUrl(getAssetUrl(filename, isDownload));

		if (tab) {
			tab.opener = null;
			tab.location.replace(url);
			return;
		}

		const anchor = document.createElement('a');
		anchor.href = url;
		if (isDownload) anchor.download = downloadName ?? '';
		anchor.referrerPolicy = 'no-referrer';
		document.body.append(anchor);
		anchor.click();
		anchor.remove();
	} catch (error) {
		tab?.close();
		unexpectedError(error as Error);
	}
}

export function getAssetUrl(filename: string, isDownload?: boolean): string {
	const assetUrl = new URL(`assets/${filename}`, getPublicURL());

	if (isDownload) {
		assetUrl.searchParams.set('download', '');
	}

	return assetUrl.href;
}
