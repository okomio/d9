import type { NamespaceNavigation } from './coordinator';
import type { SwitchIntent } from './types';
import { internalDestination, withNamespace } from './url';

export interface NavigationPort {
	replace(destination: string): Promise<unknown>;
	push?(destination: string): Promise<unknown>;
}
/** One-use exact route permit; UI callers cannot skip the switch transaction. */
export function createNamespaceNavigation(port: NavigationPort) {
	let permit: string | null = null;
	let target: string | null = null;
	let historyGuard = false;

	const replace = async (destination: string) => {
		const safe = internalDestination(destination);
		permit = safe;

		try {
			await port.replace(safe);
		} finally {
			permit = null;
		}
	};

	const push = async (destination: string) => {
		const safe = internalDestination(destination);
		permit = safe;

		try {
			await (port.push ?? port.replace)(safe);
		} finally {
			permit = null;
		}
	};

	const navigation: NamespaceNavigation = {
		async commit(intent: SwitchIntent) {
			target = intent.namespaceId;
			historyGuard = intent.source === 'history';
			// The router guard owns the in-progress browser navigation. Redirecting here
			// would add a new entry and break Back/Forward.
			if (historyGuard) return;
			const next = internalDestination(intent.destination ?? '/content');
			const loading = withNamespace(`/namespace/loading?next=${encodeURIComponent(next)}`, target);
			if (intent.source === 'picker' || intent.source === 'platform') await push(loading);
			else await replace(loading);
		},
		async finish(destination: string) {
			if (!target) throw new Error('No navigation transaction');

			if (historyGuard) {
				historyGuard = false;
				target = null;
				return;
			}

			await replace(withNamespace(destination, target));
			target = null;
		},
	};

	return {
		...navigation,
		consumePermit(destination: string) {
			if (permit !== internalDestination(destination)) return false;
			permit = null;
			return true;
		},
	};
}
