import axios from 'axios';
import { getToken } from '@/api';
import { hydrate } from '@/hydrate';
import { useCollectionsStore } from '@/stores/collections';
import { usePermissionsStore } from '@/stores/permissions';
import { getRootPath } from '@/utils/get-root-path';
import { router } from '@/router';
import { NamespaceError, type NamespaceAdapter } from './adapter';
import { internalDestination } from './url';
import type { AuthorizedNamespaceChoice, ContextStamp, NamespaceSnapshot, TokenGrant } from './types';

type WireNamespace = {
	id: string;
	name: string;
	kind: 'main' | 'virtual';
	readiness: 'ready' | 'provisioning' | 'failed';
	local_role: { id: string; name: string; admin_access: boolean; app_access: boolean } | null;
	inherited_admin: boolean;
	can_enter: boolean;
	can_use_app: boolean;
};
type WireContext = { is_global_admin: boolean; namespace: WireNamespace | null };
type WireGrant = WireContext & { access_token: string; expires: number };

const control = axios.create({ baseURL: getRootPath(), withCredentials: true });

function bearer() {
	const token = getToken();
	if (!token) throw new NamespaceError('session-expired', 'No access token');
	return { Authorization: `Bearer ${token}` };
}

function platform(globalAdmin: boolean) {
	return {
		isGlobalAdmin: globalAdmin,
		canManageNamespaces: globalAdmin,
		canManageSharedUsers: globalAdmin,
		canManageSharedSettings: globalAdmin,
	};
}

function choice(row: WireNamespace): AuthorizedNamespaceChoice {
	const admin = row.inherited_admin || row.local_role?.admin_access === true;
	return {
		namespace: { id: row.id, name: row.name, kind: row.kind, readiness: row.readiness },
		access: {
			localRole: row.local_role
				? {
						id: row.local_role.id,
						name: row.local_role.name,
						adminAccess: row.local_role.admin_access,
						appAccess: row.local_role.app_access,
				  }
				: null,
			source: row.inherited_admin && !row.local_role ? 'inherited' : 'membership',
			// The server reports effective app access, including inherited Global Admin authority.
			canUseApp: row.can_use_app,
			isNamespaceAdmin: admin,
			canManageMembers: admin,
			canManageSchema: admin,
			canManageFlows: admin,
			requiresTfa: null,
		},
	};
}

function grant(value: WireGrant, target: string): TokenGrant {
	if (!value.namespace || value.namespace.id !== target || !value.namespace.can_enter)
		throw new NamespaceError('namespace-denied', 'Target namespace is not enterable');
	return {
		...choice(value.namespace),
		platform: platform(value.is_global_admin),
		accessToken: value.access_token,
		expiresInMs: value.expires,
	};
}

function controlError(error: unknown, mint = false): never {
	const response = (
		error as { response?: { status?: number; data?: { errors?: { extensions?: { code?: string } }[] } } }
	).response;

	const code = response?.data?.errors?.[0]?.extensions?.code;
	if (response?.status === 403 && code === 'FORBIDDEN')
		throw new NamespaceError('namespace-denied', 'Namespace access denied');
	if (
		(response?.status === 401 || response?.status === 403) &&
		(code === 'INVALID_CREDENTIALS' || code === 'INVALID_TOKEN')
	)
		throw new NamespaceError(mint ? 'invalid-token' : 'session-expired', 'Authentication token expired');
	if (mint && !response) throw new NamespaceError('ambiguous', 'Target token response was not received');
	throw error;
}

async function loadListing(signal?: AbortSignal) {
	const response = await control.get<{ data: WireNamespace[]; default: string | null }>('/namespaces', {
		headers: bearer(),
		signal,
	});

	return response.data;
}

export const backendNamespaceAdapter: NamespaceAdapter = {
	mode: 'backend',
	async readSessionContext(signal) {
		const [namespaces, user] = await Promise.all([
			loadListing(signal),
			control.get<{ data: { id: string; first_name?: string; last_name?: string; role?: { admin_access?: boolean } } }>(
				'/users/me',
				{ params: { fields: ['id', 'first_name', 'last_name', 'role.admin_access'] }, headers: bearer(), signal }
			),
		]);

		if (!user.data.data?.id) throw new NamespaceError('contract', 'Missing shared user identity');

		const globalAdmin =
			user.data.data.role?.admin_access === true || namespaces.data.some((row) => row.inherited_admin);

		return {
			user: {
				id: user.data.data.id,
				name: [user.data.data.first_name, user.data.data.last_name].filter(Boolean).join(' '),
			},
			platform: platform(globalAdmin),
			defaultNamespaceId: namespaces.default,
		};
	},
	async listAvailable(signal) {
		return (await loadListing(signal)).data.filter((row) => row.can_enter || row.readiness !== 'ready').map(choice);
	},
	async mintTargetToken(target, signal) {
		try {
			const response = await control.post<{ data: WireGrant }>(
				`/namespaces/${encodeURIComponent(target)}/token`,
				{},
				{
					headers: bearer(),
					signal,
				}
			);

			return grant(response.data.data, target);
		} catch (error) {
			controlError(error, true);
		}
	},
	async refreshForNamespace(context: ContextStamp, signal) {
		try {
			const response = await control.post<{ data: WireGrant }>(
				'/auth/refresh',
				{ mode: 'cookie', namespace: context.namespaceId },
				{ signal }
			);

			return grant(response.data.data, context.namespaceId);
		} catch (error) {
			controlError(error);
		}
	},
	async hydrate(context, _token, signal): Promise<NamespaceSnapshot> {
		if (signal.aborted) throw new NamespaceError('cancelled', 'Target hydration cancelled');
		await hydrate({ strict: true });
		if (signal.aborted) throw new NamespaceError('cancelled', 'Target hydration cancelled');

		const collections = useCollectionsStore().collections.map((entry) => ({
			collection: entry.collection,
			name: entry.collection,
		}));

		const permissions = usePermissionsStore().permissions.map((entry) => ({
			collection: entry.collection,
			action: entry.action,
			fields: entry.fields ?? [],
			filter: entry.permissions,
		}));

		return { namespaceId: context.namespaceId, collections, permissions };
	},
	validateDestination(destination, snapshot) {
		const safe = internalDestination(destination);
		if (
			['/login', '/logout', '/namespace/loading', '/namespace/choose', '/namespace/recover'].some((path) =>
				safe.startsWith(path)
			)
		)
			return '/namespace';
		const match = /^\/content\/([^/?#]+)/.exec(safe);
		if (match && !snapshot.collections.some((row) => row.collection === decodeURIComponent(match[1]!)))
			return '/namespace';
		return router.resolve(safe).name === 'private-404' ? '/namespace' : safe;
	},
};
