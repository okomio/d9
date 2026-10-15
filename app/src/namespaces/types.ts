/** Client domain contracts. D01–D04 wire DTOs are NOT agreed backend endpoints. */
export type NamespaceId = string;
export type NamespaceReadiness = 'ready' | 'provisioning' | 'failed';
export interface NamespaceIdentity {
	id: NamespaceId;
	name: string;
	kind: 'main' | 'virtual';
	readiness: NamespaceReadiness;
}
export interface LocalRole {
	id: string;
	name: string;
	adminAccess?: boolean;
	appAccess?: boolean;
}
export interface EffectiveLocalAccess {
	localRole: LocalRole | null;
	source: 'membership' | 'inherited';
	canUseApp: boolean;
	isNamespaceAdmin: boolean;
	canManageMembers: boolean;
	canManageSchema: boolean;
	canManageFlows: boolean;
	/** Backend D04 has not supplied an effective child TFA policy yet. */
	requiresTfa: boolean | null;
}
/** Never derive these from a child role's admin_access. */
export interface PlatformCapabilities {
	isGlobalAdmin: boolean;
	canManageNamespaces: boolean;
	canManageSharedUsers: boolean;
	canManageSharedSettings: boolean;
}
export interface AuthorizedNamespaceChoice {
	namespace: NamespaceIdentity;
	access: EffectiveLocalAccess;
}
export interface SessionContext {
	user: { id: string; name: string };
	platform: PlatformCapabilities;
	defaultNamespaceId: NamespaceId | null;
}
export interface TokenGrant {
	namespace: NamespaceIdentity;
	access: EffectiveLocalAccess;
	platform: PlatformCapabilities;
	accessToken: string;
	/** Duration in milliseconds, matching existing login/refresh semantics. */
	expiresInMs: number;
}
export interface ContextStamp {
	namespaceId: NamespaceId;
	epoch: number;
	sessionGeneration: number;
}
export interface ActiveNamespaceContext extends ContextStamp {
	namespace: NamespaceIdentity;
	access: EffectiveLocalAccess;
	platform: PlatformCapabilities;
}
export type NamespacePhase =
	| 'idle'
	| 'preflight'
	| 'quiescing'
	| 'minting'
	| 'resetting'
	| 'hydrating'
	| 'ready'
	| 'blocked'
	| 'no-access';
export interface NamespaceState {
	session: SessionContext | null;
	active: ActiveNamespaceContext | null;
	pending: NamespaceId | null;
	choices: readonly AuthorizedNamespaceChoice[];
	choicesLoading: boolean;
	choicesError: unknown;
	phase: NamespacePhase;
	epoch: number;
	sessionGeneration: number;
	error: unknown;
}
export interface SwitchIntent {
	namespaceId: NamespaceId;
	source: 'picker' | 'history' | 'deep-link' | 'platform' | 'bootstrap' | 'recovery';
	/** Internal admin-router path, never a token or an absolute URL. */
	destination?: string;
}
export type SwitchResult = { status: 'ready' | 'stayed' | 'busy' | 'blocked'; error?: unknown; destination?: string };
export interface NamespaceCoordinator {
	requestSwitch(intent: SwitchIntent): Promise<SwitchResult>;
}
export type RegistryInvalidation = {
	reason: 'created' | 'readiness' | 'membership' | 'entitlement';
	namespaceId?: NamespaceId;
};
/** Snapshots publish only after all required reads pass; no partial store mutations. */
export interface NamespaceSnapshot {
	namespaceId: NamespaceId;
	collections: readonly { collection: string; name: string }[];
	permissions: readonly { collection: string; action: string; fields: readonly string[]; filter: unknown }[];
}
