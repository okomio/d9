import type { Knex } from 'knex';

/**
 * Read fresh before cache lookup. Another member's removal changes directory,
 * nested-user and count projections even when the caller's own access is intact.
 */
export async function getNamespaceMembershipFingerprint(database: Knex, namespace: string): Promise<string> {
	const row = await database
		.select(
			database.raw('md5(coalesce(jsonb_agg(jsonb_build_array(??, ??) order by ??)::text, ?)) as ??', [
				'user_id',
				'role_id',
				'user_id',
				'[]',
				'fingerprint',
			])
		)
		.from('public.directus_user_namespaces')
		.where('namespace_id', namespace)
		.first();

	return row.fingerprint;
}
