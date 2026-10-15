import { NamespaceError } from './adapter';
import type { ContextStamp, NamespaceSnapshot } from './types';

export interface SnapshotReaders {
	collections(context: ContextStamp, token: string, signal: AbortSignal): Promise<NamespaceSnapshot['collections']>;
	permissions(context: ContextStamp, token: string, signal: AbortSignal): Promise<NamespaceSnapshot['permissions']>;
}
/** Stage required reads: cancel siblings on failure, await real settlement, publish nothing partial. */
export async function hydrateNamespaceSnapshot(
	context: ContextStamp,
	token: string,
	signal: AbortSignal,
	readers: SnapshotReaders
): Promise<NamespaceSnapshot> {
	const controller = new AbortController();
	const abort = () => controller.abort();
	signal.addEventListener('abort', abort, { once: true });
	if (signal.aborted) abort();

	const read = async <T>(run: () => Promise<T>) => {
		if (controller.signal.aborted) throw new NamespaceError('cancelled', 'Hydration cancelled');

		try {
			return await run();
		} catch (error) {
			controller.abort();
			throw error;
		}
	};

	try {
		const [collections, permissions] = await Promise.allSettled([
			read(() => readers.collections(context, token, controller.signal)),
			read(() => readers.permissions(context, token, controller.signal)),
		]);

		if (signal.aborted) throw new NamespaceError('cancelled', 'Hydration context cancelled');
		if (collections.status === 'rejected') throw collections.reason;
		if (permissions.status === 'rejected') throw permissions.reason;
		return { namespaceId: context.namespaceId, collections: collections.value, permissions: permissions.value };
	} finally {
		signal.removeEventListener('abort', abort);
	}
}
