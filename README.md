# tool-call-retry

AI-specific retry wrapper with circuit breaker for LLM tool calls. Zero external runtime dependencies.

## Install

```bash
npm install tool-call-retry
```

## Quick start — `withRetry`

```typescript
import { withRetry } from 'tool-call-retry';

const result = await withRetry(
  () => callMyTool(args),
  {
    maxRetries: 3,
    policy: { strategy: 'exponential', initialDelayMs: 1000, jitter: 'full' },
    onPermanentFailure: 'return-error',   // returns LLMFormattedError instead of throwing
    toolName: 'search',
    hooks: {
      onRetry: ({ attempt, delayMs, classification }) =>
        console.log(`Attempt ${attempt} failed (${classification.code}), retrying in ${delayMs}ms`),
      onSuccess: ({ attempts, totalMs }) =>
        console.log(`Succeeded after ${attempts} attempt(s) in ${totalMs}ms`),
    },
  }
);

if (result && typeof result === 'object' && result.error === true) {
  // LLMFormattedError — safe to pass back to the LLM
  console.log(result.message, result.suggestion);
} else {
  // actual result
}
```

## `wrapTools`

Wraps an entire tools map so every call goes through retry:

```typescript
import { wrapTools } from 'tool-call-retry';

const tools = {
  search: (args) => fetch(...),
  calculate: (args) => compute(...),
};

const retryingTools = wrapTools(tools, {
  maxRetries: 3,
  onPermanentFailure: 'return-error',
});

// retryingTools.search / retryingTools.calculate are now retry-wrapped
```

## Circuit breaker

The circuit breaker is enabled by default (threshold: 5 failures in 60 s, resets after 30 s).

```typescript
import { withRetry } from 'tool-call-retry';

await withRetry(() => callTool(), {
  circuitBreaker: {
    failureThreshold: 3,
    rollingWindowMs: 30000,
    resetTimeoutMs: 15000,
    successThreshold: 1,
  },
});

// Disable entirely:
await withRetry(() => callTool(), { circuitBreaker: false });
```

You can also create and reuse a circuit breaker instance:

```typescript
import { createCircuitBreaker } from 'tool-call-retry';

const cb = createCircuitBreaker({ failureThreshold: 5 });
cb.on('open', () => console.warn('Circuit opened'));
cb.on('close', () => console.info('Circuit closed'));

console.log(cb.state);           // 'closed' | 'open' | 'half-open'
console.log(cb.isCallPermitted); // boolean
cb.recordSuccess();
cb.recordFailure();
```

## Error classification

```typescript
import { classifyError } from 'tool-call-retry';

const c = classifyError(error);
// c.category: 'retriable' | 'non-retriable' | 'rate-limited' | 'timeout' | 'unknown'
// c.code: e.g. 'RATE_LIMITED', 'SERVER_ERROR', 'CLIENT_ERROR', 'NETWORK_ERROR', 'TIMEOUT', ...
// c.retryAfterMs: number | undefined  (populated for 429 responses)
```

Custom classifier:

```typescript
await withRetry(() => callTool(), {
  classifyError: (err) => {
    if (isMyCustomError(err)) return { category: 'retriable', code: 'MY_ERROR', message: '...' };
    return null; // fall through to default classification
  },
});
```

## Retry policy options

| Option | Default | Description |
|---|---|---|
| `maxRetries` | `3` | Maximum retry attempts |
| `strategy` | `'exponential'` | `'exponential'` \| `'linear'` \| `'fixed'` |
| `initialDelayMs` | `1000` | Base delay in ms |
| `maxDelayMs` | `30000` | Delay cap in ms |
| `multiplier` | `2` | Exponent base (exponential only) |
| `jitter` | `'full'` | `'full'` \| `'equal'` \| `'decorrelated'` \| `'none'` |
| `maxTotalTimeMs` | `60000` | Total time budget before giving up |

## LLMFormattedError shape

```typescript
{
  error: true,
  code: string,        // e.g. 'RATE_LIMITED', 'SERVICE_UNAVAILABLE'
  message: string,     // sanitized (no stack traces, tokens, passwords)
  retriable: boolean,
  suggestion: string,  // human-readable next-step hint
  tool?: string,       // tool name if provided
  attemptsMade?: number,
}
```
