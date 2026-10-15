import type {
	AuthorizedNamespaceChoice,
	ContextStamp,
	NamespaceId,
	NamespaceSnapshot,
	SessionContext,
	TokenGrant,
} from './types';

/** Proposed client operations, not URL declarations. Backend developer owns transport/DTO mapping. */
export interface NamespaceAdapter {
	readonly mode: 'mock' | 'backend';
	readSessionContext(signal?: AbortSignal): Promise<SessionContext>;
	listAvailable(signal?: AbortSignal): Promise<readonly AuthorizedNamespaceChoice[]>;
	/** Source must remain valid until client commit. Ambiguous outcomes require backend reconciliation. */
	mintTargetToken(target: NamespaceId, signal?: AbortSignal): Promise<TokenGrant>;
	refreshForNamespace(context: ContextStamp, signal?: AbortSignal): Promise<TokenGrant>;
	/** Control lane: captured target token, no legacy default-token requests. */
	hydrate(context: ContextStamp, token: string, signal: AbortSignal): Promise<NamespaceSnapshot>;
	validateDestination(destination: string, snapshot: NamespaceSnapshot): string;
}
export type NamespaceErrorKind =
	| 'cancelled'
	| 'namespace-denied'
	| 'app-denied'
	| 'session-expired'
	| 'invalid-token'
	| 'resource-denied'
	| 'ambiguous'
	| 'contract';
export class NamespaceError extends Error {
	constructor(public readonly kind: NamespaceErrorKind, message: string) {
		super(message);
		this.name = 'NamespaceError';
	}
}
