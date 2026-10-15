import { refresh } from '@/auth';
import { useRequestsStore } from '@/stores/requests';
import { getRootPath } from '@/utils/get-root-path';
import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { addQueryToPath } from './utils/add-query-to-path';
import PQueue, { Options, DefaultAddOptions } from 'p-queue';
import { AxiosHeaders } from 'axios';
import { getNamespaceRuntime } from '@/namespaces/live';
import { NamespaceError } from '@/namespaces/adapter';
import type { ExternalOperationTicket } from '@/namespaces/requests';

const api = axios.create({
	baseURL: getRootPath(),
	withCredentials: true,
});

let queue = new PQueue({ concurrency: 5, intervalCap: 5, interval: 500, carryoverConcurrencyCount: true });

/** Mirrors the backend's control-plane list (api/src/virtual-namespace/paths.ts). */
const CONTROL_PLANE_PATHS = ['/auth', '/server', '/assets', '/users/me', '/namespaces'];

function isControlPlanePath(url?: string): boolean {
	return !!url && CONTROL_PLANE_PATHS.some((prefix) => url === prefix || url.startsWith(`${prefix}/`));
}

interface RequestConfig extends InternalAxiosRequestConfig {
	id: string;
	namespaceTicket?: ExternalOperationTicket;
	namespaceRetry?: boolean;
}

interface Response extends AxiosResponse {
	config: RequestConfig;
}

export interface RequestError extends AxiosError {
	response: Response;
}

export const onRequest = (config: InternalAxiosRequestConfig): Promise<RequestConfig> => {
	const requestsStore = useRequestsStore();
	const id = requestsStore.startRequest();

	const requestConfig: RequestConfig = {
		id: id,
		...config,
	};

	const runtime = getNamespaceRuntime();
	const method = (config.method ?? 'get').toLowerCase();
	const control = isControlPlanePath(config.url);

	if (runtime?.state.active && !control) {
		const kind =
			['get', 'head', 'options'].includes(method) && !config.url?.includes('/flows/trigger/') ? 'read' : 'write';

		let ticket: ExternalOperationTicket | null;

		try {
			ticket = runtime.ledger.admitExternal(kind, true);
		} catch (error) {
			requestsStore.endRequest(id);
			return Promise.reject(error);
		}

		if (ticket) {
			const admitted = ticket;
			requestConfig.namespaceTicket = ticket;

			requestConfig.headers = AxiosHeaders.from(requestConfig.headers as AxiosHeaders).set(
				'Authorization',
				`Bearer ${ticket.token}`
			);

			const originalSignal = config.signal;
			if (originalSignal?.aborted) admitted.abort();
			else originalSignal?.addEventListener?.('abort', () => admitted.abort(), { once: true });
			requestConfig.signal = ticket.signal;
		}
	}

	const scheduled = new Promise<RequestConfig>((resolve) => {
		if (config.url && config.url === '/auth/refresh') {
			resolve(requestConfig);
		} else {
			void queue.add(() => resolve(requestConfig));
		}
	});

	const ticket = requestConfig.namespaceTicket;
	if (!ticket) return scheduled;
	return Promise.race([
		scheduled,
		new Promise<never>((_, reject) => {
			if (ticket.signal.aborted) reject(new NamespaceError('cancelled', 'Queued read cancelled'));
			else
				ticket.signal.addEventListener(
					'abort',
					() => reject(new NamespaceError('cancelled', 'Queued read cancelled')),
					{ once: true }
				);
		}),
	]).catch((error) => {
		ticket.finish(error);
		requestsStore.endRequest(id);
		throw error;
	});
};

export const onResponse = (response: AxiosResponse | Response): AxiosResponse | Response => {
	const requestsStore = useRequestsStore();
	const id = (response.config as RequestConfig)?.id;
	if (id) requestsStore.endRequest(id);
	const ticket = (response.config as RequestConfig)?.namespaceTicket;
	if (ticket?.kind === 'write') window.setTimeout(() => ticket.finish(), 0);
	else ticket?.finish();
	if (ticket && !ticket.current()) throw new NamespaceError('cancelled', 'Stale namespace response');
	return response;
};

export const onError = async (error: RequestError): Promise<RequestError> => {
	const requestsStore = useRequestsStore();

	// Note: Cancelled requests don't respond with the config
	const config = error.config as RequestConfig | undefined;
	const ticket = config?.namespaceTicket;
	const id = config?.id;

	if (id) requestsStore.endRequest(id);
	if (ticket?.kind === 'write') window.setTimeout(() => ticket.finish(error), 0);
	else ticket?.finish(error);
	// Keep the original error: a denial, a contract break and a cancellation must stay distinct.
	if (error instanceof NamespaceError) return Promise.reject(error);

	// An aborted request is a cancellation, not a failure.
	if (ticket && (ticket.signal.aborted || !ticket.current())) {
		return Promise.reject(
			new NamespaceError(
				'cancelled',
				ticket.signal.aborted ? 'Namespace request aborted by a switch' : 'Stale namespace request'
			)
		);
	}

	// If a request fails with the unauthorized error, it either means that your user doesn't have
	// access, or that your session doesn't exist / has expired.
	// In case of the second, we should force the app to logout completely and redirect to the login
	// view.
	const status = error.response?.status;
	const code = error.response?.data?.errors?.[0]?.extensions?.code;

	if (
		(status === 401 || status === 403) &&
		(code === 'INVALID_CREDENTIALS' || code === 'INVALID_TOKEN') &&
		!config?.namespaceRetry &&
		!config?.url?.startsWith('/auth/')
	) {
		if (ticket?.kind === 'write') return Promise.reject(error);
		let newToken: string | undefined;

		try {
			newToken = ticket ? await getNamespaceRuntime()?.auth.refresh(ticket) : await refresh();
		} catch {
			return Promise.reject(error);
		}

		if (newToken && (!ticket || ticket.current())) {
			return api.request({
				...error.config,
				namespaceRetry: true,
				headers: {
					Authorization: `Bearer ${newToken}`,
				},
			} as RequestConfig);
		}
	}

	return Promise.reject(error);
};

api.interceptors.request.use(onRequest);
api.interceptors.response.use(onResponse, onError);

export default api;

export function getToken(): string | null {
	const authorization = api.defaults.headers.common['Authorization'];
	return typeof authorization === 'string' ? authorization.split(' ')[1] || null : null;
}

export function addTokenToURL(url: string, token?: string): string {
	const runtime = getNamespaceRuntime();
	if (runtime?.state.active && runtime.state.phase !== 'ready')
		throw new NamespaceError('cancelled', 'Namespace is switching');
	const accessToken = token || getToken();
	if (!accessToken) return url;

	return addQueryToPath(url, { access_token: accessToken });
}

export async function replaceQueue(options?: Options<any, DefaultAddOptions>) {
	await queue.onIdle();
	queue = new PQueue(options);
}
