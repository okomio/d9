export const NAMESPACE_HEADER = 'x-namespace';

/**
 * Virtual namespaces are opt-in. When disabled the API behaves exactly as
 * before: a single default schema, no per-request namespace resolution.
 */
export function isVirtualNamespaceEnabled(): boolean {
	return process.env['VIRTUAL_NAMESPACES_ENABLED'] === 'true';
}

export function getDefaultNamespace(): string | undefined {
	return process.env['VIRTUAL_NAMESPACES_DEFAULT'] ?? undefined;
}

/**
 * The `X-Namespace` header exists for local debugging and tooling only.
 *
 * It is not a switch mechanism: the namespace claim of a server-issued token is
 * authoritative. Refused in production regardless of configuration so a client
 * can never choose where the server reads from.
 */
export function isNamespaceHeaderEnabled(): boolean {
	if (process.env['NODE_ENV'] === 'production') return false;

	return process.env['VIRTUAL_NAMESPACES_ALLOW_HEADER'] === 'true';
}
