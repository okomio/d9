export const NAMESPACE_CLAIM = 'namespace';

/**
 * Reads the virtual-namespace claim from an untrusted token payload.
 */
export function readNamespaceClaim(payload: unknown): string | undefined {
	if (!payload || typeof payload !== 'object') return undefined;

	const value = (payload as Record<string, unknown>)[NAMESPACE_CLAIM];

	return typeof value === 'string' && value.length > 0 ? value : undefined;
}
