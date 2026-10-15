import { hydrateNamespaceSnapshot } from './hydration';
import { NamespaceError, type NamespaceAdapter } from './adapter';
import type {
	AuthorizedNamespaceChoice,
	EffectiveLocalAccess,
	NamespaceIdentity,
	PlatformCapabilities,
	SessionContext,
	TokenGrant,
} from './types';

const platform = (admin: boolean): PlatformCapabilities => ({
	isGlobalAdmin: admin,
	canManageNamespaces: admin,
	canManageSharedUsers: admin,
	canManageSharedSettings: admin,
});

const access = (role: string | null, admin = false): EffectiveLocalAccess => ({
	localRole: role ? { id: role, name: role } : null,
	source: role ? 'membership' : 'inherited',
	canUseApp: true,
	isNamespaceAdmin: admin,
	canManageMembers: admin,
	canManageSchema: admin,
	canManageFlows: admin,
	requiresTfa: false,
});

const namespaces: NamespaceIdentity[] = [
	{ id: 'main', name: 'Main', kind: 'main', readiness: 'ready' },
	{ id: 'tracking', name: 'Tracking', kind: 'virtual', readiness: 'ready' },
	{ id: 'aaa', name: 'AAA', kind: 'virtual', readiness: 'ready' },
	{ id: 'pending', name: 'Provisioning', kind: 'virtual', readiness: 'provisioning' },
	{ id: 'failed', name: 'Failed', kind: 'virtual', readiness: 'failed' },
];

export type MockPersona = 'global-admin' | 'local-admin' | 'multi-role';
export interface MockFixture {
	session: SessionContext;
	choices: readonly AuthorizedNamespaceChoice[];
}
/** Independent deterministic sessions, including inherited access with no child membership. */
export const namespaceFixtures: Record<MockPersona, MockFixture> = {
	'global-admin': {
		session: { user: { id: 'global', name: 'Global Admin' }, platform: platform(true), defaultNamespaceId: 'main' },
		choices: namespaces.map((namespace) => ({
			namespace,
			access: access(namespace.id === 'main' ? 'main-admin' : null, true),
		})),
	},
	'local-admin': {
		session: { user: { id: 'local', name: 'Local Admin' }, platform: platform(false), defaultNamespaceId: 'tracking' },
		choices: [{ namespace: namespaces[1]!, access: access('tracking-admin', true) }],
	},
	'multi-role': {
		session: {
			user: { id: 'member', name: 'Multi-role Member' },
			platform: platform(false),
			defaultNamespaceId: 'tracking',
		},
		choices: [
			{ namespace: namespaces[1]!, access: access('tracking-editor') },
			{ namespace: namespaces[2]!, access: access('aaa-reader') },
		],
	},
};
export function createMockNamespaceAdapter(persona: MockPersona = 'global-admin'): NamespaceAdapter {
	const fixture = structuredClone(namespaceFixtures[persona]);
	let sequence = 0;

	const check = (signal?: AbortSignal) => {
		if (signal?.aborted) throw new NamespaceError('cancelled', 'Context cancelled');
	};

	const grant = (id: string, signal?: AbortSignal): TokenGrant => {
		check(signal);
		const choice = fixture.choices.find((choice: AuthorizedNamespaceChoice) => choice.namespace.id === id);
		if (!choice) throw new NamespaceError('namespace-denied', 'No local access');
		if (choice.namespace.readiness !== 'ready') throw new NamespaceError('namespace-denied', 'Namespace is not ready');
		return structuredClone({
			...choice,
			platform: fixture.session.platform,
			accessToken: `mock-only:${persona}:${id}:${++sequence}`,
			expiresInMs: 60_000,
		});
	};

	return {
		mode: 'mock',
		async readSessionContext(signal) {
			check(signal);
			return structuredClone(fixture.session);
		},
		async listAvailable(signal) {
			check(signal);
			return structuredClone(fixture.choices);
		},
		async mintTargetToken(id, signal) {
			return grant(id, signal);
		},
		async refreshForNamespace(context, signal) {
			return grant(context.namespaceId, signal);
		},
		async hydrate(context, token, signal) {
			check(signal);
			if (!token.startsWith(`mock-only:${persona}:${context.namespaceId}:`))
				throw new NamespaceError('contract', 'Wrong mock token context');
			return hydrateNamespaceSnapshot(context, token, signal, {
				collections: async (_context, _token, readSignal) => {
					check(readSignal);
					return [{ collection: 'articles', name: `${context.namespaceId} articles` }];
				},
				permissions: async (_context, _token, readSignal) => {
					check(readSignal);
					return [
						{
							collection: 'articles',
							action: 'read',
							fields: ['*'],
							filter: persona === 'multi-role' ? { owner: fixture.session.user.id } : {},
						},
					];
				},
			});
		},
		validateDestination(destination, snapshot) {
			const path = destination.split('?')[0]!;

			if (path.startsWith('/content/')) {
				const collection = path.split('/')[2];
				if (!snapshot.collections.some((item) => item.collection === collection)) return '/namespace';
			}

			// Mock host has no legacy CMS modules; backend module integration remains gated.
			return '/namespace';
		},
	};
}
