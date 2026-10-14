import type { ActiveNamespaceContext, ContextStamp, NamespaceState, TokenGrant } from './types';
import { NamespaceError } from './adapter';

export function createNamespaceState(): NamespaceState {
	return {
		session: null,
		active: null,
		pending: null,
		choices: [],
		phase: 'idle',
		epoch: 0,
		sessionGeneration: 0,
		error: null,
	};
}
export function sameContext(a: ContextStamp | null, b: ContextStamp | null): boolean {
	return (
		!!a && !!b && a.namespaceId === b.namespaceId && a.epoch === b.epoch && a.sessionGeneration === b.sessionGeneration
	);
}
export function validateGrant(grant: TokenGrant, target: string): void {
	if (
		grant.namespace.id !== target ||
		grant.namespace.readiness !== 'ready' ||
		!grant.accessToken ||
		!Number.isFinite(grant.expiresInMs) ||
		grant.expiresInMs <= 0
	) {
		throw new NamespaceError('contract', 'Invalid target token grant');
	}

	if (!grant.access.canUseApp) throw new NamespaceError('app-denied', 'Namespace has no app access');
	if (grant.access.source === 'inherited' && !grant.platform.isGlobalAdmin)
		throw new NamespaceError('contract', 'Inherited access without platform entitlement');
}
export function contextFromGrant(grant: TokenGrant, state: NamespaceState): ActiveNamespaceContext {
	return {
		namespaceId: grant.namespace.id,
		namespace: grant.namespace,
		access: grant.access,
		platform: grant.platform,
		epoch: state.epoch,
		sessionGeneration: state.sessionGeneration,
	};
}
