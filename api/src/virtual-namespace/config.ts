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
