import { NamespaceError } from './adapter';

const unsafeCharacters = (value: string) => [...value].some((char) => char === '\\' || char.charCodeAt(0) <= 32);

/** D13 frontend choice: stable namespace ID in ?ns=; API/deployment paths unchanged. */
export function internalDestination(value: string): string {
	if (!value.startsWith('/') || value.startsWith('//') || unsafeCharacters(value))
		throw new NamespaceError('contract', 'Invalid internal destination');
	let decoded: string;

	try {
		decoded = decodeURIComponent(value);
	} catch {
		throw new NamespaceError('contract', 'Malformed destination encoding');
	}

	if (decoded.startsWith('//') || unsafeCharacters(decoded))
		throw new NamespaceError('contract', 'Unsafe destination encoding');
	const url = new URL(value, 'https://admin.invalid');
	if (url.origin !== 'https://admin.invalid' || url.searchParams.has('access_token') || url.searchParams.has('token'))
		throw new NamespaceError('contract', 'Invalid admin destination');
	return url.pathname + url.search + url.hash;
}
export function requestedNamespace(destination: string): string | null {
	const url = new URL(internalDestination(destination), 'https://admin.invalid');
	const ids = url.searchParams.getAll('ns');
	if (!ids.length) return null;
	if (ids.length !== 1 || !/^[a-zA-Z0-9_-]{1,128}$/.test(ids[0]!))
		throw new NamespaceError('contract', 'Invalid namespace identity');
	return ids[0]!;
}
export function withNamespace(destination: string, namespaceId: string): string {
	if (!/^[a-zA-Z0-9_-]{1,128}$/.test(namespaceId)) throw new NamespaceError('contract', 'Invalid namespace identity');
	const url = new URL(internalDestination(destination), 'https://admin.invalid');
	url.searchParams.set('ns', namespaceId);
	return url.pathname + url.search + url.hash;
}
export function loginRedirect(destination: string): string {
	return '/login?redirect=' + encodeURIComponent(internalDestination(destination));
}
export function destinationAfterLogin(value: unknown): string | null {
	if (typeof value !== 'string') return null;

	try {
		return internalDestination(value);
	} catch {
		return null;
	}
}
/** Per-tab saved navigation is a preference, never authorization. No legacy unscoped key. */
export function navigationKey(userId: string, namespaceId: string): string {
	return `namespace:last-page:${encodeURIComponent(userId)}:${encodeURIComponent(namespaceId)}`;
}
export function collectionKey(userId: string, namespaceId: string): string {
	return `namespace:last-collection:${encodeURIComponent(userId)}:${encodeURIComponent(namespaceId)}`;
}
export function savedDestination(
	storage: Pick<Storage, 'getItem'>,
	userId: string,
	namespaceId: string
): string | null {
	const value = storage.getItem(navigationKey(userId, namespaceId));
	if (!value) return null;

	try {
		return requestedNamespace(value) === namespaceId ? internalDestination(value) : null;
	} catch {
		return null;
	}
}
