import { NamespaceError } from './adapter';
import { sameContext } from './context';
import type { ContextStamp, NamespaceState } from './types';

export type OperationKind = 'read' | 'write';
export interface OperationContext extends ContextStamp {
	token: string;
	signal: AbortSignal;
}
export interface ExternalOperationTicket extends OperationContext {
	kind: OperationKind;
	finish(error?: unknown): void;
	current(): boolean;
	abort(): void;
}
/** Real settlement ledger. Spinner/queue-idle state is never used as a write barrier. */
export function createOperationLedger(state: NamespaceState, token: () => string | null) {
	const reads = new Set<AbortController>();
	const writes = new Map<Promise<unknown>, ContextStamp>();
	const failures = new Map<unknown, ContextStamp>();
	let admissionOpen = true;
	const current = (stamp: ContextStamp) => sameContext(stamp, state.active);
	return {
		current,
		admitExternal(kind: OperationKind, hydration = false): ExternalOperationTicket | null {
			const active = state.active;
			const accessToken = token();
			if (!active || !accessToken) return null;
			if ((!admissionOpen || state.phase !== 'ready') && !(hydration && state.phase === 'hydrating' && kind === 'read'))
				throw new NamespaceError('cancelled', 'Namespace operation admission closed');
			const controller = new AbortController();
			let settle: (() => void) | undefined;

			const completion = new Promise<void>((resolve) => {
				settle = resolve;
			});

			const stamp = {
				namespaceId: active.namespaceId,
				epoch: active.epoch,
				sessionGeneration: active.sessionGeneration,
			};

			if (kind === 'read') reads.add(controller);
			else writes.set(completion, stamp);
			let finished = false;
			return {
				...stamp,
				kind,
				token: accessToken,
				signal: controller.signal,
				current: () => current(stamp),
				abort: () => controller.abort(),
				finish(error?: unknown) {
					if (finished) return;
					finished = true;
					reads.delete(controller);
					writes.delete(completion);
					if (kind === 'write' && error !== undefined) failures.set(error, stamp);
					settle?.();
				},
			};
		},
		closeAdmission() {
			admissionOpen = false;
		},
		openAdmission() {
			admissionOpen = true;
		},
		cancelReads() {
			for (const controller of reads) controller.abort();
			reads.clear();
		},
		async drainWrites() {
			const source = state.active;

			await Promise.allSettled(
				[...writes].filter(([, stamp]) => sameContext(stamp, source)).map(([promise]) => promise)
			);

			if ([...failures.values()].some((stamp) => sameContext(stamp, source)))
				throw new NamespaceError('ambiguous', 'Source write failed or has unknown outcome; reconcile before switching');
		},
		/** Only call after source-side reconciliation; no automatic mutation replay. */
		acknowledgeWriteFailures() {
			for (const [error, stamp] of failures) if (sameContext(stamp, state.active)) failures.delete(error);
		},
		async run<T>(
			kind: OperationKind,
			operation: (context: OperationContext) => Promise<T>,
			signal?: AbortSignal
		): Promise<T> {
			const active = state.active;
			const accessToken = token();
			if (!admissionOpen || state.phase !== 'ready' || !active || !accessToken)
				throw new NamespaceError('cancelled', 'Namespace operation admission closed');
			if (signal?.aborted) throw new NamespaceError('cancelled', 'Operation cancelled');
			const controller = new AbortController();

			const context: OperationContext = {
				namespaceId: active.namespaceId,
				epoch: active.epoch,
				sessionGeneration: active.sessionGeneration,
				token: accessToken,
				signal: controller.signal,
			};

			const abort = () => controller.abort();
			signal?.addEventListener('abort', abort, { once: true });
			if (kind === 'read') reads.add(controller);
			// Writes intentionally do not inherit cancellation after admission. Their real outcome must drain.
			if (kind === 'write') signal?.removeEventListener('abort', abort);

			const execution = Promise.resolve().then(() => {
				if (controller.signal.aborted) throw new NamespaceError('cancelled', 'Queued read cancelled');
				return operation(context);
			});

			if (kind === 'write') {
				writes.set(execution, context);
				void execution.catch((error) => failures.set(error, context)).finally(() => writes.delete(execution));
			}

			let removeCancellation = () => {};

			const cancellation = new Promise<never>((_, reject) => {
				const cancel = () => reject(new NamespaceError('cancelled', 'Context read cancelled'));
				controller.signal.addEventListener('abort', cancel, { once: true });
				removeCancellation = () => controller.signal.removeEventListener('abort', cancel);
				if (controller.signal.aborted) cancel();
			});

			try {
				const result = await (kind === 'read' ? Promise.race([execution, cancellation]) : execution);
				if (!current(context)) throw new NamespaceError('cancelled', 'Stale operation result');
				return result;
			} catch (error) {
				if (!current(context) || controller.signal.aborted)
					throw new NamespaceError('cancelled', 'Stale operation error');
				throw error;
			} finally {
				reads.delete(controller);
				removeCancellation();
				signal?.removeEventListener('abort', abort);
			}
		},
		/** Use for success/error/finally/events, delayed callbacks and external subscriptions. */
		effect(stamp: ContextStamp, callback: () => void) {
			if (current(stamp) && ['ready', 'quiescing', 'minting'].includes(state.phase)) callback();
		},
	};
}
export type OperationLedger = ReturnType<typeof createOperationLedger>;
