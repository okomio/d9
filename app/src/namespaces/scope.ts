import type { ContextStamp } from './types';
import type { NamespaceLifecycle } from './lifecycle';
import type { OperationLedger } from './requests';

/** One owned scope per view/extension. All timers, listeners and object URLs die on reset. */
export function createNamespaceScope(
	id: string,
	stamp: ContextStamp,
	lifecycle: NamespaceLifecycle,
	ledger: OperationLedger
) {
	const cleanups = new Set<() => void>();
	let paused = false;
	let disposed = false;

	const clear = () => {
		for (const cleanup of cleanups) cleanup();
		cleanups.clear();
	};

	const unregister = lifecycle.register({
		id,
		pause: () => {
			paused = true;
		},
		reset: clear,
		dispose: clear,
		resume: (context) => {
			paused = !context || !ledger.current(stamp);
		},
	});

	const effect = (callback: () => void) => {
		if (!paused && !disposed) ledger.effect(stamp, callback);
	};

	return {
		effect,
		own(cleanup: () => void) {
			if (disposed) cleanup();
			else cleanups.add(cleanup);
			return () => cleanups.delete(cleanup);
		},
		timeout(callback: () => void, delay: number) {
			const timer = setTimeout(() => {
				cleanups.delete(cancel);
				effect(callback);
			}, delay);

			const cancel = () => clearTimeout(timer);
			cleanups.add(cancel);
			return cancel;
		},
		poll(callback: () => void, delay: number) {
			const timer = setInterval(() => effect(callback), delay);
			const cancel = () => clearInterval(timer);
			cleanups.add(cancel);
			return cancel;
		},
		objectURL(blob: Blob) {
			const url = URL.createObjectURL(blob);
			cleanups.add(() => URL.revokeObjectURL(url));
			return url;
		},
		dispose() {
			disposed = true;
			clear();
			unregister();
		},
	};
}
