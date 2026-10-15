import { NamespaceError } from './adapter';
import { namespaceAuthError } from './auth';
import type { OperationContext, OperationKind, OperationLedger } from './requests';

export interface ContextRefresh {
	refresh(stamp: OperationContext): Promise<string>;
	rejectContext?(stamp: OperationContext, error: NamespaceError): Promise<void>;
}
/** Entire execution/retry is ONE admitted ledger operation. Mutations are never replayed by default. */
export function runAuthenticatedOperation<T>(
	ledger: OperationLedger,
	auth: ContextRefresh,
	kind: OperationKind,
	operation: (context: OperationContext) => Promise<T>,
	options: { signal?: AbortSignal; replaySafeWrite?: boolean } = {}
): Promise<T> {
	return ledger.run(
		kind,
		async (captured) => {
			try {
				return await operation(captured);
			} catch (error) {
				if (!ledger.current(captured) || captured.signal.aborted)
					throw new NamespaceError('cancelled', 'Stale authentication failure');
				const normalized = namespaceAuthError(error);
				if (
					normalized instanceof NamespaceError &&
					['namespace-denied', 'app-denied', 'session-expired'].includes(normalized.kind)
				)
					await auth.rejectContext?.(captured, normalized);
				if (!(normalized instanceof NamespaceError) || normalized.kind !== 'invalid-token') throw normalized;
				if (kind === 'write' && !options.replaySafeWrite) throw normalized;
				const token = await auth.refresh(captured);
				if (!ledger.current(captured) || captured.signal.aborted)
					throw new NamespaceError('cancelled', 'Stale authentication retry');
				// Exactly one retry, preserving source namespace/epoch/session and transport options.
				return operation({ ...captured, token });
			}
		},
		options.signal
	);
}
