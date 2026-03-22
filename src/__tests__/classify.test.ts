import { describe, it, expect } from 'vitest';
import { classifyError } from '../classify.js';

describe('classifyError', () => {
  it('classifies HTTP 429 as rate-limited', () => {
    const err = Object.assign(new Error('Too Many Requests'), { status: 429 });
    const result = classifyError(err);
    expect(result.category).toBe('rate-limited');
    expect(result.code).toBe('RATE_LIMITED');
    expect(result.statusCode).toBe(429);
  });

  it('extracts retryAfterMs from headers', () => {
    const err = Object.assign(new Error('Rate limited'), {
      status: 429,
      headers: { 'retry-after': '5' },
    });
    const result = classifyError(err);
    expect(result.retryAfterMs).toBe(5000);
  });

  it('extracts retryAfterMs from retryAfter property', () => {
    const err = Object.assign(new Error('Rate limited'), {
      status: 429,
      retryAfter: 10000,
    });
    const result = classifyError(err);
    expect(result.retryAfterMs).toBe(10000);
  });

  it('classifies HTTP 404 as non-retriable', () => {
    const err = Object.assign(new Error('Not Found'), { status: 404 });
    const result = classifyError(err);
    expect(result.category).toBe('non-retriable');
    expect(result.code).toBe('CLIENT_ERROR');
    expect(result.statusCode).toBe(404);
  });

  it('classifies HTTP 401 as non-retriable', () => {
    const err = Object.assign(new Error('Unauthorized'), { status: 401 });
    const result = classifyError(err);
    expect(result.category).toBe('non-retriable');
    expect(result.statusCode).toBe(401);
  });

  it('classifies HTTP 422 as non-retriable', () => {
    const err = Object.assign(new Error('Unprocessable'), { status: 422 });
    const result = classifyError(err);
    expect(result.category).toBe('non-retriable');
    expect(result.statusCode).toBe(422);
  });

  it('classifies HTTP 503 as retriable', () => {
    const err = Object.assign(new Error('Service Unavailable'), { status: 503 });
    const result = classifyError(err);
    expect(result.category).toBe('retriable');
    expect(result.code).toBe('SERVER_ERROR');
    expect(result.statusCode).toBe(503);
  });

  it('classifies HTTP 500 as retriable', () => {
    const err = Object.assign(new Error('Internal Server Error'), { status: 500 });
    const result = classifyError(err);
    expect(result.category).toBe('retriable');
  });

  it('classifies HTTP 502 as retriable', () => {
    const err = Object.assign(new Error('Bad Gateway'), { statusCode: 502 });
    const result = classifyError(err);
    expect(result.category).toBe('retriable');
  });

  it('classifies ECONNREFUSED as retriable', () => {
    const err = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
    const result = classifyError(err);
    expect(result.category).toBe('retriable');
    expect(result.code).toBe('NETWORK_ERROR');
  });

  it('classifies ECONNRESET as retriable', () => {
    const err = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    const result = classifyError(err);
    expect(result.category).toBe('retriable');
    expect(result.code).toBe('NETWORK_ERROR');
  });

  it('classifies EPIPE as retriable', () => {
    const err = Object.assign(new Error('broken pipe'), { code: 'EPIPE' });
    const result = classifyError(err);
    expect(result.category).toBe('retriable');
    expect(result.code).toBe('NETWORK_ERROR');
  });

  it('classifies ETIMEDOUT as timeout', () => {
    const err = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
    const result = classifyError(err);
    expect(result.category).toBe('timeout');
    expect(result.code).toBe('TIMEOUT');
  });

  it('classifies ENOTFOUND as non-retriable DNS error', () => {
    const err = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    const result = classifyError(err);
    expect(result.category).toBe('non-retriable');
    expect(result.code).toBe('DNS_ERROR');
  });

  it('classifies EAI_AGAIN as retriable DNS error', () => {
    const err = Object.assign(new Error('DNS lookup failed'), { code: 'EAI_AGAIN' });
    const result = classifyError(err);
    expect(result.category).toBe('retriable');
    expect(result.code).toBe('DNS_ERROR');
  });

  it('classifies EHOSTUNREACH as retriable network error', () => {
    const err = Object.assign(new Error('No route to host'), { code: 'EHOSTUNREACH' });
    const result = classifyError(err);
    expect(result.category).toBe('retriable');
    expect(result.code).toBe('NETWORK_ERROR');
  });

  it('classifies CERT_HAS_EXPIRED as non-retriable TLS error', () => {
    const err = Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' });
    const result = classifyError(err);
    expect(result.category).toBe('non-retriable');
    expect(result.code).toBe('TLS_ERROR');
  });

  it('classifies UNABLE_TO_VERIFY_LEAF_SIGNATURE as non-retriable TLS error', () => {
    const err = Object.assign(new Error('unable to verify leaf signature'), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' });
    const result = classifyError(err);
    expect(result.category).toBe('non-retriable');
    expect(result.code).toBe('TLS_ERROR');
  });

  it('classifies HTTP 529 as retriable (Anthropic overloaded)', () => {
    const err = Object.assign(new Error('Overloaded'), { status: 529 });
    const result = classifyError(err);
    expect(result.category).toBe('retriable');
    expect(result.code).toBe('SERVER_ERROR');
    expect(result.statusCode).toBe(529);
  });

  it('classifies message containing "timeout" as timeout', () => {
    const err = new Error('Request timeout exceeded');
    const result = classifyError(err);
    expect(result.category).toBe('timeout');
    expect(result.code).toBe('TIMEOUT');
  });

  it('classifies AbortError as non-retriable', () => {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    const result = classifyError(err);
    expect(result.category).toBe('non-retriable');
    expect(result.code).toBe('ABORTED');
  });

  it('falls back to unknown for unrecognized errors', () => {
    const err = new Error('Something weird happened');
    const result = classifyError(err);
    expect(result.category).toBe('unknown');
    expect(result.code).toBe('UNKNOWN_ERROR');
  });

  it('uses custom classifier when provided and returns non-null', () => {
    const err = new Error('custom error');
    const custom = () => ({
      category: 'retriable' as const,
      code: 'CUSTOM',
      message: 'custom',
    });
    const result = classifyError(err, custom);
    expect(result.code).toBe('CUSTOM');
    expect(result.category).toBe('retriable');
  });

  it('falls through to default classification when custom classifier returns null', () => {
    const err = Object.assign(new Error('Service Unavailable'), { status: 503 });
    const custom = () => null;
    const result = classifyError(err, custom);
    expect(result.category).toBe('retriable');
    expect(result.code).toBe('SERVER_ERROR');
  });
});
