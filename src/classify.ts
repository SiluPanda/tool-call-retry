import type { ErrorClassification, ErrorClassifier } from './types.js';

function getStatusCode(error: unknown): number | undefined {
  if (error != null && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    if (typeof e['status'] === 'number') return e['status'];
    if (typeof e['statusCode'] === 'number') return e['statusCode'];
  }
  return undefined;
}

function getRetryAfterMs(error: unknown): number | undefined {
  if (error != null && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    // Check retryAfter property (ms)
    if (typeof e['retryAfter'] === 'number') return e['retryAfter'];
    // Check headers object for Retry-After header
    if (e['headers'] != null && typeof e['headers'] === 'object') {
      const headers = e['headers'] as Record<string, unknown>;
      const retryAfter = headers['retry-after'] ?? headers['Retry-After'];
      if (typeof retryAfter === 'string') {
        const parsed = parseFloat(retryAfter);
        if (!isNaN(parsed)) return parsed * 1000;
      }
      if (typeof retryAfter === 'number') return retryAfter * 1000;
    }
  }
  return undefined;
}

function getErrorCode(error: unknown): string | undefined {
  if (error != null && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    if (typeof e['code'] === 'string') return e['code'];
  }
  return undefined;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

export function classifyError(error: unknown, custom?: ErrorClassifier): ErrorClassification {
  // 1. Custom classifier
  if (custom) {
    const result = custom(error);
    if (result !== null) return result;
  }

  // 2. AbortError / signal aborted
  if (
    error instanceof Error &&
    (error.name === 'AbortError' || (error as Error & { type?: string }).type === 'aborted')
  ) {
    return { category: 'non-retriable', code: 'ABORTED', message: 'Request aborted' };
  }

  // 3. HTTP status codes
  const statusCode = getStatusCode(error);
  if (statusCode !== undefined) {
    if (statusCode === 429) {
      return {
        category: 'rate-limited',
        code: 'RATE_LIMITED',
        message: getErrorMessage(error),
        statusCode,
        retryAfterMs: getRetryAfterMs(error),
      };
    }
    if ([400, 401, 403, 404, 405, 409, 422].includes(statusCode)) {
      return {
        category: 'non-retriable',
        code: 'CLIENT_ERROR',
        message: getErrorMessage(error),
        statusCode,
      };
    }
    if ([500, 502, 503, 504, 529].includes(statusCode)) {
      return {
        category: 'retriable',
        code: 'SERVER_ERROR',
        message: getErrorMessage(error),
        statusCode,
      };
    }
  }

  // 4. Node.js network error codes
  const code = getErrorCode(error);
  if (code) {
    if (['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'EHOSTUNREACH'].includes(code)) {
      return { category: 'retriable', code: 'NETWORK_ERROR', message: getErrorMessage(error) };
    }
    if (code === 'ETIMEDOUT') {
      return { category: 'timeout', code: 'TIMEOUT', message: getErrorMessage(error) };
    }
    if (code === 'EAI_AGAIN') {
      return { category: 'retriable', code: 'DNS_ERROR', message: getErrorMessage(error) };
    }
    if (code === 'ENOTFOUND') {
      return { category: 'non-retriable', code: 'DNS_ERROR', message: getErrorMessage(error) };
    }
    if (['CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(code)) {
      return { category: 'non-retriable', code: 'TLS_ERROR', message: getErrorMessage(error) };
    }
  }

  // 5. Message contains 'timeout'
  const message = getErrorMessage(error);
  if (message.toLowerCase().includes('timeout')) {
    return { category: 'timeout', code: 'TIMEOUT', message };
  }

  // 6. Fallback
  return { category: 'unknown', code: 'UNKNOWN_ERROR', message: String(error) };
}
