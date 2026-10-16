import { describe, expect, test } from 'vitest';
import { isControlPlanePath } from './paths.js';

describe('isControlPlanePath', () => {
	test('matches the control plane itself and its children', () => {
		expect(isControlPlanePath('/auth')).toBe(true);
		expect(isControlPlanePath('/auth/login')).toBe(true);
		expect(isControlPlanePath('/users/me')).toBe(true);
		expect(isControlPlanePath('/users/me/track/page')).toBe(true);
		expect(isControlPlanePath('/namespaces')).toBe(true);
		expect(isControlPlanePath('/namespaces/ns_a/token')).toBe(true);
		expect(isControlPlanePath('/assets/abc')).toBe(true);
		expect(isControlPlanePath('/server/info')).toBe(true);
	});

	test('matches literal routes without regard to case, like Express', () => {
		expect(isControlPlanePath('/AUTH/login')).toBe(true);
		expect(isControlPlanePath('/Users/ME')).toBe(true);
		expect(isControlPlanePath('/NaMeSpAcEs/SomeCaseSensitiveId/token')).toBe(true);
		expect(isControlPlanePath('/SERVER/specs/graphql/SYSTEM')).toBe(true);
		expect(isControlPlanePath('/Users/ME-too')).toBe(false);
	});

	test('does not match namespace-scoped paths or lookalikes', () => {
		expect(isControlPlanePath('/items/countries')).toBe(false);
		expect(isControlPlanePath('/graphql')).toBe(false);
		expect(isControlPlanePath('/users')).toBe(false);
		expect(isControlPlanePath('/users/some-id')).toBe(false);
		expect(isControlPlanePath('/users/me-too')).toBe(false);
		expect(isControlPlanePath('/auths')).toBe(false);
		expect(isControlPlanePath('/server-side')).toBe(false);
	});
});
