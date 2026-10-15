import api from '@/api';
import emitter, { Events } from '@/events';
import { i18n } from '@/lang';
import { notify } from '@/utils/notify';
import { unexpectedError } from './unexpected-error';
import { getNamespaceRuntime } from '@/namespaces/live';
import { NamespaceError } from '@/namespaces/adapter';

export async function uploadFile(
	file: File,
	options?: {
		onProgressChange?: (percentage: number) => void;
		notifications?: boolean;
		preset?: Record<string, any>;
		fileId?: string;
	}
): Promise<any> {
	const progressHandler = options?.onProgressChange || (() => undefined);
	const runtime = getNamespaceRuntime();
	const source = runtime?.state.active && { ...runtime.state.active };
	const formData = new FormData();

	if (options?.preset) {
		for (const [key, value] of Object.entries(options.preset)) {
			formData.append(key, value);
		}
	}

	formData.append('file', file);

	try {
		let response = null;

		if (options?.fileId) {
			response = await api.patch(`/files/${options.fileId}`, formData, {
				onUploadProgress,
			});
		} else {
			response = await api.post(`/files`, formData, {
				onUploadProgress,
			});
		}

		if (source && !runtime?.ledger.current(source)) throw new NamespaceError('cancelled', 'Stale upload result');

		if (options?.notifications) {
			notify({
				title: i18n.global.t('upload_file_success'),
			});
		}

		emitter.emit(Events.upload);

		return response.data?.data ?? null;
	} catch (err: any) {
		if (!(err instanceof NamespaceError) || err.kind !== 'cancelled') unexpectedError(err);
	}

	function onUploadProgress(progressEvent: { loaded: number; total?: number }) {
		if (source && !runtime?.ledger.current(source)) return;
		const percentCompleted = Math.floor((progressEvent.loaded * 100) / (progressEvent.total || 1));
		progressHandler(percentCompleted);
	}
}
