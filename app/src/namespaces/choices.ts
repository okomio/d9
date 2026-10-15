import type { AuthorizedNamespaceChoice } from './types';

/** The internal main workspace is never a picker destination in the native app. */
export function isEnterableChild(choice: AuthorizedNamespaceChoice): boolean {
	return choice.namespace.kind === 'virtual' && choice.namespace.readiness === 'ready' && choice.access.canUseApp;
}

export function enterableChild(choices: readonly AuthorizedNamespaceChoice[], id: string): boolean {
	return choices.some((choice) => choice.namespace.id === id && isEnterableChild(choice));
}

/** Retain the foundation's explicit legacy main link for a Global Admin with child app access. */
export function allowedDestination(
	choices: readonly AuthorizedNamespaceChoice[],
	id: string,
	isGlobalAdmin: boolean
): boolean {
	if (enterableChild(choices, id)) return true;
	return (
		isGlobalAdmin &&
		choices.some(isEnterableChild) &&
		choices.some(
			(choice) =>
				choice.namespace.id === id &&
				choice.namespace.kind === 'main' &&
				choice.namespace.readiness === 'ready' &&
				choice.access.canUseApp
		)
	);
}
