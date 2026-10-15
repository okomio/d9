import { ensureNamespaceRuntime } from '@/namespaces/live';
import { getRootPath } from '@/utils/get-root-path';

export type NamespaceMember = {
	user_id: string;
	email: string | null;
	first_name: string | null;
	last_name: string | null;
	status: string | null;
	role: { id: string; name: string; admin_access: boolean } | null;
};

export type MemberCandidate = Omit<NamespaceMember, 'role'>;
export type NamespaceRole = { id: string; name: string; admin_access: boolean };

export type MemberPage = {
	data: NamespaceMember[];
	meta: { total_count: number; role_counts: Record<string, number> };
};

export class MemberRequestError extends Error {
	readonly response: { status: number; data: unknown };
	constructor(message: string, status: number, data: unknown) {
		super(message);
		this.response = { status, data };
	}
}

/** Control-plane member operations are bound to the captured namespace and switch ledger. */
async function request<T>(
	method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
	path: (namespaceId: string) => string,
	body?: Record<string, string>,
	signal?: AbortSignal
): Promise<T> {
	const runtime = ensureNamespaceRuntime();
	const kind = method === 'GET' ? 'read' : 'write';

	return runtime.request(
		kind,
		async (context) => {
			const response = await fetch(`${getRootPath()}${path(encodeURIComponent(context.namespaceId))}`, {
				method,
				headers: {
					Authorization: `Bearer ${context.token}`,
					...(body ? { 'Content-Type': 'application/json' } : {}),
				},
				body: body ? JSON.stringify(body) : undefined,
				signal: context.signal,
			});

			if (!response.ok) {
				const payload = await response.json().catch(() => null);
				const message = payload?.errors?.[0]?.message ?? `Member operation failed (${response.status})`;
				throw new MemberRequestError(message, response.status, payload);
			}

			return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
		},
		{ signal }
	);
}

export function listNamespaceMembers(search: string, limit: number, offset: number, signal?: AbortSignal) {
	const query = new URLSearchParams({ search, limit: String(limit), offset: String(offset) });
	return request<MemberPage>('GET', (id) => `namespaces/${id}/members?${query}`, undefined, signal);
}

/** Called only after the admin enters a query; never preload the shared directory. */
export function lookupExistingUsers(search: string, signal?: AbortSignal) {
	const query = new URLSearchParams({ search, limit: '20' });
	return request<{ data: MemberCandidate[] }>(
		'GET',
		(id) => `namespaces/${id}/members/lookup?${query}`,
		undefined,
		signal
	);
}

export function listNamespaceRoles(signal?: AbortSignal) {
	const query = new URLSearchParams({ limit: '-1', sort: 'name', 'fields[]': 'id' });
	query.append('fields[]', 'name');
	query.append('fields[]', 'admin_access');
	return request<{ data: NamespaceRole[] }>('GET', () => `roles?${query}`, undefined, signal);
}

export function addNamespaceMember(userId: string, roleId: string) {
	return request<void>('POST', (id) => `namespaces/${id}/members`, { user_id: userId, role_id: roleId });
}

export function changeNamespaceMemberRole(userId: string, roleId: string) {
	return request<void>('PATCH', (id) => `namespaces/${id}/members/${encodeURIComponent(userId)}`, { role_id: roleId });
}

export function removeNamespaceMember(userId: string) {
	return request<void>('DELETE', (id) => `namespaces/${id}/members/${encodeURIComponent(userId)}`);
}
