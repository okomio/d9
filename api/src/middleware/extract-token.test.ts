import type { Request, Response } from 'express';
import { beforeEach, expect, test, vi } from 'vitest';
import extractToken from '../../src/middleware/extract-token.js';
import env from '../../src/env.js';
import '../../src/types/express.d.ts';

let mockRequest: Partial<Request & { token?: string }>;
let mockResponse: Partial<Response>;
const nextFunction = vi.fn();

beforeEach(() => {
	mockRequest = {};
	mockResponse = {};
	vi.clearAllMocks();
});

test('Token from query', () => {
	mockRequest = {
		query: {
			access_token: 'test',
		},
	};

	extractToken(mockRequest as Request, mockResponse as Response, nextFunction);
	expect(mockRequest.token).toBe('test');
	expect(nextFunction).toBeCalledTimes(1);
});

test('Explicit asset token wins over a cookie from another tab', () => {
	mockRequest = {
		query: { access_token: 'child-token' },
		cookies: { [env['ACCESS_TOKEN_COOKIE_NAME'] as string]: 'main-token' },
		path: '/assets/file-id',
		method: 'GET',
	};

	extractToken(mockRequest as Request, mockResponse as Response, nextFunction);
	expect(mockRequest.token).toBe('child-token');
});

test('File-only asset grant wins over a cookie from another tab', () => {
	mockRequest = {
		query: { asset_grant: 'file-grant' },
		cookies: { [env['ACCESS_TOKEN_COOKIE_NAME'] as string]: 'other-tab-token' },
		path: '/assets/a0000000-0000-4000-8000-000000000001',
		method: 'GET',
	};

	extractToken(mockRequest as Request, mockResponse as Response, nextFunction);
	expect(mockRequest.token).toBe('file-grant');
});

test('Token from Authorization header (capitalized)', () => {
	mockRequest = {
		headers: {
			authorization: 'Bearer test',
		},
	};

	extractToken(mockRequest as Request, mockResponse as Response, nextFunction);
	expect(mockRequest.token).toBe('test');
	expect(nextFunction).toBeCalledTimes(1);
});

test('Token from Authorization header (lowercase)', () => {
	mockRequest = {
		headers: {
			authorization: 'bearer test',
		},
	};

	extractToken(mockRequest as Request, mockResponse as Response, nextFunction);
	expect(mockRequest.token).toBe('test');
	expect(nextFunction).toBeCalledTimes(1);
});

test('Ignore the token if authorization header is too many parts', () => {
	mockRequest = {
		headers: {
			authorization: 'bearer test what another one',
		},
	};

	extractToken(mockRequest as Request, mockResponse as Response, nextFunction);
	expect(mockRequest.token).toBeNull();
	expect(nextFunction).toBeCalledTimes(1);
});

test('Null if no token passed', () => {
	extractToken(mockRequest as Request, mockResponse as Response, nextFunction);
	expect(mockRequest.token).toBeNull();
	expect(nextFunction).toBeCalledTimes(1);
});
