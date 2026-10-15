import type { FragmentDefinitionNode, SelectionSetNode } from 'graphql';
import { getOperationAST, Kind } from 'graphql';
import type { GraphQLParams } from '../types/index.js';

const SHARED_QUERIES = new Set(['users_me', 'server_ping', 'server_info', 'server_health', 'extensions', '__typename']);

const SHARED_MUTATIONS = new Set([
	'auth_login',
	'auth_refresh',
	'auth_logout',
	'auth_password_request',
	'auth_password_reset',
	'update_users_me',
	'users_me_tfa_generate',
	'users_me_tfa_enable',
	'users_me_tfa_disable',
	'__typename',
]);

/**
 * Shared identity operations remain reachable before a namespace is selected.
 * Classify the selected operation, including root fragments, rather than the
 * transport path: the system endpoint also contains namespace-scoped resources.
 * A mixed operation needs a namespace before any resolver can run.
 */
export function isSharedGraphQLOperation(
	path: string,
	params?: Pick<GraphQLParams, 'document' | 'operationName'>
): boolean {
	const normalized = path.toLowerCase();
	if (normalized !== '/graphql/system' && normalized !== '/graphql/system/') return false;
	if (!params) return false;

	const operation = getOperationAST(params.document, params.operationName);
	if (!operation || operation.operation === 'subscription') return false;

	const allowed = operation.operation === 'query' ? SHARED_QUERIES : SHARED_MUTATIONS;
	const fragments = new Map<string, FragmentDefinitionNode>();

	for (const definition of params.document.definitions) {
		if (definition.kind === Kind.FRAGMENT_DEFINITION) fragments.set(definition.name.value, definition);
	}

	const visiting = new Set<string>();
	const checked = new Set<string>();
	let fields = 0;

	function isShared(selectionSet: SelectionSetNode): boolean {
		for (const selection of selectionSet.selections) {
			if (selection.kind === Kind.FIELD) {
				fields++;
				if (!allowed.has(selection.name.value)) return false;
			} else if (selection.kind === Kind.INLINE_FRAGMENT) {
				if (!isShared(selection.selectionSet)) return false;
			} else {
				const name = selection.name.value;
				const fragment = fragments.get(name);
				if (!fragment || visiting.has(name)) return false;
				if (checked.has(name)) continue;
				visiting.add(name);
				if (!isShared(fragment.selectionSet)) return false;
				visiting.delete(name);
				checked.add(name);
			}
		}

		return true;
	}

	return isShared(operation.selectionSet) && fields > 0;
}
