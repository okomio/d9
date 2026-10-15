/* eslint-env es2022 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { credentials, seed, tokens } from './fixtures.mjs';

const api = fileURLToPath(new URL('../../api/', import.meta.url));
const require = createRequire(new URL('../../api/package.json', import.meta.url));
const knex = require('knex');

async function freePort() {
	const server = net.createServer();
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const { port } = server.address();
	await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	return port;
}

export class Fixture {
	children = [];
	servers = {};
	created = false;
	name = `d9_back_compat_${process.pid}_${randomBytes(4).toString('hex')}`;

	async start() {
		this.directory = await mkdtemp(join(tmpdir(), 'd9-back-compat-'));
		const storage = join(this.directory, 'uploads');
		await mkdir(storage);
		await mkdir(join(this.directory, 'extensions'));
		const config = join(this.directory, 'config.json');
		await writeFile(config, '{}');

		const connection = {
			host: process.env.BACK_COMPAT_DB_HOST ?? '127.0.0.1',
			port: Number(process.env.BACK_COMPAT_DB_PORT ?? 5432),
			user: process.env.BACK_COMPAT_DB_USER ?? 'directus',
			password: process.env.BACK_COMPAT_DB_PASSWORD ?? 'directus',
		};

		this.admin = knex({ client: 'pg', connection: { ...connection, database: 'postgres' }, pool: { min: 0, max: 2 } });
		// Never accept a target database name or reuse an existing database.
		await this.admin.raw('create database ??', [this.name]);
		this.created = true;

		this.database = knex({
			client: 'pg',
			connection: { ...connection, database: this.name },
			pool: { min: 0, max: 3 },
		});

		// Deliberately do not inherit application/DB/auth configuration or api/.env.
		this.env = {
			PATH: process.env.PATH,
			HOME: process.env.HOME,
			TMPDIR: process.env.TMPDIR,
			NODE_ENV: 'test',
			CONFIG_PATH: config,
			HOST: '127.0.0.1',
			KEY: 'compatibility-test-key',
			SECRET: 'compatibility-test-secret-not-for-deployment',
			DB_CLIENT: 'pg',
			DB_HOST: connection.host,
			DB_PORT: String(connection.port),
			DB_USER: connection.user,
			DB_PASSWORD: connection.password,
			DB_DATABASE: this.name,
			ADMIN_EMAIL: credentials.email,
			ADMIN_PASSWORD: credentials.password,
			SERVE_APP: 'false',
			TELEMETRY: 'false',
			LOG_LEVEL: 'error',
			EXTENSIONS_PATH: join(this.directory, 'extensions'),
			STORAGE_LOCATIONS: 'local',
			STORAGE_LOCAL_ROOT: storage,
			CACHE_ENABLED: 'true',
			CACHE_STORE: 'memory',
			CACHE_TTL: '10m',
			CACHE_AUTO_PURGE: 'true',
			CACHE_STATUS_HEADER: 'X-Compat-Cache',
			LOGIN_STALL_TIME: '0',
			ACCESS_TOKEN_TTL: '15m',
			REFRESH_TOKEN_OVERLAP_DURATION: '10s',
			ACCESS_TOKEN_COOKIE_NAME: 'compat_access',
			REFRESH_TOKEN_COOKIE_NAME: 'compat_refresh',
			ACCESS_TOKEN_COOKIE_SAME_SITE: 'lax',
			REFRESH_TOKEN_COOKIE_SAME_SITE: 'lax',
			AUTH_PROVIDERS: 'compat',
			AUTH_COMPAT_DRIVER: 'oauth2',
			AUTH_COMPAT_CLIENT_ID: 'fixture-client',
			AUTH_COMPAT_CLIENT_SECRET: 'fixture-secret',
			AUTH_COMPAT_AUTHORIZE_URL: 'https://identity.compat.invalid/authorize',
			AUTH_COMPAT_ACCESS_URL: 'https://identity.compat.invalid/token',
			AUTH_COMPAT_PROFILE_URL: 'https://identity.compat.invalid/profile',
		};

		await this.runCli(['bootstrap'], { PUBLIC_URL: 'http://127.0.0.1:1', VIRTUAL_NAMESPACES_ENABLED: 'true' });
		this.data = await seed(this.database, storage);

		for (const [mode, overrides] of Object.entries({
			disabled: { VIRTUAL_NAMESPACES_ENABLED: 'false' },
			legacy: {
				VIRTUAL_NAMESPACES_ENABLED: 'true',
				VIRTUAL_NAMESPACES_DEFAULT: 'main',
				VIRTUAL_NAMESPACES_ALLOW_HEADER: 'true',
			},
			defaultless: { VIRTUAL_NAMESPACES_ENABLED: 'true', VIRTUAL_NAMESPACES_ALLOW_HEADER: 'true' },
		})) {
			await this.startServer(mode, overrides);
		}
	}

	spawnCli(args, overrides) {
		const child = spawn(process.execPath, [join(api, 'dist/cli/run.js'), ...args], {
			cwd: this.directory,
			env: { ...this.env, ...overrides },
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		const state = { child, output: '', error: undefined };

		child.on('error', (error) => {
			state.error = error;
		});

		for (const stream of [child.stdout, child.stderr])
			stream.on('data', (chunk) => {
				state.output = (state.output + chunk).slice(-64_000);
			});
		state.done = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })));
		this.children.push(state);
		return state;
	}

	async runCli(args, overrides) {
		const state = this.spawnCli(args, overrides);
		const result = await Promise.race([state.done, delay(60_000, { timedOut: true }, { ref: false })]);
		if (result.timedOut || result.code !== 0)
			throw new Error(`Fixture CLI ${args.join(' ')} failed: ${state.error ?? state.output}`);
	}

	async startServer(mode, overrides) {
		const port = await freePort();
		const url = `http://127.0.0.1:${port}`;

		const state = this.spawnCli(['start'], {
			...overrides,
			PORT: String(port),
			PUBLIC_URL: `${url}/v9/infrastructure/`,
		});

		this.servers[mode] = { url, state };

		for (let attempt = 0; attempt < 120; attempt++) {
			if (state.error || state.child.exitCode !== null || state.child.signalCode !== null)
				throw new Error(`Fixture ${mode} API exited: ${state.error ?? state.output}`);

			try {
				const response = await fetch(`${url}/server/ping`, { signal: AbortSignal.timeout(1000) });
				if (response.ok && (await response.text()) === 'pong') return;
			} catch {
				/* Server has not bound its port yet. */
			}

			await delay(250);
		}

		throw new Error(`Fixture ${mode} API did not become ready: ${state.output}`);
	}

	async request(mode, path, { method = 'GET', token = tokens.admin, query = {}, headers = {}, body, rawBody } = {}) {
		// Concatenation retains any configured deployment prefix; leading paths must not erase it.
		const url = new URL(`${this.servers[mode].url.replace(/\/$/, '')}/${path.replace(/^\//, '')}`);
		for (const [key, value] of Object.entries(query))
			url.searchParams.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));

		const response = await fetch(url, {
			method,
			redirect: 'manual',
			signal: AbortSignal.timeout(15_000),
			headers: {
				...(token ? { Authorization: `Bearer ${token}` } : {}),
				...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
				...headers,
			},
			body: body !== undefined ? JSON.stringify(body) : rawBody,
		});

		const bytes = Buffer.from(await response.arrayBuffer());
		const text = bytes.toString();
		let json;
		if (response.headers.get('content-type')?.includes('json') && text) json = JSON.parse(text);
		return { status: response.status, headers: response.headers, bytes, text, body: json };
	}

	async stop() {
		for (const { child, done } of this.children) {
			if (child.exitCode === null && child.signalCode === null) {
				child.kill('SIGTERM');
				const result = await Promise.race([done, delay(5000, 'timeout', { ref: false })]);

				if (result === 'timeout') {
					child.kill('SIGKILL');
					await done;
				}
			}
		}

		await this.database?.destroy();

		try {
			if (this.created) {
				assert.match(this.name, /^d9_back_compat_\d+_[a-f0-9]{8}$/);
				await this.admin.raw('drop database ?? with (force)', [this.name]);
			}
		} finally {
			await this.admin?.destroy();
			if (this.directory) await rm(this.directory, { recursive: true, force: true });
		}
	}
}

export function ok(response, expected = 200) {
	assert.equal(response.status, expected, `HTTP ${response.status}: ${response.text.slice(0, 1500)}`);
	if (expected === 204) assert.equal(response.bytes.length, 0);
	else assert.match(response.headers.get('content-type') ?? '', /json/);
	return response.body;
}

export function error(response, status, code) {
	ok(response, status);
	assert.ok(Array.isArray(response.body?.errors));
	assert.equal(response.body.errors[0]?.extensions?.code, code);
	assert.equal(typeof response.body.errors[0]?.message, 'string');
	assert.equal(response.body.data, undefined);
}

export function claims(token) {
	return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
}
