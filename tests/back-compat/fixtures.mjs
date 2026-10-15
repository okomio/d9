/* eslint-env es2022 */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../api/package.json', import.meta.url));
const argon2 = require('argon2');

// Traffic establishes names and priority, not production fields or payloads.
export const groups = [
	{
		rank: 1,
		priority: 'P0',
		name: 'Tracking',
		collections: ['tracking_events', 'tracking_contexts', 'collector_event_validation_config'],
	},
	{ rank: 2, priority: 'P0', name: 'Features/hooks', collections: ['Features', 'hooks'] },
	{ rank: 3, priority: 'P0', name: 'Advertising', collections: ['sponsored_listings', 'native_ad', 'banner_ad'] },
	{ rank: 5, priority: 'P1', name: 'Translations', collections: ['translation_keys'] },
];
export const collections = groups.flatMap((group) => group.collections);
export const credentials = { email: 'admin@compat.example.com', password: 'Compatibility-Test-Password-42' };
export const peer = { id: 'compat_peer', schema: 'ns_compat_peer' };
export const tokens = {
	admin: 'compat-static-admin',
	member: 'compat-static-member',
	localAdmin: 'compat-static-local-admin',
	outsider: 'compat-static-outsider',
	writer: 'compat-static-write-only',
	unmapped: 'compat-static-unmapped',
};

const relationTargets = {
	tracking_events: ['context', 'tracking_contexts'],
	collector_event_validation_config: ['event', 'tracking_events'],
	hooks: ['feature', 'Features'],
	sponsored_listings: ['feature', 'Features'],
	native_ad: ['feature', 'Features'],
	banner_ad: ['feature', 'Features'],
};

export function row(collection, id = 'first', namespace = 'main') {
	const first = id === 'first';
	return {
		id,
		name: `${namespace} ${collection} ${first ? 'alpha' : 'beta'}`,
		enabled: first,
		rank: first ? 1 : 2,
		secret: `${namespace}-private`,
		configuration: { namespace, version: 1 },
		...(relationTargets[collection] ? { [relationTargets[collection][0]]: 'first' } : {}),
	};
}

export async function seed(database, storageRoot) {
	const admin = await database('directus_users').where({ email: credentials.email }).first();
	if (!admin) throw new Error('Bootstrap did not create the synthetic admin');
	await database('directus_users').where({ id: admin.id }).update({ token: tokens.admin });
	const adminRole = await database('directus_roles').where({ id: admin.role }).first();
	if (adminRole?.namespace !== 'main') throw new Error('Enabled bootstrap must create the admin role in main');

	await database('directus_collections').insert({ collection: 'compat_fixture', accountability: 'all' });

	for (const collection of [...collections, 'competitor_scraper_technical_config']) {
		await database.schema.createTable(collection, (table) => {
			table.string('id', 64).primary().defaultTo(database.raw('gen_random_uuid()::text'));
			table.string('name');
			table.boolean('enabled');
			table.integer('rank');
			table.string('secret');
			table.json('configuration');
			if (collection === 'tracking_events') table.uuid('compat_owner');
			if (relationTargets[collection]) table.string(relationTargets[collection][0], 64);
		});

		await database('directus_collections').insert({
			collection,
			group: 'compat_fixture',
			accountability: 'all',
			sort_field: 'rank',
			singleton: collection === 'competitor_scraper_technical_config',
		});

		await database('directus_fields').insert([
			{ collection, field: 'configuration', special: 'cast-json', interface: 'input-code' },
			{ collection, field: 'enabled', special: 'cast-boolean', interface: 'boolean' },
		]);
	}

	for (const [collection, [field, target]] of Object.entries(relationTargets)) {
		await database.schema.alterTable(collection, (table) => table.foreign(field).references('id').inTable(target));
		await database('directus_fields').insert({ collection, field, special: 'm2o', interface: 'select-dropdown-m2o' });

		await database('directus_relations').insert({
			many_collection: collection,
			many_field: field,
			one_collection: target,
		});
	}

	await database.schema.alterTable('tracking_events', (table) => {
		table.foreign('compat_owner').references('id').inTable('directus_users');
	});

	await database('directus_fields').insert({
		collection: 'tracking_events',
		field: 'compat_owner',
		special: 'm2o',
		interface: 'select-dropdown-m2o',
	});

	await database('directus_relations').insert({
		many_collection: 'tracking_events',
		many_field: 'compat_owner',
		one_collection: 'directus_users',
	});

	await database('directus_namespaces').insert([
		{ id: peer.id, name: 'Synthetic peer', schema_name: peer.schema, kind: 'virtual', readiness: 'provisioning' },
		{
			id: 'compat_unready',
			name: 'Unready fixture',
			schema_name: 'ns_compat_unready',
			kind: 'virtual',
			readiness: 'provisioning',
		},
	]);

	const { provisionNamespace } = await import('../../api/dist/virtual-namespace/provision.js');
	await provisionNamespace(database, { id: peer.id, name: 'Synthetic peer', area: 'compat_fixture' });

	// A deliberately different peer schema catches schema/GraphQL cache leakage.
	await database.schema.withSchema(peer.schema).alterTable('tracking_events', (table) => table.string('peer_marker'));
	await database.schema.alterTable('tracking_events', (table) => table.string('main_marker'));

	await database.raw('alter table ??.?? add foreign key (??) references ??.?? (??)', [
		peer.schema,
		'tracking_events',
		'context',
		peer.schema,
		'tracking_contexts',
		'id',
	]);

	await database.raw('alter table ??.?? add foreign key (??) references ??.?? (??)', [
		peer.schema,
		'tracking_events',
		'compat_owner',
		'public',
		'directus_users',
		'id',
	]);

	for (const [schema, namespace] of [
		['public', 'main'],
		[peer.schema, peer.id],
	]) {
		// Insert referenced records before records carrying foreign keys.
		for (const collection of [
			'tracking_contexts',
			'Features',
			'tracking_events',
			...collections.filter((name) => !['tracking_contexts', 'Features', 'tracking_events'].includes(name)),
		]) {
			await database
				.withSchema(schema)
				.table(collection)
				.insert(
					['first', 'second'].map((id) => {
						const data = row(collection, id, namespace);
						if (schema === peer.schema && collection === 'tracking_events') data.peer_marker = 'peer-only-field';
						return data;
					})
				);
		}

		await database
			.withSchema(schema)
			.table('competitor_scraper_technical_config')
			.insert({
				...row('competitor_scraper_technical_config'),
				id: 'default',
			});
	}

	// This table is intentionally absent in the peer: public search_path fallback must not expose it.
	await database.schema.createTable('compat_legacy_only', (table) => {
		table.string('id').primary();
		table.string('name');
	});

	await database('compat_legacy_only').insert({ id: 'first', name: 'legacy-only-secret' });
	await database('directus_collections').insert({ collection: 'compat_legacy_only', accountability: 'all' });

	await database.raw('create table ?? (id integer primary key, name text) partition by range (id)', [
		'compat_partitioned',
	]);

	await database.raw('create table ?? partition of ?? for values from (0) to (100)', [
		'compat_partitioned_p0',
		'compat_partitioned',
	]);

	await database('compat_partitioned').insert({ id: 1, name: 'partitioned-parent' });

	await database('directus_collections').insert({
		collection: 'compat_partitioned',
		accountability: 'all',
		group: 'compat_fixture',
	});

	const roles = {};

	for (const [key, namespace, adminAccess] of [
		['member', 'main', false],
		['peerReader', peer.id, false],
		['localAdmin', peer.id, true],
		['outsider', 'main', false],
		['writer', 'main', false],
	]) {
		roles[key] = randomUUID();

		await database('directus_roles').insert({
			id: roles[key],
			name: `Compatibility ${key}`,
			namespace,
			admin_access: adminAccess,
			app_access: true,
		});
	}

	const users = { admin: admin.id };
	const password = await argon2.hash(credentials.password);

	for (const key of ['member', 'localAdmin', 'outsider', 'writer', 'unmapped']) {
		users[key] = randomUUID();

		await database('directus_users').insert({
			id: users[key],
			email: `${key}@compat.example.com`,
			password,
			token: tokens[key],
			role: key === 'localAdmin' ? roles.outsider : roles[key] ?? null,
			status: 'active',
			provider: 'default',
		});
	}

	for (const [user, namespace, role] of [
		['member', 'main', 'member'],
		['member', peer.id, 'peerReader'],
		['localAdmin', peer.id, 'localAdmin'],
		['writer', 'main', 'writer'],
		['outsider', 'main', 'outsider'],
	]) {
		await database('directus_user_namespaces').insert({
			id: randomUUID(),
			user_id: users[user],
			namespace_id: namespace,
			role_id: roles[role],
		});
	}

	for (const schema of ['public', peer.schema]) {
		for (const [id, user] of [
			['first', 'member'],
			['second', 'outsider'],
		]) {
			await database.withSchema(schema).table('tracking_events').where({ id }).update({ compat_owner: users[user] });
		}
	}

	const permissions = [];

	for (const [key, namespace] of [
		['member', 'main'],
		['peerReader', peer.id],
	]) {
		for (const collection of collections) {
			const fields = [
				'id',
				'enabled',
				'rank',
				'configuration',
				...(key === 'member' ? ['name'] : []),
				...(relationTargets[collection] ? [relationTargets[collection][0]] : []),
			];

			permissions.push({
				role: roles[key],
				namespace,
				collection,
				action: 'read',
				fields: fields.join(','),
				permissions: JSON.stringify({ enabled: { _eq: true } }),
			});
		}

		permissions.push({
			role: roles[key],
			namespace,
			collection: 'directus_users',
			action: 'read',
			fields: 'id,email,role',
			permissions: JSON.stringify({ id: { _eq: '$CURRENT_USER' } }),
		});
	}

	for (const action of ['create', 'update', 'delete']) {
		permissions.push({
			role: roles.writer,
			namespace: 'main',
			collection: 'tracking_events',
			action,
			fields: '*',
			permissions: '{}',
		});
	}

	// A narrow shared self-service grant must survive entry into a child admin context.
	for (const action of ['read', 'update']) {
		permissions.push({
			role: roles.outsider,
			namespace: 'main',
			collection: 'directus_users',
			action,
			fields: 'id,first_name',
			permissions: JSON.stringify({ id: { _eq: '$CURRENT_USER' } }),
		});
	}

	// Defaultless accounts can use shared self-service without a content role.
	// Anonymous callers still match no user because $CURRENT_USER is null.
	for (const action of ['read', 'update']) {
		permissions.push({
			role: null,
			namespace: 'main',
			collection: 'directus_users',
			action,
			fields: 'id,first_name',
			permissions: JSON.stringify({ id: { _eq: '$CURRENT_USER' } }),
		});
	}

	await database('directus_permissions').insert(permissions);

	const fileId = randomUUID();
	const { copyFile, stat } = await import('node:fs/promises');
	const image = new URL('../blackbox/assets/directus.png', import.meta.url);
	await copyFile(image, `${storageRoot}/compat.png`);
	const file = await stat(image);

	await database('directus_files').insert({
		id: fileId,
		storage: 'local',
		filename_disk: 'compat.png',
		filename_download: 'compat.png',
		type: 'image/png',
		filesize: file.size,
		title: 'Compatibility image',
	});

	return { users, roles, fileId, fileSize: file.size };
}
