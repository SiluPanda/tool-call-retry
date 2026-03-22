# tool-call-retry

AI-specific retry wrapper with circuit breaker for LLM tool calls. Zero external runtime dependencies.

[![npm version](https://img.shields.io/npm/v/tool-call-retry.svg)](https://www.npmjs.com/package/tool-call-retry)
[![license](https://img.shields.io/npm/l/tool-call-retry.svg)](https://github.com/SiluPanda/tool-call-retry/blob/master/LICENSE)
[![node](https://img.shields.io/node/v/tool-call-retry.svg)](https://nodejs.org)
[![types](https://img.shields.io/npm/types/tool-call-retry.svg)](https://www.npmjs.com/package/tool-call-retry)

---

## Description

`tool-call-retry` wraps async tool functions in LLM-powered applications with configurable retry logic, per-tool circuit breakers, intelligent error classification, and LLM-friendly error formatting. When a tool fails permanently, the error returned to the model is structured, actionable, and sanitized -- free of stack traces, internal URLs, and leaked credentials.

Generic retry libraries like `p-retry` and `cockatiel` handle transient failures but know nothing about AI tool calling. They cannot distinguish a 429 rate limit (transient, retry with backoff) from a 400 validation error (permanent, tell the LLM to fix its arguments). They have no concept of formatting the final error for an LLM to consume. `tool-call-retry` combines all three concerns -- retry with error classification, per-tool circuit breakers, and LLM-friendly error formatting -- into a single cohesive package.

The package is framework-agnostic. It wraps plain async functions and composes with any tool-calling system: OpenAI function calling, Anthropic tool use, MCP `tools/call`, Vercel AI SDK, or custom agent loops.

---

## Installation

```bash
npm install tool-call-retry
```

Requires Node.js >= 18. No runtime dependencies.

---

## Quick Start

```typescript
import { withRetry } from 'tool-call-retry';

const result = await withRetry(
  () => callMyTool(args),
  {
    maxRetries: 3,
    policy: { strategy: 'exponential', initialDelayMs: 1000, jitter: 'full' },
    onPermanentFailure: 'return-error',
    toolName: 'search',
    hooks: {
      onRetry: ({ attempt, delayMs, classification }) =>
        console.log(`Attempt ${attempt} failed (${classification.code}), retrying in ${delayMs}ms`),
      onSuccess: ({ attempts, totalMs }) =>
        console.log(`Succeeded after ${attempts} attempt(s) in ${totalMs}ms`),
    },
  }
);

if (result && typeof result === 'object' && 'error' in result && result.error === true) {
  // LLMFormattedError -- safe to pass back to the LLM
  console.log(result.message, result.suggestion);
} else {
  // Actual tool result
  console.log(result);
}
```

---

## Features

- **Intelligent error classification** -- Automatically categorizes errors as retriable, non-retriable, rate-limited, timeout, or unknown based on HTTP status codes, Node.js network error codes, and error message patterns.
- **Configurable backoff strategies** -- Exponential, linear, or fixed backoff with full, equal, decorrelated, or no jitter. Respects `Retry-After` headers on 429 responses.
- **Per-tool circuit breakers** -- Prevents calling a broken service after repeated failures. Three-state machine (closed / open / half-open) with configurable thresholds, rolling failure windows, and event hooks.
- **LLM-safe error formatting** -- Permanent failures are returned as structured `LLMFormattedError` objects with sanitized messages, classification codes, and actionable suggestions. Stack traces, internal URLs, bearer tokens, and API keys are automatically stripped.
- **Bulk tool wrapping** -- `wrapTools` wraps an entire map of named tool functions in a single call, automatically tagging each error with the originating tool name.
- **AbortSignal support** -- Cancel retry loops externally via standard `AbortSignal`.
- **Lifecycle hooks** -- `onRetry`, `onSuccess`, and `onPermanentFailure` hooks for observability and logging.
- **Zero runtime dependencies** -- All retry logic, backoff calculation, jitter, circuit breaker state management, and error formatting use built-in JavaScript APIs only.
- **Full TypeScript support** -- Written in TypeScript with complete type declarations shipped in the package.

---

## API Reference

### `withRetry<T>(fn, options?)`

Wraps a single async function with retry logic, circuit breaking, and error formatting.

```typescript
import { withRetry } from 'tool-call-retry';

const result = await withRetry<string>(
  () => fetchSearchResults(query),
  {
    maxRetries: 3,
    policy: { strategy: 'exponential', initialDelayMs: 1000 },
    circuitBreaker: { failureThreshold: 5 },
    onPermanentFailure: 'return-error',
    toolName: 'search',
  }
);
```

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `fn` | `() => Promise<T>` | The async function to execute with retry protection. |
| `options` | `ToolRetryOptions & { toolName?: string }` | Optional. Retry policy, circuit breaker config, hooks, and behavior settings. |

**Returns:** `Promise<T | LLMFormattedError>` -- The tool result on success. When `onPermanentFailure` is `'return-error'`, returns an `LLMFormattedError` on permanent failure instead of throwing.

---

### `wrapTools<T>(tools, options?)`

Wraps an entire map of named tool functions so every call goes through retry. Each wrapped tool automatically receives the tool name in formatted errors.

```typescript
import { wrapTools } from 'tool-call-retry';

const tools = {
  search: (args: unknown) => fetch(`/api/search?q=${(args as any).query}`).then(r => r.json()),
  weather: (args: unknown) => fetch(`/api/weather?city=${(args as any).city}`).then(r => r.json()),
};

const resilientTools = wrapTools(tools, {
  maxRetries: 3,
  onPermanentFailure: 'return-error',
  circuitBreaker: { failureThreshold: 5 },
});

// resilientTools.search and resilientTools.weather are now retry-wrapped
const result = await resilientTools.search({ query: 'TypeScript' });
```

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `tools` | `Record<string, (args: unknown) => Promise<unknown>>` | A map of named tool functions. |
| `options` | `ToolRetryOptions` | Optional. Shared retry options applied to all tools. |

**Returns:** A new object with the same keys, where each function is wrapped with retry logic.

---

### `createRetryPolicy(options?)`

Factory that creates a fully resolved retry policy with defaults filled in. Useful for sharing a single policy across multiple `withRetry` calls.

```typescript
import { createRetryPolicy } from 'tool-call-retry';

const policy = createRetryPolicy({
  maxRetries: 5,
  strategy: 'linear',
  initialDelayMs: 500,
});

// policy is a Required<RetryPolicy> with all fields populated
await withRetry(() => callToolA(), { policy });
await withRetry(() => callToolB(), { policy });
```

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `options` | `Partial<RetryPolicy>` | Optional. Any fields not provided use defaults. |

**Returns:** `Required<RetryPolicy>` -- A fully populated policy object.

**Defaults:**

| Field | Default |
|---|---|
| `maxRetries` | `3` |
| `strategy` | `'exponential'` |
| `initialDelayMs` | `1000` |
| `maxDelayMs` | `30000` |
| `multiplier` | `2` |
| `jitter` | `'full'` |
| `maxTotalTimeMs` | `60000` |

---

### `createCircuitBreaker(config?)`

Creates a standalone circuit breaker instance with closed/open/half-open state management. Useful when you need to share a single circuit breaker across multiple tools or monitor state transitions independently.

```typescript
import { createCircuitBreaker } from 'tool-call-retry';

const cb = createCircuitBreaker({
  failureThreshold: 5,
  rollingWindowMs: 60000,
  resetTimeoutMs: 30000,
  successThreshold: 1,
});

// Subscribe to state transitions
const unsubscribe = cb.on('open', () => console.warn('Circuit opened -- service is failing'));
cb.on('half-open', () => console.info('Circuit half-open -- testing recovery'));
cb.on('close', () => console.info('Circuit closed -- service recovered'));

// Query state
console.log(cb.state);           // 'closed' | 'open' | 'half-open'
console.log(cb.isCallPermitted); // true when closed or half-open

// Manual recording
cb.recordSuccess();
cb.recordFailure();

// Unsubscribe from events
unsubscribe();
```

**Returns:** `CircuitBreakerInstance`

**`CircuitBreakerInstance` interface:**

| Member | Type | Description |
|---|---|---|
| `state` | `CircuitState` (readonly) | Current state: `'closed'`, `'open'`, or `'half-open'`. Accessing this property triggers an automatic check for half-open transition. |
| `isCallPermitted` | `boolean` (readonly) | `true` when the circuit is closed or half-open, `false` when open. |
| `recordSuccess()` | `() => void` | Records a successful call. In half-open state, closes the circuit after `successThreshold` consecutive successes. |
| `recordFailure()` | `() => void` | Records a failed call. In closed state, increments the rolling failure counter. In half-open state, immediately reopens the circuit. |
| `on(event, fn)` | `(event, fn) => () => void` | Subscribes to state transition events (`'open'`, `'half-open'`, `'close'`). Returns an unsubscribe function. |

**`CircuitBreakerConfig` options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Whether the circuit breaker is active. |
| `failureThreshold` | `number` | `5` | Number of failures within the rolling window before opening the circuit. |
| `rollingWindowMs` | `number` | `60000` | Time window in milliseconds for counting failures. Failures older than this are discarded. |
| `resetTimeoutMs` | `number` | `30000` | Time in milliseconds the circuit stays open before transitioning to half-open. |
| `successThreshold` | `number` | `1` | Number of consecutive successes in half-open state required to close the circuit. |

---

### `classifyError(error, customClassifier?)`

Classifies an error into one of five actionable categories. Used internally by `withRetry` but also available as a standalone utility.

```typescript
import { classifyError } from 'tool-call-retry';

try {
  await callExternalService();
} catch (error) {
  const classification = classifyError(error);
  console.log(classification.category);    // 'retriable' | 'non-retriable' | 'rate-limited' | 'timeout' | 'unknown'
  console.log(classification.code);        // 'RATE_LIMITED', 'SERVER_ERROR', 'CLIENT_ERROR', etc.
  console.log(classification.message);     // Error message string
  console.log(classification.statusCode);  // HTTP status code, if present
  console.log(classification.retryAfterMs); // Retry delay in ms, if present (e.g., from 429 responses)
}
```

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `error` | `unknown` | The error to classify. Handles `Error` instances, plain objects with `status`/`statusCode`/`code` properties, strings, and other thrown values. |
| `customClassifier` | `ErrorClassifier` | Optional. A function `(error: unknown) => ErrorClassification \| null`. When provided, it is consulted first. Return `null` to fall through to built-in classifiers. |

**Returns:** `ErrorClassification`

**Classification priority (highest to lowest):**

1. Custom classifier (if provided and returns non-null)
2. `AbortError` detection -- classified as `non-retriable`
3. HTTP status code classifier
4. Node.js network error code classifier
5. Timeout detection (message contains "timeout")
6. Fallback to `unknown`

**Built-in HTTP status code mappings:**

| Status Code | Category | Code |
|---|---|---|
| 400, 401, 403, 404, 405, 409, 422 | `non-retriable` | `CLIENT_ERROR` |
| 429 | `rate-limited` | `RATE_LIMITED` |
| 500, 502, 503, 504 | `retriable` | `SERVER_ERROR` |

**Built-in network error code mappings:**

| Error Code | Category | Code |
|---|---|---|
| `ECONNREFUSED`, `ECONNRESET`, `EPIPE` | `retriable` | `NETWORK_ERROR` |
| `ENOTFOUND`, `EAI_AGAIN` | `retriable` | `DNS_ERROR` |
| `ETIMEDOUT` | `timeout` | `TIMEOUT` |

---

### `formatErrorForLLM(error, options?)`

Transforms a raw error into a structured, sanitized `LLMFormattedError` suitable for returning to an LLM. Automatically strips stack traces, internal URLs, bearer tokens, and API key patterns.

```typescript
import { formatErrorForLLM } from 'tool-call-retry';

try {
  await callExternalService();
} catch (error) {
  const formatted = formatErrorForLLM(error, {
    toolName: 'search',
    attemptsMade: 3,
  });

  // formatted:
  // {
  //   error: true,
  //   code: 'SERVICE_UNAVAILABLE',
  //   message: 'Service temporarily unavailable',
  //   retriable: true,
  //   suggestion: 'Retry the operation',
  //   tool: 'search',
  //   attemptsMade: 3,
  // }
}
```

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `error` | `unknown` | The raw error to format. |
| `options.toolName` | `string` | Optional. Tool name to include in the formatted error. |
| `options.attemptsMade` | `number` | Optional. Number of attempts made before the error was surfaced. |

**Returns:** `LLMFormattedError`

**Sanitization rules applied to error messages:**

- Stack traces (`at ...` lines) are removed
- Localhost URLs (`http://localhost:*`, `http://127.0.0.1:*`) are replaced with `[localhost]`
- Passwords in URLs (`://user:password@`) are replaced with `[redacted]`
- Bearer tokens are replaced with `bearer [redacted]`
- API key patterns (`sk-*`, `pk-*`, `api-*`, `key-*`, `token-*`, `secret-*`) are replaced with `[redacted]`

---

## Configuration

### `ToolRetryOptions`

The primary options object accepted by `withRetry` and `wrapTools`.

```typescript
interface ToolRetryOptions {
  policy?: RetryPolicy;
  maxRetries?: number;                           // Shorthand; overrides policy.maxRetries
  circuitBreaker?: CircuitBreakerConfig | false;  // false to disable
  classifyError?: ErrorClassifier;                // Custom error classifier
  onPermanentFailure?: 'throw' | 'return-error';
  signal?: AbortSignal;                           // External cancellation
  hooks?: ToolRetryHooks;
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `policy` | `RetryPolicy` | See `RetryPolicy` defaults | Full retry policy configuration. |
| `maxRetries` | `number` | `3` | Shorthand for `policy.maxRetries`. When both are set, `maxRetries` takes precedence. |
| `circuitBreaker` | `CircuitBreakerConfig \| false` | Enabled with defaults | Circuit breaker configuration, or `false` to disable. |
| `classifyError` | `ErrorClassifier` | Built-in classifier | Custom classifier consulted before built-in classifiers. Return `null` to fall through. |
| `onPermanentFailure` | `'throw' \| 'return-error'` | `'throw'` | `'throw'` re-throws the original error. `'return-error'` returns an `LLMFormattedError` object instead. |
| `signal` | `AbortSignal` | `undefined` | When aborted, the retry loop terminates immediately and the error is re-thrown. |
| `hooks` | `ToolRetryHooks` | `undefined` | Lifecycle callbacks for observability. |

### `RetryPolicy`

```typescript
interface RetryPolicy {
  maxRetries?: number;        // default 3
  strategy?: BackoffStrategy; // default 'exponential'
  initialDelayMs?: number;    // default 1000
  maxDelayMs?: number;        // default 30000
  multiplier?: number;        // default 2 (exponential only)
  jitter?: JitterStrategy;    // default 'full'
  maxTotalTimeMs?: number;    // default 60000
}
```

### `ToolRetryHooks`

```typescript
interface ToolRetryHooks {
  onRetry?: (info: {
    attempt: number;
    error: unknown;
    delayMs: number;
    classification: ErrorClassification;
  }) => void;

  onSuccess?: (info: {
    attempts: number;
    totalMs: number;
  }) => void;

  onPermanentFailure?: (info: {
    error: unknown;
    attempts: number;
    totalMs: number;
    formattedError: LLMFormattedError;
  }) => void;
}
```

---

## Error Handling

### Throw mode (default)

By default, `withRetry` re-throws the original error when all retries are exhausted or the error is non-retriable.

```typescript
try {
  const result = await withRetry(() => callTool(), { maxRetries: 3 });
  // Use result
} catch (error) {
  // Original error from the tool function
  console.error('Tool call failed permanently:', error);
}
```

### Return-error mode

When `onPermanentFailure` is set to `'return-error'`, permanent failures return a structured `LLMFormattedError` instead of throwing. This is the recommended mode for agent loops where the LLM should receive the error as structured data.

```typescript
const result = await withRetry(() => callTool(), {
  maxRetries: 3,
  onPermanentFailure: 'return-error',
});

if (result && typeof result === 'object' && 'error' in result && result.error === true) {
  // Pass the formatted error back to the LLM
  return { role: 'tool', content: JSON.stringify(result) };
}
```

### `LLMFormattedError` shape

```typescript
interface LLMFormattedError {
  error: true;
  code: string;            // 'RATE_LIMITED', 'SERVICE_UNAVAILABLE', 'INVALID_REQUEST', 'TIMEOUT', 'UNKNOWN_ERROR'
  message: string;         // Sanitized, human-readable message
  retriable: boolean;      // Whether the LLM should consider retrying
  suggestion: string;      // Actionable next-step hint for the LLM
  tool?: string;           // Tool name, if provided via toolName option
  attemptsMade?: number;   // Total attempts including the initial call
}
```

**Error code to message mapping:**

| Code | Message | Retriable | Suggestion |
|---|---|---|---|
| `RATE_LIMITED` | Rate limit exceeded | `true` | Wait before retrying or reduce request frequency |
| `SERVICE_UNAVAILABLE` | Service temporarily unavailable | `true` | Retry the operation |
| `TIMEOUT` | Request timed out | `true` | Try again or reduce payload size |
| `INVALID_REQUEST` | *(sanitized original message)* | `false` | Check the tool arguments |
| `UNKNOWN_ERROR` | An unexpected error occurred | `true` | Retry once; if it persists, report the issue |

### Circuit breaker errors

When the circuit breaker is open, calls are immediately rejected without executing the tool function. In throw mode, this throws an `Error` with the message `'Circuit breaker is open'`. In return-error mode, it returns an `LLMFormattedError`.

```typescript
const result = await withRetry(() => callTool(), {
  circuitBreaker: { failureThreshold: 3 },
  onPermanentFailure: 'return-error',
});

// If circuit is open:
// { error: true, code: 'TIMEOUT', message: 'Request timed out', retriable: true, ... }
```

### AbortSignal cancellation

When the `signal` is aborted, the retry loop terminates immediately and the error is re-thrown (never returned as a formatted error).

```typescript
const controller = new AbortController();
setTimeout(() => controller.abort(), 5000);

try {
  await withRetry(() => callTool(), {
    maxRetries: 10,
    signal: controller.signal,
  });
} catch (error) {
  if (error instanceof DOMException && error.name === 'AbortError') {
    console.log('Retry loop was cancelled');
  }
}
```

---

## Advanced Usage

### Custom error classifier

Provide a per-tool classifier to handle domain-specific error patterns. The custom classifier is consulted before all built-in classifiers. Return `null` to fall through to the defaults.

```typescript
import { withRetry } from 'tool-call-retry';
import type { ErrorClassification } from 'tool-call-retry';

const result = await withRetry(() => callGitHubAPI(), {
  classifyError: (error: unknown): ErrorClassification | null => {
    const err = error as { status?: number; message?: string };

    // GitHub returns 404 for private repos -- non-retriable, not "not found"
    if (err.status === 404 && err.message?.includes('Not Found')) {
      return { category: 'non-retriable', code: 'REPO_NOT_FOUND', message: 'Repository not found or inaccessible' };
    }

    // Elasticsearch 503 during shard relocation -- always transient
    if (err.status === 503 && err.message?.includes('shard')) {
      return { category: 'retriable', code: 'SHARD_RELOCATING', message: 'Search index temporarily unavailable' };
    }

    return null; // Use built-in classifiers
  },
  onPermanentFailure: 'return-error',
});
```

### Shared circuit breaker across tools

By default, each `withRetry` call creates its own circuit breaker. To share a single circuit breaker across related tools (e.g., tools that call the same downstream service), create one with `createCircuitBreaker` and pass it via the `circuitBreaker` config.

```typescript
import { createCircuitBreaker, wrapTools } from 'tool-call-retry';

const searchServiceBreaker = createCircuitBreaker({
  failureThreshold: 5,
  rollingWindowMs: 60000,
  resetTimeoutMs: 30000,
});

// Monitor the shared breaker
searchServiceBreaker.on('open', () => {
  console.warn('Search service circuit opened -- all search tools blocked');
});
```

### Disabling the circuit breaker

Pass `circuitBreaker: false` to disable it entirely for a specific tool.

```typescript
const result = await withRetry(() => callIdempotentTool(), {
  circuitBreaker: false,
  maxRetries: 5,
});
```

### Observability with hooks

Use lifecycle hooks to integrate with your logging, metrics, or monitoring infrastructure.

```typescript
import { withRetry } from 'tool-call-retry';

const result = await withRetry(() => callTool(), {
  maxRetries: 3,
  onPermanentFailure: 'return-error',
  hooks: {
    onRetry: ({ attempt, error, delayMs, classification }) => {
      logger.warn('Tool call retry', {
        attempt,
        classification: classification.code,
        delayMs,
        error: error instanceof Error ? error.message : String(error),
      });
      metrics.increment('tool_call.retry', { classification: classification.code });
    },
    onSuccess: ({ attempts, totalMs }) => {
      metrics.histogram('tool_call.duration_ms', totalMs);
      metrics.histogram('tool_call.attempts', attempts);
    },
    onPermanentFailure: ({ error, attempts, totalMs, formattedError }) => {
      logger.error('Tool call permanent failure', {
        code: formattedError.code,
        attempts,
        totalMs,
      });
      metrics.increment('tool_call.permanent_failure', { code: formattedError.code });
    },
  },
});
```

### Backoff strategies

**Exponential (default):** Delay doubles each attempt. `delay = min(initialDelayMs * multiplier^(attempt-1), maxDelayMs)`

```typescript
{ strategy: 'exponential', initialDelayMs: 1000, multiplier: 2, maxDelayMs: 30000 }
// Attempt 1: 1000ms, Attempt 2: 2000ms, Attempt 3: 4000ms, Attempt 4: 8000ms, ...
```

**Linear:** Delay increases linearly. `delay = min(initialDelayMs * attempt, maxDelayMs)`

```typescript
{ strategy: 'linear', initialDelayMs: 1000, maxDelayMs: 30000 }
// Attempt 1: 1000ms, Attempt 2: 2000ms, Attempt 3: 3000ms, Attempt 4: 4000ms, ...
```

**Fixed:** Same delay every time. `delay = initialDelayMs`

```typescript
{ strategy: 'fixed', initialDelayMs: 2000 }
// Attempt 1: 2000ms, Attempt 2: 2000ms, Attempt 3: 2000ms, ...
```

### Jitter strategies

Jitter prevents thundering herds by randomizing backoff delays.

| Strategy | Formula | Range |
|---|---|---|
| `'full'` (default) | `random(0, baseDelay)` | `[0, baseDelay]` |
| `'equal'` | `baseDelay/2 + random(0, baseDelay/2)` | `[baseDelay/2, baseDelay]` |
| `'decorrelated'` | `random(initialDelay, previousDelay * 3)` | `[initialDelay, previousDelay * 3]` (capped at `maxDelayMs`) |
| `'none'` | `baseDelay` | Exact computed delay, no randomization |

### Rate limit handling with Retry-After

When a 429 response includes a `Retry-After` header or a `retryAfter` property on the error object, the retry delay is set to the maximum of the computed backoff and the `Retry-After` value. This ensures the retry never happens sooner than the server requests.

```typescript
// Errors with any of these shapes are supported:
// { status: 429, headers: { 'retry-after': '5' } }     -- header in seconds (string)
// { status: 429, headers: { 'Retry-After': 10 } }      -- header as number
// { status: 429, retryAfter: 5000 }                     -- property in milliseconds
```

### Time budget

The `maxTotalTimeMs` option sets a wall-clock budget for the entire retry loop. If the budget is exhausted between attempts, the loop terminates and the last error is surfaced.

```typescript
const result = await withRetry(() => callSlowService(), {
  maxRetries: 10,
  policy: { maxTotalTimeMs: 15000 }, // Give up after 15 seconds total
  onPermanentFailure: 'return-error',
});
```

---

## TypeScript

The package is written in TypeScript and ships type declarations (`dist/index.d.ts`). All public types are exported from the package entry point.

```typescript
import {
  // Functions
  withRetry,
  wrapTools,
  createRetryPolicy,
  createCircuitBreaker,
  classifyError,
  formatErrorForLLM,
} from 'tool-call-retry';

import type {
  // Types
  ErrorCategory,
  ErrorClassification,
  ErrorClassifier,
  BackoffStrategy,
  JitterStrategy,
  CircuitState,
  RetryPolicy,
  CircuitBreakerConfig,
  LLMFormattedError,
  ToolRetryOptions,
  ToolRetryHooks,
  CircuitBreakerInstance,
} from 'tool-call-retry';
```

**`ErrorCategory`** -- `'retriable' | 'non-retriable' | 'rate-limited' | 'timeout' | 'unknown'`

**`BackoffStrategy`** -- `'exponential' | 'linear' | 'fixed' | 'custom'`

**`JitterStrategy`** -- `'full' | 'equal' | 'decorrelated' | 'none'`

**`CircuitState`** -- `'closed' | 'open' | 'half-open'`

---

## License

MIT
