import { NamespaceError } from './adapter';
import type { ActiveNamespaceContext } from './types';

export interface NamespaceParticipant {
	id: string;
	dirty?: () => boolean | Promise<boolean>;
	pause?: () => void | Promise<void>;
	reset?: () => void | Promise<void>;
	resume?: (context: ActiveNamespaceContext | null) => void | Promise<void>;
	dispose?: () => void | Promise<void>;
}
export function createNamespaceLifecycle() {
	const participants = new Map<string, NamespaceParticipant>();
	const paused = new Set<NamespaceParticipant>();
	return {
		register(participant: NamespaceParticipant) {
			if (participants.has(participant.id)) throw new Error(`Duplicate namespace participant: ${participant.id}`);
			participants.set(participant.id, participant);

			return () => {
				participants.delete(participant.id);
				paused.delete(participant);
				void participant.dispose?.();
			};
		},
		async dirty() {
			const checks = await Promise.all(
				[...participants.values()].map(async (participant) => ((await participant.dirty?.()) ? participant.id : null))
			);

			return checks.filter((id): id is string => id !== null);
		},
		async pause() {
			// Add before invocation so even a partially failed pause is resumed once on source recovery.
			for (const participant of participants.values()) {
				paused.add(participant);
				await participant.pause?.();
			}
		},
		async resume(context: ActiveNamespaceContext | null) {
			const list = [...paused];
			paused.clear();
			const results = await Promise.allSettled(list.map(async (participant) => participant.resume?.(context)));
			if (results.some((result) => result.status === 'rejected'))
				throw new NamespaceError('contract', 'Producer resume failed');
		},
		async reset() {
			const results = await Promise.allSettled(
				[...participants.values()].map(async (participant) => participant.reset?.())
			);

			if (results.some((result) => result.status === 'rejected'))
				throw new NamespaceError('contract', 'Namespace reset failed');
		},
		async dispose() {
			paused.clear();
			await Promise.allSettled([...participants.values()].map(async (participant) => participant.dispose?.()));
		},
	};
}
export type NamespaceLifecycle = ReturnType<typeof createNamespaceLifecycle>;
