import { useUserStore } from '@/stores/user';
import { Accountability, Role, User } from '@wbce-d9/types';
import { parsePreset as parsePresetShared } from '@wbce-d9/utils';

export function parsePreset(preset: Record<string, any> | null): Record<string, any> {
	const { currentUser } = useUserStore();

	if (!currentUser) return preset ?? {};

	const accountability: Accountability = {
		role: currentUser.role?.id ?? null,
		user: 'id' in currentUser ? currentUser.id : null,
	};

	return (
		parsePresetShared(preset, accountability, {
			$CURRENT_ROLE: (currentUser.role ?? undefined) as Role | undefined,
			$CURRENT_USER: currentUser as User,
		}) ?? {}
	);
}
