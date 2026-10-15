import type { Knex } from 'knex';
import { getDefaultNamespace, isVirtualNamespaceEnabled } from './config.js';

export type NamespaceCandidates = {
	/** Namespace claim of a server-issued access token. Authoritative. */
	claimed?: string | undefined;
	/** `X-Namespace` header. Development tooling only. */
	header?: string | undefined;
	/** The resolved owner default, or `VIRTUAL_NAMESPACES_DEFAULT`. */
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

/**
 * A legacy token belongs to an authenticated account, whose current primary
 * role determines its default namespace. Read the shared tables explicitly:
 * request accountability deliberately discards child roles, and JWT roles may
 * be stale. A selected but inaccessible default must not cause another fallback.
 */
export async function resolveLegacyDefaultNamespace(
	database: Knex,
	userId: string | null
): Promise<string | undefined> {
	if (!isVirtualNamespaceEnabled() || !userId) return undefined;

	const owner = await database
		.select('r.namespace')
		.from('public.directus_users as u')
		.leftJoin('public.directus_roles as r', 'u.role', 'r.id')
		.where('u.id', userId)
		.first();

	return pickNamespace({ claimed: owner?.namespace, fallback: getDefaultNamespace() });
}
