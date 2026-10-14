import { describe, expect, it, vi } from 'vitest';
import { createNamespaceState } from './context';
import { createOperationLedger } from './requests';

function activeLedger() {
	const state = createNamespaceState();
	state.epoch = 1;
	state.phase = 'ready';

	state.active = {
		namespaceId: 'tracking',
		epoch: 1,
		sessionGeneration: 0,
		namespace: { id: 'tracking', name: 'Tracking', kind: 'virtual', readiness: 'ready' },
		access: {
			localRole: { id: 'role', name: 'Editor' },
			source: 'membership',
			canUseApp: true,
			isNamespaceAdmin: false,
			canManageMembers: false,
			canManageSchema: false,
			canManageFlows: false,
			requiresTfa: false,
		},
		platform: {
			isGlobalAdmin: false,
			canManageNamespaces: false,
			canManageSharedUsers: false,
			canManageSharedSettings: false,
		},
	};

	return { state, ledger: createOperationLedger(state, () => 'source-token') };
}

describe('native Axios operation admission', () => {
	it('drains a source write by response settlement, not spinner timing', async () => {
		const { ledger } = activeLedger();
		const ticket = ledger.admitExternal('write')!;
		ledger.closeAdmission();
		let drained = false;

		const draining = ledger.drainWrites().then(() => {
			drained = true;
		});

		await Promise.resolve();
		expect(drained).toBe(false);
		expect(ticket.token).toBe('source-token');
		ticket.finish();
		await draining;
		expect(drained).toBe(true);
	});

	it('aborts reads and rejects failed writes before a switch', async () => {
		const { ledger } = activeLedger();
		const read = ledger.admitExternal('read')!;
		const write = ledger.admitExternal('write')!;
		ledger.closeAdmission();
		ledger.cancelReads();
		expect(read.signal.aborted).toBe(true);
		const error = new Error('unknown write outcome');
		write.finish(error);
		await expect(ledger.drainWrites()).rejects.toMatchObject({ kind: 'ambiguous' });
		ledger.acknowledgeWriteFailures();
		await expect(ledger.drainWrites()).resolves.toBeUndefined();
	});

	it('suppresses an old response after the epoch advances', () => {
		const { state, ledger } = activeLedger();
		const ticket = ledger.admitExternal('read')!;
		state.epoch++;
		state.active = { ...state.active!, epoch: state.epoch };
		const effect = vi.fn();
		ledger.effect(ticket, effect);
		expect(ticket.current()).toBe(false);
		expect(effect).not.toHaveBeenCalled();
	});
});
