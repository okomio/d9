export type NamespaceCandidates = {
	/** Namespace claim of a server-issued access token. Authoritative. */
	claimed?: string | undefined;
	/** `X-Namespace` header. Development tooling only. */
	header?: string | undefined;
	/** `VIRTUAL_NAMESPACES_DEFAULT`. */
	fallback?: string | undefined;
};

function normalize(value?: string): string | undefined {
	const trimmed = value?.trim();

	return trimmed ? trimmed : undefined;
}

/**
 * Picks the namespace for a request: token claim, then header, then default.
 *
 * A claim comes from a server-issued token and always wins, so a client-supplied
 * header can never override the namespace a token was minted for.
 */
export function pickNamespace({ claimed, header, fallback }: NamespaceCandidates): string | undefined {
	return normalize(claimed) ?? normalize(header) ?? normalize(fallback);
}
