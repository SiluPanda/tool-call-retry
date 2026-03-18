# tool-call-retry -- Specification

## 1. Overview

`tool-call-retry` is an AI-specific retry wrapper for tool/function call execution in LLM-powered applications. It wraps individual tool functions with configurable retry logic, per-tool circuit breakers, intelligent error classification, and LLM-friendly error formatting so that when a tool fails permanently, the error returned to the model is structured, actionable, and safe. The package is framework-agnostic: it wraps plain async functions and composes with any tool-calling system -- OpenAI function calling, Anthropic tool use, MCP `tools/call`, Vercel AI SDK, or custom agent loops.

The gap this package fills is specific and well-defined. Generic retry libraries like `p-retry`, `async-retry`, and `cockatiel` handle transient failures by re-executing a function with exponential backoff. They are excellent at what they do, but they know nothing about AI tool calling. When a tool function fails, three questions must be answered before deciding what to do: (1) Is this error transient or permanent? A 429 rate limit from a downstream API is transient and should be retried with backoff. A 400 validation error from bad arguments the LLM generated is permanent and should not be retried -- the LLM needs to know why the call failed so it can try different arguments. (2) If the error is permanent and must be returned to the LLM, how should it be formatted? Raw stack traces, internal URLs, and database connection strings must not leak into the model's context window. The error message must tell the model what happened, why, and what it can do about it -- retry with different arguments, use an alternative tool, or inform the user. (3) Should the tool even be attempted? If a downstream service has failed five times in the last minute, sending a sixth request wastes time and exacerbates the outage. A circuit breaker should block the call immediately and return a clear "service unavailable" message to the LLM.

Generic retry libraries answer none of these questions. `p-retry` accepts a `shouldRetry` predicate but has no built-in understanding of HTTP status codes, API error patterns, or the distinction between "the API is down" and "the LLM sent bad arguments." It has no circuit breaker. It has no concept of formatting the final error for an LLM to consume. `cockatiel` provides both retry and circuit breaker policies that compose together, but its error formatting is designed for human operators and monitoring dashboards, not for injection into an LLM's context window. `opossum` provides a circuit breaker with rich event hooks, but it is a standalone circuit breaker -- it does not compose with retry logic out of the box, and again, it knows nothing about LLM error formatting.

`tool-call-retry` combines all three concerns -- retry with error classification, per-tool circuit breakers, and LLM-friendly error formatting -- into a single cohesive package designed specifically for the tool-calling loop in AI applications. It provides a `withRetry` function that wraps a single tool function, a `wrapTools` function that wraps a map of tool functions with per-tool policies, a `createRetryPolicy` factory for reusable configuration, and a `formatErrorForLLM` function for standalone error formatting. Each tool can have independent retry limits, backoff strategies, error classifiers, circuit breaker thresholds, and error formatters. The package respects MCP tool annotations (`readOnlyHint`, `idempotentHint`, `destructiveHint`) to automatically adjust retry behavior -- read-only tools are always safe to retry, destructive tools are never retried by default, and idempotent tools are retried with standard backoff.

The package composes with other packages in this monorepo. `llm-retry` handles retrying the LLM call itself when the model's output fails validation -- a different concern entirely (retrying the model, not the tool). `mcp-rate-guard` rate-limits incoming requests to an MCP server -- it operates on the server side, preventing too many tool calls from arriving. `tool-call-retry` operates on the client side or within an agent, wrapping the execution of tools that call external services. The two are complementary: `mcp-rate-guard` protects the server from being overwhelmed; `tool-call-retry` makes the client resilient to the server (or any downstream dependency) being temporarily unavailable.

---

## 2. Goals and Non-Goals

### Goals

- Provide a `withRetry(toolFn, options?)` function that wraps an async tool function with retry logic, circuit breaking, and LLM-friendly error formatting, returning a new function with the same signature.
- Provide a `wrapTools(tools, options?)` function that wraps a map of named tool functions with per-tool retry policies in a single call.
- Provide a `createRetryPolicy(options)` factory that returns a reusable, preconfigured policy object applicable to multiple tools.
- Provide a `createCircuitBreaker(options)` factory that returns a standalone circuit breaker instance with closed/open/half-open state management.
- Classify errors into actionable categories: `retriable` (transient, worth retrying), `non-retriable` (permanent, return to LLM immediately), `rate-limited` (throttled, retry after specific delay), `timeout` (exceeded time limit, may be retriable), and `unknown` (unclassified, behavior configurable). Provide built-in classifiers for HTTP status codes and common API error patterns, plus a per-tool custom classifier hook.
- Implement exponential backoff with configurable jitter (full, equal, decorrelated, none), respecting `Retry-After` headers when present on rate-limited responses.
- Implement per-tool circuit breakers with configurable failure threshold, reset timeout, and half-open success threshold. Circuit breaker state is independent per tool, preventing a failing search API from blocking an unrelated database tool.
- Format permanent errors into structured, LLM-consumable objects that include the error classification, a human-readable message, whether the error is retriable, and a suggestion for what the LLM can do next. Sanitize errors by stripping stack traces, internal URLs, file paths, and sensitive headers before they reach the model's context.
- Integrate with MCP tool annotations: when tool metadata includes `readOnlyHint`, `idempotentHint`, or `destructiveHint`, automatically adjust default retry behavior (retry read-only and idempotent tools aggressively, never retry destructive tools unless explicitly overridden).
- Provide event hooks (`onRetry`, `onCircuitOpen`, `onCircuitClose`, `onCircuitHalfOpen`, `onPermanentFailure`, `onSuccess`) for observability, logging, and custom logic injection.
- Return a rich result object (`RetryResult`) with the tool's return value (on success), the number of attempts, the total duration, the error classification (on failure), the formatted LLM error (on failure), and the circuit breaker state.
- Support `AbortSignal` for external cancellation of retry loops.
- Keep runtime dependencies to zero. All retry logic, backoff calculation, jitter generation, circuit breaker state management, and error formatting are implemented using built-in JavaScript APIs.

### Non-Goals

- **Not an LLM output retry library.** This package retries the execution of tool functions, not the LLM that generated the tool call. If the LLM produces invalid tool arguments or the tool result fails schema validation, that is the concern of `llm-retry`. `tool-call-retry` assumes the tool arguments are what they are and retries the execution against external services.
- **Not a rate limiter.** This package does not limit how many times a tool can be called per time window. It retries failed calls with backoff, but it does not gate incoming call volume. Use `mcp-rate-guard` or `bottleneck` for rate limiting. The circuit breaker prevents calling a broken service, but that is failure protection, not rate control.
- **Not an HTTP client.** This package wraps async functions. It does not make HTTP requests, manage connection pools, or parse response headers (except for `Retry-After` extraction from errors). The tool function the caller provides handles all network communication.
- **Not a request queue.** This package does not buffer or reorder tool calls. Retries are inline -- the wrapped function blocks until the retry loop completes or fails. Use `p-queue` or `bottleneck` for concurrency control and queueing.
- **Not a monitoring system.** This package emits events and returns metadata for observability, but it does not store metrics, generate dashboards, or send alerts. Pipe the events into your existing monitoring infrastructure.
- **Not a tool router or orchestrator.** This package does not decide which tool to call or manage tool execution order. It wraps individual tool functions with resilience logic. Agent orchestration is a higher-level concern handled by frameworks like LangChain, CrewAI, or custom agent loops.
- **Not a secrets manager.** The error sanitizer strips patterns that look like secrets (API keys, tokens, internal URLs) from error messages before they reach the LLM. It is a best-effort heuristic, not a security boundary. Do not rely on it as the sole mechanism to prevent secret leakage. Design your tool functions to not include secrets in thrown error messages in the first place.

---

## 3. Target Users and Use Cases

### AI Agent Developers

Developers building autonomous agents where an LLM generates tool calls and the application executes them in a loop. Each tool call may hit an external API (weather service, database, search engine, file system, code execution sandbox) that can fail transiently. Without retry logic, a single 503 from a downstream service causes the agent to receive an error, which the LLM may not handle gracefully -- it might apologize to the user, hallucinate a result, or enter a confused retry loop of its own that generates the same failing call repeatedly. `tool-call-retry` handles transient failures transparently (the agent never sees them) and formats permanent failures so the LLM receives clear, actionable information. A typical integration is: `const tools = wrapTools({ search: searchFn, weather: weatherFn }, { maxRetries: 3 })`.

### MCP Server and Client Developers

Teams building MCP servers whose tools call external services, or MCP clients that execute tools on behalf of the LLM. MCP tool results must include a `content` array and an optional `isError` flag. When a tool fails, the MCP server must return a well-formatted error result, not crash or hang. `tool-call-retry` wraps tool handler functions so that transient failures are retried, circuit breakers prevent hammering broken services, and permanent failures are formatted into MCP-compatible `tool_result` objects with `isError: true` and a clear error description. The integration with MCP tool annotations (`readOnlyHint`, `idempotentHint`, `destructiveHint`) means that tool metadata automatically influences retry behavior without manual configuration.

### Backend Service Developers with LLM Tool Pipelines

Developers building API services where incoming requests trigger LLM inference that may generate tool calls. These services have latency SLAs and reliability requirements. A tool that calls a flaky external API needs retry logic to meet the SLA, a circuit breaker to avoid cascading failures during outages, and proper error formatting so the LLM can gracefully degrade (e.g., "The weather service is temporarily unavailable, but I can answer your other question"). `tool-call-retry` provides all three in a single wrapper.

### Multi-Tool Agent Framework Authors

Teams building agent frameworks that manage sets of tools. Each tool has different reliability characteristics: a calculator tool never fails, a web search tool has occasional timeouts, a code execution sandbox has strict rate limits, and a database tool may be unavailable during maintenance. `tool-call-retry`'s `wrapTools` function accepts per-tool configuration, allowing the framework to set `maxRetries: 0` for the calculator, `maxRetries: 5` for the search tool, and circuit breaker thresholds appropriate for each service. The framework author wraps all tools once during initialization and does not think about retry logic again.

### Developers Using Tools with Strict Idempotency Requirements

Developers whose tools have side effects -- sending emails, creating database records, charging payments. These tools must not be blindly retried on failure because a timeout error does not mean the operation failed -- it may have succeeded but the response was lost. `tool-call-retry` supports per-tool retry policies: destructive or non-idempotent tools can be configured with `maxRetries: 0` or `retryOnTimeout: false`, while read-only query tools use aggressive retry. The MCP annotation integration handles this automatically when annotations are available.

---

## 4. Core Concepts

### Tool Wrapper

The tool wrapper is the central abstraction. It takes an async tool function `(args: T) => Promise<R>` and returns a new function with the same signature that adds retry logic, circuit breaking, and error formatting around the original call. The wrapped function is a drop-in replacement for the original -- callers do not know it has retry logic. On success, the wrapped function returns the tool's result. On permanent failure (all retries exhausted or non-retriable error), it either throws a formatted error or returns a structured error result, depending on configuration.

### Error Classification

Error classification is the mechanism that distinguishes `tool-call-retry` from generic retry libraries. Every error thrown by a tool function is passed through a classifier that categorizes it into one of five classes: `retriable`, `non-retriable`, `rate-limited`, `timeout`, or `unknown`. The classification determines what happens next: retriable errors trigger a retry with backoff, non-retriable errors are formatted and returned to the LLM immediately, rate-limited errors trigger a retry respecting the `Retry-After` delay, timeout errors are retriable by default (configurable per tool), and unknown errors follow a configurable default behavior.

The package includes built-in classifiers for HTTP errors (status code-based), common Node.js network errors (`ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`), and common API error patterns (AWS, Google Cloud, OpenAI error structures). The caller can provide a custom classifier per tool for domain-specific error patterns.

### Retry Policy

A retry policy is a configuration object that defines how retries are performed: the maximum number of retries, the backoff strategy (exponential, linear, fixed, or custom), the jitter strategy, the maximum total time, the retry budget, and the error classifier. Policies are created via `createRetryPolicy(options)` and can be shared across multiple tools or overridden per tool. A policy is a plain object, not an instance -- it has no state. State (attempt count, backoff delay, timing) is managed per-invocation inside the retry loop.

### Circuit Breaker

The circuit breaker prevents calling a tool when its underlying service is known to be failing. Each tool has an independent circuit breaker with three states:

- **Closed** (normal operation): Tool calls pass through. Failures are counted. When the failure count within a rolling window exceeds the configured threshold, the circuit transitions to open.
- **Open** (blocking): Tool calls are immediately rejected without executing the tool function. The rejection returns an LLM-formatted error explaining that the service is temporarily unavailable. After a configured reset timeout, the circuit transitions to half-open.
- **Half-open** (testing): The next tool call is allowed through as a test. If it succeeds, the circuit transitions to closed and the failure count resets. If it fails, the circuit transitions back to open for another reset timeout period. A configurable success threshold allows requiring multiple consecutive successes in half-open before closing.

Circuit breaker state is per-tool, not per-invocation. If a search tool's circuit is open, all callers of the wrapped search function see immediate rejections, regardless of how many different LLM conversations or agent loops are using the tool.

### LLM Error Formatting

When a tool fails permanently (all retries exhausted, non-retriable error, or circuit breaker open), the error must be communicated to the LLM in a way it can understand and act on. Raw errors from downstream services contain stack traces, internal server paths, database connection strings, and other information that is useless to an LLM and potentially dangerous if leaked to end users.

LLM error formatting transforms raw errors into structured, sanitized objects with four components: (1) a classification code (`RATE_LIMITED`, `SERVICE_UNAVAILABLE`, `INVALID_ARGUMENTS`, `UNAUTHORIZED`, `NOT_FOUND`, `TIMEOUT`, `INTERNAL_ERROR`, `CIRCUIT_OPEN`), (2) a human-readable message suitable for an LLM to reason about, (3) a boolean indicating whether the error might be retriable with different timing or arguments, and (4) a suggestion for what the LLM can do next ("Try again with different search terms", "This service is temporarily unavailable -- try an alternative approach", "This tool requires authentication that is not configured").

### Retry Budget

A retry budget limits the total number of retries across all tools within a time window. Without a budget, an agent with 10 tools that each allow 3 retries could make up to 30 retry attempts during an outage, amplifying load on already-stressed services. A global retry budget of, say, 15 retries per minute ensures that aggregate retry volume is bounded regardless of how many tools are failing simultaneously. When the budget is exhausted, further tool failures are treated as non-retriable and returned to the LLM immediately.

---

## 5. Error Classification

### Classification Categories

Every error thrown by a tool function is classified into exactly one of five categories. The classification drives all subsequent behavior: whether to retry, how long to wait, and how to format the error for the LLM.

| Category | Meaning | Retry Behavior | LLM Formatting |
|---|---|---|---|
| `retriable` | Transient error that may succeed on retry. The service is temporarily degraded but expected to recover. | Retry with exponential backoff and jitter. | If all retries exhausted: "This service experienced a temporary error. It may work if tried again later." |
| `non-retriable` | Permanent error that will not succeed on retry. The request itself is invalid, unauthorized, or targeting a resource that does not exist. | No retry. Return to LLM immediately. | Specific message based on error type: "Invalid arguments", "Authentication required", "Resource not found". |
| `rate-limited` | The service is throttling requests. The error typically includes a `Retry-After` hint. | Retry after the `Retry-After` delay (or computed backoff if no header). | If retries exhausted: "This service is rate-limiting requests. Try again later." |
| `timeout` | The request exceeded its time limit. The operation may or may not have completed on the server. | Retry by default for idempotent/read-only tools. Do not retry by default for non-idempotent tools (configurable). | "The request timed out. The operation may or may not have completed." |
| `unknown` | The error does not match any known pattern. Classification could not be determined. | Configurable: retry (default) or treat as non-retriable. | "An unexpected error occurred." |

### Built-in HTTP Error Classifier

The default classifier examines errors for HTTP status code information. It checks for a `status`, `statusCode`, or `response.status` property on the error object, covering the error formats produced by `fetch`, `axios`, `got`, `node-fetch`, the OpenAI SDK, the Anthropic SDK, and most HTTP client libraries.

| Status Code | Classification | Rationale |
|---|---|---|
| 400 | `non-retriable` | Bad request. The tool arguments or request format is wrong. Retrying the same request will fail identically. |
| 401 | `non-retriable` | Authentication failed. Missing or invalid API key. Retrying will not fix authentication. |
| 403 | `non-retriable` | Forbidden. The credentials are valid but lack permission. Retrying will not grant permission. |
| 404 | `non-retriable` | Resource not found. The endpoint, ID, or path does not exist. |
| 405 | `non-retriable` | Method not allowed. Structural API error. |
| 409 | `non-retriable` | Conflict. A state conflict that retrying alone will not resolve. |
| 422 | `non-retriable` | Unprocessable entity. Validation error on the server side. |
| 429 | `rate-limited` | Too many requests. The service is throttling. `Retry-After` header is extracted if present. |
| 500 | `retriable` | Internal server error. Often transient -- database deadlocks, temporary resource exhaustion, deployment in progress. |
| 502 | `retriable` | Bad gateway. Upstream server temporarily unreachable. |
| 503 | `retriable` | Service unavailable. Server overloaded or in maintenance. |
| 504 | `retriable` | Gateway timeout. Upstream server did not respond in time. |
| 529 | `retriable` | Overloaded (Anthropic-specific). The API is experiencing high demand. |

### Built-in Network Error Classifier

Node.js network errors are classified by their `code` property:

| Error Code | Classification | Rationale |
|---|---|---|
| `ECONNREFUSED` | `retriable` | Server not accepting connections. May be restarting. |
| `ECONNRESET` | `retriable` | Connection reset by peer. Transient network issue. |
| `ETIMEDOUT` | `timeout` | Connection timed out. |
| `ENOTFOUND` | `non-retriable` | DNS lookup failed. Hostname does not resolve. Likely a configuration error, not transient. |
| `EPIPE` | `retriable` | Broken pipe. Connection dropped unexpectedly. |
| `EAI_AGAIN` | `retriable` | Temporary DNS failure. May resolve on retry. |
| `EHOSTUNREACH` | `retriable` | Host unreachable. Network path issue, possibly transient. |
| `CERT_HAS_EXPIRED` | `non-retriable` | TLS certificate expired. Will not self-resolve. |
| `UNABLE_TO_VERIFY_LEAF_SIGNATURE` | `non-retriable` | TLS verification failure. Configuration error. |

### Built-in Abort/Cancellation Classifier

If the error is an `AbortError` or the error's `name` is `'AbortError'`, it is classified as `non-retriable`. The caller cancelled the operation deliberately; retrying would contradict the cancellation intent.

### Custom Classifier

Each tool can provide a custom classifier function that takes precedence over the built-in classifiers. The custom classifier receives the raw error and returns an `ErrorClassification` or `null`. If it returns `null`, the built-in classifiers are consulted as a fallback.

```typescript
const wrappedSearch = withRetry(searchTool, {
  classifyError: (error) => {
    // GitHub API returns 404 for private repos you can't access --
    // this is non-retriable, not "not found" in the usual sense
    if (error.status === 404 && error.message?.includes('Not Found')) {
      return { category: 'non-retriable', code: 'NOT_FOUND', message: 'Repository not found or not accessible' };
    }
    // Elasticsearch returns 503 during shard relocation -- always transient
    if (error.status === 503 && error.message?.includes('shard')) {
      return { category: 'retriable', code: 'SHARD_RELOCATING', message: 'Search index is temporarily unavailable' };
    }
    return null; // Fall through to built-in classifiers
  },
});
```

### Classification Priority

When classifying an error, classifiers are consulted in this order:

1. **Custom per-tool classifier** (if provided): First priority. If it returns a non-null classification, that classification is used.
2. **Abort/cancellation check**: If the error is an `AbortError`, classify as `non-retriable`.
3. **HTTP status code classifier**: If the error has a recognizable status code property, classify by status code.
4. **Network error classifier**: If the error has a recognizable Node.js error code, classify by error code.
5. **Timeout detection**: If the error message contains "timeout" (case-insensitive) or the error name is `TimeoutError`, classify as `timeout`.
6. **Default**: If no classifier matches, classify as `unknown`. The behavior for `unknown` errors is configurable via `unknownErrorBehavior: 'retry' | 'fail'` (default: `'retry'`).

---

## 6. Retry Strategies

### Exponential Backoff (Default)

The default retry strategy uses exponential backoff with jitter. The base delay before the Nth retry is:

```
baseDelay = min(initialDelayMs * multiplier^(attempt - 1), maxDelayMs)
```

Where `attempt` is 1-indexed (the first retry is attempt 1). The default values are: `initialDelayMs: 1000`, `multiplier: 2`, `maxDelayMs: 30000`. This produces base delays of 1s, 2s, 4s, 8s, 16s, 30s, 30s, ... (capped at `maxDelayMs`).

### Jitter Strategies

Jitter adds randomness to the backoff delay to prevent the "thundering herd" problem, where multiple clients retry at exactly the same time after a shared failure. Four jitter strategies are supported, following the taxonomy established by AWS Architecture Blog.

| Strategy | Formula | Behavior | When to Use |
|---|---|---|---|
| `full` (default) | `random(0, baseDelay)` | Uniformly random between 0 and the full backoff. Provides the widest spread. | Default for most use cases. Best when many tool instances may fail simultaneously (e.g., multiple agents sharing a search API). |
| `equal` | `baseDelay / 2 + random(0, baseDelay / 2)` | At least half the base delay, plus random jitter up to the other half. | When you want a minimum wait time but still some spread. |
| `decorrelated` | `random(initialDelayMs, previousDelay * 3)` | Each delay is derived from the previous delay, not the attempt number. Produces a more organic, less predictable pattern. | When retry timing is highly variable and you want to avoid any periodicity. |
| `none` | `baseDelay` | No jitter. All retries use the exact backoff delay. | Testing only. Not recommended for production -- causes synchronized retries across concurrent callers. |

### Fixed Delay

A constant delay between every retry, regardless of attempt number. Configured via `strategy: 'fixed'` with a `delayMs` value. Useful for tools where the downstream service has a fixed recovery pattern (e.g., a rate limit that resets every 10 seconds).

```typescript
const policy = createRetryPolicy({
  strategy: 'fixed',
  delayMs: 5000,
  maxRetries: 3,
});
```

### Linear Backoff

The delay increases linearly with each attempt: `delay = initialDelayMs * attempt`. Configured via `strategy: 'linear'`. Produces delays of 1s, 2s, 3s, 4s, ... (with default `initialDelayMs: 1000`). This is gentler than exponential backoff and useful when you want gradually increasing delays without the rapid escalation of exponential growth.

### Custom Delay Function

For advanced use cases, the caller provides a function that computes the delay for each attempt:

```typescript
const policy = createRetryPolicy({
  strategy: 'custom',
  delayFn: (attempt, error) => {
    // Fibonacci backoff: 1s, 1s, 2s, 3s, 5s, 8s, ...
    const fib = [1000, 1000, 2000, 3000, 5000, 8000, 13000];
    return fib[Math.min(attempt - 1, fib.length - 1)];
  },
  maxRetries: 5,
});
```

The custom delay function receives the attempt number (1-indexed) and the error that triggered the retry, allowing error-dependent delay logic (e.g., longer delays for 503 than for 500).

### Retry-After Header Respect

When an error is classified as `rate-limited` and includes a `Retry-After` value (extracted from the error's `headers`, `response.headers`, or a `retryAfter` property), the retry delay uses the `Retry-After` value instead of the computed backoff -- but only if the `Retry-After` value is longer than the computed backoff. If `Retry-After` specifies a shorter delay, the computed backoff is used to avoid retrying too aggressively. The `Retry-After` value is parsed as either seconds (integer) or an HTTP date string.

### Max Retries

The `maxRetries` option sets the maximum number of retry attempts per tool invocation. The total number of executions is `maxRetries + 1` (the initial attempt plus retries). Default: `3`. Setting `maxRetries: 0` disables retry -- the tool function is called once, and if it fails, the error is formatted and returned immediately.

### Max Total Time

The `maxTotalTimeMs` option sets an upper bound on the total wall-clock time for all attempts including backoff delays. If the time limit is reached before the retry loop completes, the most recent error is formatted and returned. Default: `60000` (60 seconds). This prevents a retry loop with long backoff delays from blocking indefinitely.

### Retry Budget

The `retryBudget` option configures a shared budget that limits aggregate retries across all tools within a time window. The budget is a token bucket: it starts with `maxTokens` tokens (default: `20`), each retry consumes one token, and tokens replenish at a rate of `refillRate` per second (default: `1`). When the bucket is empty, no retries are attempted for any tool -- failures are treated as non-retriable and returned to the LLM immediately.

The budget is shared across all tools wrapped with the same budget instance. This prevents cascading retry storms during widespread outages while still allowing individual transient failures to be retried normally.

```typescript
const budget = createRetryBudget({ maxTokens: 20, refillRate: 1 });

const tools = wrapTools({
  search: searchFn,
  weather: weatherFn,
  database: databaseFn,
}, {
  retryBudget: budget,
  maxRetries: 3,
});
```

---

## 7. Circuit Breaker

### Purpose

The circuit breaker prevents the application from repeatedly calling a tool whose underlying service is down. Without a circuit breaker, an agent that retries a failing tool with 3 retries, then gets the error, then generates another tool call to the same service (because the LLM decides to try again), creates an amplification loop: each LLM turn generates 4 requests (1 initial + 3 retries) to a service that is already overwhelmed. With a circuit breaker, after the failure threshold is reached, subsequent calls are rejected immediately (in microseconds, not seconds) with a clear "service unavailable" message, and the LLM learns quickly that the tool is not available.

### States

```
                     success
              ┌────────────────────┐
              │                    │
              ▼                    │
         ┌─────────┐    failure threshold    ┌──────────┐
         │ CLOSED  │ ──────────────────────> │  OPEN    │
         │ (normal)│                         │(blocking)│
         └─────────┘                         └────┬─────┘
              ▲                                   │
              │            reset timeout          │
              │            expires                │
              │                                   ▼
              │         success              ┌──────────┐
              └──────────────────────────────│HALF-OPEN │
                                    failure  │(testing) │
                          ┌─────────────────>│          │
                          │                  └──────────┘
                          │                       │
                          └───────────────────────┘
```

**Closed**: The circuit is healthy. Tool calls pass through to the underlying function. Each failure increments the failure counter. Each success resets the failure counter (or decrements it, depending on the `failureCounterBehavior` configuration). When the failure counter exceeds `failureThreshold` within the `rollingWindowMs` time window, the circuit transitions to open. Default: `failureThreshold: 5`, `rollingWindowMs: 60000`.

**Open**: The circuit is tripped. Tool calls are rejected immediately without executing the tool function. The rejection produces an LLM-formatted error with classification `CIRCUIT_OPEN` and a message explaining that the service is temporarily unavailable. After `resetTimeoutMs` elapses (default: `30000`, 30 seconds), the circuit transitions to half-open.

**Half-open**: The circuit is testing whether the service has recovered. The next `successThreshold` calls (default: `1`) are allowed through. If all succeed, the circuit transitions to closed and the failure counter resets. If any fail, the circuit transitions back to open for another `resetTimeoutMs` period. While in half-open, only `successThreshold` concurrent calls are allowed; additional calls are rejected as if the circuit were open.

### Configuration

```typescript
interface CircuitBreakerConfig {
  /** Number of failures within the rolling window to trip the circuit. Default: 5. */
  failureThreshold: number;

  /** Time window in milliseconds for counting failures. Default: 60000 (1 minute). */
  rollingWindowMs: number;

  /** Time in milliseconds to wait before transitioning from open to half-open. Default: 30000 (30 seconds). */
  resetTimeoutMs: number;

  /** Number of consecutive successes in half-open state required to close the circuit. Default: 1. */
  successThreshold: number;

  /** Whether only retriable errors count toward the failure threshold. Default: true.
   *  When true, non-retriable errors (400, 401, 403, 404) do not trip the circuit.
   *  A flood of 400 errors means the LLM is sending bad arguments, not that the service is down. */
  onlyCountRetriableFailures: boolean;

  /** Whether the circuit breaker is enabled. Default: true.
   *  Set to false to disable circuit breaking for a specific tool. */
  enabled: boolean;
}
```

### Interaction with Retry

The circuit breaker and retry logic compose in a specific order:

1. **Circuit breaker check** (before execution): If the circuit is open, reject immediately. No retry is attempted.
2. **Tool execution**: If the circuit is closed or half-open, execute the tool function.
3. **Error classification**: If the tool throws, classify the error.
4. **Circuit breaker recording**: Record the success or failure in the circuit breaker's state.
5. **Retry decision**: If the error is retriable and retries remain, go to step 1 (re-check the circuit breaker before the next attempt). If the circuit opened during this invocation, the next retry attempt will be rejected immediately.

This means retry attempts are gated by the circuit breaker. If a tool fails 5 times during a single retry loop and trips the circuit, the remaining retries in that loop are rejected instantly. This is the correct behavior: if the service just failed 5 times in a row, the 6th attempt is almost certainly going to fail too.

### Per-Tool vs Shared Circuit Breakers

By default, each tool wrapped with `withRetry` or `wrapTools` gets its own independent circuit breaker. This is the correct default: a failing search API should not prevent the weather API from being called.

For tools that share a backend service, a shared circuit breaker can be created and passed to multiple tool wrappers:

```typescript
const sharedBreaker = createCircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 30000 });

const tools = wrapTools({
  searchDocs: searchDocsFn,
  searchCode: searchCodeFn,
  searchIssues: searchIssuesFn,
}, {
  circuitBreaker: sharedBreaker,  // All three tools share one circuit breaker
});
```

### Circuit Breaker Events

The circuit breaker emits events on state transitions:

| Event | When | Payload |
|---|---|---|
| `circuitOpen` | Circuit transitions from closed to open | `{ toolName: string, failureCount: number, threshold: number }` |
| `circuitHalfOpen` | Circuit transitions from open to half-open | `{ toolName: string, resetTimeoutMs: number }` |
| `circuitClose` | Circuit transitions from half-open to closed | `{ toolName: string, successCount: number }` |
| `circuitRejection` | A call is rejected because the circuit is open | `{ toolName: string, remainingMs: number }` |

---

## 8. LLM Error Formatting

### Purpose

When a tool fails permanently, the error must be returned to the LLM as part of the conversation. In OpenAI's API, this is a `tool` role message with the `tool_call_id`. In Anthropic's API, this is a `tool_result` content block with `is_error: true`. In MCP, this is a `tools/call` response with `isError: true` in the result. In all cases, the content of the error message is what the LLM sees and reasons about.

A well-formatted error message gives the LLM enough information to decide its next action: retry the same tool with different arguments, use an alternative tool, explain the situation to the user, or proceed without the tool's output. A poorly formatted error (raw stack trace, generic "something went wrong", or no error at all) leaves the LLM guessing.

### Structured Error Object

The `formatErrorForLLM` function produces a structured object:

```typescript
interface LLMFormattedError {
  /** Always true. Signals to the LLM that this is an error, not a tool result. */
  error: true;

  /** Machine-readable error code. */
  code: string;

  /** Human-readable error message for the LLM to reason about. */
  message: string;

  /** Whether the error might succeed on a future attempt (with same or different arguments). */
  retriable: boolean;

  /** Actionable suggestion for the LLM. */
  suggestion: string;

  /** The tool name that failed, if available. */
  tool?: string;

  /** The number of retry attempts that were made before giving up. */
  attemptsMade?: number;
}
```

### Error Code Mapping

Each error classification maps to a specific error code and default message/suggestion template:

| Classification | Code | Default Message | Default Suggestion |
|---|---|---|---|
| `retriable` (retries exhausted) | `SERVICE_UNAVAILABLE` | "The service experienced a temporary error after {attempts} attempts." | "This service is temporarily unstable. You may try again later, or use an alternative approach." |
| `non-retriable` (400) | `INVALID_ARGUMENTS` | "The request was rejected due to invalid arguments." | "Check the arguments and try again with corrected values." |
| `non-retriable` (401) | `UNAUTHORIZED` | "Authentication failed for this service." | "This tool requires valid authentication credentials that are not currently configured." |
| `non-retriable` (403) | `FORBIDDEN` | "Access to this resource is not permitted." | "This tool does not have permission to perform this operation." |
| `non-retriable` (404) | `NOT_FOUND` | "The requested resource was not found." | "Verify the resource identifier and try again, or search for the correct identifier." |
| `rate-limited` (retries exhausted) | `RATE_LIMITED` | "This service is rate-limiting requests." | "Too many requests have been made to this service. Wait before trying again." |
| `timeout` | `TIMEOUT` | "The request timed out after {timeoutMs}ms." | "The operation took too long to complete. You may try again with a simpler request, or try later." |
| `unknown` | `INTERNAL_ERROR` | "An unexpected error occurred." | "An internal error occurred. You may try a different approach." |
| Circuit breaker open | `CIRCUIT_OPEN` | "This service is temporarily unavailable due to repeated failures." | "This service has been experiencing errors and is temporarily disabled. Try an alternative approach or wait." |

### Sanitization

Before the error message reaches the LLM, the following sanitization rules are applied:

1. **Stack trace removal**: Any content after a line matching `^\s+at\s+` (Node.js stack trace format) is stripped. Entire `stack` properties are removed.
2. **Internal URL masking**: URLs matching internal patterns (RFC 1918 addresses like `10.x.x.x`, `192.168.x.x`, `172.16-31.x.x`, `localhost`, `.internal`, `.local`) are replaced with `[internal service]`.
3. **File path masking**: Absolute file paths (`/home/...`, `/Users/...`, `/var/...`, `C:\...`) are replaced with `[server path]`.
4. **Secret pattern masking**: Strings matching common secret patterns (API keys: `sk-...`, `pk_...`, `AKIA...`; Bearer tokens: `Bearer ...`; connection strings with credentials) are replaced with `[redacted]`.
5. **Header masking**: Authorization headers, cookie values, and session tokens are replaced with `[redacted]`.
6. **Length truncation**: Error messages exceeding `maxErrorLength` characters (default: `500`) are truncated with `... (truncated)`.

Sanitization is applied to both the `message` and `suggestion` fields. The caller can disable sanitization (`sanitize: false`) for debugging or provide a custom sanitizer function.

### Custom Error Formatter

Each tool can provide a custom error formatter that overrides the default formatting logic:

```typescript
const wrappedTool = withRetry(githubSearchFn, {
  formatError: (error, classification) => ({
    error: true,
    code: 'GITHUB_ERROR',
    message: `GitHub search failed: ${classification.message}`,
    retriable: classification.category === 'retriable',
    suggestion: error.status === 404
      ? 'The repository may be private or the name may be incorrect. Try searching with a different query.'
      : 'GitHub is experiencing issues. Try again or use a different search source.',
  }),
});
```

### Human-Readable String Format

In addition to the structured object, `formatErrorForLLM` can produce a plain string suitable for direct inclusion in a `tool_result` content field:

```
Error: The weather service is temporarily unavailable after 3 attempts.
Code: SERVICE_UNAVAILABLE
Retriable: yes
Suggestion: This service is temporarily unstable. You may try again later, or try checking a different location.
```

The `outputFormat` option controls which format is produced: `'object'` (default) or `'string'`.

---

## 9. API Surface

### Installation

```bash
npm install tool-call-retry
```

### Primary Function: `withRetry`

Wraps a single tool function with retry logic, circuit breaking, and error formatting.

```typescript
import { withRetry } from 'tool-call-retry';

async function searchWeb(args: { query: string }): Promise<{ results: string[] }> {
  const response = await fetch(`https://api.search.com/v1?q=${args.query}`);
  if (!response.ok) throw Object.assign(new Error(response.statusText), { status: response.status });
  return response.json();
}

const resilientSearch = withRetry(searchWeb, {
  maxRetries: 3,
  initialDelayMs: 1000,
  jitter: 'full',
  circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 30000 },
});

// Use exactly like the original function
const result = await resilientSearch({ query: 'latest AI news' });
```

### Batch Wrapper: `wrapTools`

Wraps a map of named tool functions with per-tool or shared retry policies.

```typescript
import { wrapTools } from 'tool-call-retry';

const tools = wrapTools(
  {
    search: searchFn,
    weather: weatherFn,
    calculator: calculatorFn,
    sendEmail: sendEmailFn,
  },
  {
    // Global defaults
    maxRetries: 3,
    circuitBreaker: { failureThreshold: 5 },
    // Per-tool overrides
    toolOptions: {
      calculator: { maxRetries: 0, circuitBreaker: { enabled: false } },
      sendEmail: { maxRetries: 0 },  // Non-idempotent: do not retry
      search: { maxRetries: 5, initialDelayMs: 500 },
    },
  },
);

// tools.search, tools.weather, etc. are now wrapped
const searchResult = await tools.search({ query: 'hello' });
```

### Policy Factory: `createRetryPolicy`

Creates a reusable retry policy object that can be passed to `withRetry` or `wrapTools`.

```typescript
import { createRetryPolicy } from 'tool-call-retry';

const aggressivePolicy = createRetryPolicy({
  maxRetries: 5,
  initialDelayMs: 500,
  maxDelayMs: 15000,
  jitter: 'full',
  maxTotalTimeMs: 45000,
});

const conservativePolicy = createRetryPolicy({
  maxRetries: 1,
  initialDelayMs: 2000,
  jitter: 'equal',
});

const search = withRetry(searchFn, { policy: aggressivePolicy });
const database = withRetry(databaseFn, { policy: conservativePolicy });
```

### Circuit Breaker Factory: `createCircuitBreaker`

Creates a standalone circuit breaker instance for explicit sharing across tools.

```typescript
import { createCircuitBreaker } from 'tool-call-retry';

const searchBreaker = createCircuitBreaker({
  failureThreshold: 5,
  rollingWindowMs: 60000,
  resetTimeoutMs: 30000,
  successThreshold: 2,
});

// Share across multiple search tools
const docSearch = withRetry(docSearchFn, { circuitBreaker: searchBreaker });
const codeSearch = withRetry(codeSearchFn, { circuitBreaker: searchBreaker });

// Inspect state
console.log(searchBreaker.state);       // 'closed' | 'open' | 'half-open'
console.log(searchBreaker.failureCount); // number
```

### Error Classification: `classifyError`

Standalone function for classifying errors without the full retry wrapper. Useful for custom retry logic or logging.

```typescript
import { classifyError } from 'tool-call-retry';

try {
  await someToolFunction(args);
} catch (error) {
  const classification = classifyError(error);
  console.log(classification.category);  // 'retriable' | 'non-retriable' | etc.
  console.log(classification.code);      // 'SERVICE_UNAVAILABLE' | 'INVALID_ARGUMENTS' | etc.
}
```

### Error Formatting: `formatErrorForLLM`

Standalone function for formatting errors into LLM-friendly messages. Useful when the caller manages their own retry logic but wants the formatting.

```typescript
import { formatErrorForLLM } from 'tool-call-retry';

try {
  await someToolFunction(args);
} catch (error) {
  const formatted = formatErrorForLLM(error, {
    toolName: 'search',
    outputFormat: 'string',
    maxErrorLength: 300,
  });
  // formatted is a sanitized, LLM-readable error string
}
```

### Retry Budget Factory: `createRetryBudget`

Creates a shared retry budget for limiting aggregate retries across tools.

```typescript
import { createRetryBudget } from 'tool-call-retry';

const budget = createRetryBudget({
  maxTokens: 20,
  refillRate: 1,  // 1 token per second
});

const tools = wrapTools({ search: searchFn, weather: weatherFn }, {
  retryBudget: budget,
});

console.log(budget.remaining); // Current available tokens
```

### Type Definitions

```typescript
// ── Error Classification ────────────────────────────────────────────

/** Error classification category. */
type ErrorCategory = 'retriable' | 'non-retriable' | 'rate-limited' | 'timeout' | 'unknown';

/** Result of classifying an error. */
interface ErrorClassification {
  /** The error category. */
  category: ErrorCategory;

  /** Machine-readable error code (e.g., 'SERVICE_UNAVAILABLE', 'INVALID_ARGUMENTS'). */
  code: string;

  /** Human-readable description of the error. */
  message: string;

  /** HTTP status code, if the error originated from an HTTP response. */
  statusCode?: number;

  /** Retry-After value in milliseconds, if available (for rate-limited errors). */
  retryAfterMs?: number;
}

/** Custom error classifier function. Return null to fall through to built-in classifiers. */
type ErrorClassifier = (error: unknown) => ErrorClassification | null;

// ── Retry Policy ────────────────────────────────────────────────────

/** Backoff strategy type. */
type BackoffStrategy = 'exponential' | 'linear' | 'fixed' | 'custom';

/** Jitter strategy type. */
type JitterStrategy = 'full' | 'equal' | 'decorrelated' | 'none';

/** Retry policy configuration. */
interface RetryPolicy {
  /** Maximum number of retry attempts. Default: 3. */
  maxRetries: number;

  /** Backoff strategy. Default: 'exponential'. */
  strategy: BackoffStrategy;

  /** Initial delay in milliseconds before the first retry. Default: 1000. */
  initialDelayMs: number;

  /** Maximum delay in milliseconds between retries. Default: 30000. */
  maxDelayMs: number;

  /** Exponential backoff multiplier. Only used with 'exponential' strategy. Default: 2. */
  multiplier: number;

  /** Fixed delay in milliseconds. Only used with 'fixed' strategy. */
  delayMs?: number;

  /** Custom delay function. Only used with 'custom' strategy. */
  delayFn?: (attempt: number, error: unknown) => number;

  /** Jitter strategy. Default: 'full'. */
  jitter: JitterStrategy;

  /** Maximum total time in milliseconds for all attempts. Default: 60000. */
  maxTotalTimeMs: number;

  /** Whether to respect Retry-After headers on rate-limited responses. Default: true. */
  respectRetryAfter: boolean;

  /** Behavior for errors classified as 'unknown'. Default: 'retry'. */
  unknownErrorBehavior: 'retry' | 'fail';

  /** Whether to retry on timeout errors. Default: true for idempotent tools, false otherwise. */
  retryOnTimeout?: boolean;
}

// ── Circuit Breaker ─────────────────────────────────────────────────

/** Circuit breaker state. */
type CircuitState = 'closed' | 'open' | 'half-open';

/** Circuit breaker configuration. */
interface CircuitBreakerConfig {
  /** Whether the circuit breaker is enabled. Default: true. */
  enabled: boolean;

  /** Number of failures within the rolling window to trip the circuit. Default: 5. */
  failureThreshold: number;

  /** Time window in milliseconds for counting failures. Default: 60000. */
  rollingWindowMs: number;

  /** Time in milliseconds before transitioning from open to half-open. Default: 30000. */
  resetTimeoutMs: number;

  /** Consecutive successes needed in half-open to close the circuit. Default: 1. */
  successThreshold: number;

  /** Whether only retriable errors count toward the failure threshold. Default: true. */
  onlyCountRetriableFailures: boolean;
}

/** Circuit breaker instance. */
interface CircuitBreaker {
  /** Current circuit state. */
  readonly state: CircuitState;

  /** Current failure count within the rolling window. */
  readonly failureCount: number;

  /** Whether a call would be allowed right now. */
  readonly isCallPermitted: boolean;

  /** Milliseconds remaining before the circuit transitions from open to half-open. 0 if not open. */
  readonly remainingOpenMs: number;

  /** Manually trip the circuit to open state. */
  trip(): void;

  /** Manually reset the circuit to closed state. */
  reset(): void;

  /** Subscribe to circuit breaker events. */
  on(event: 'open', listener: (info: { failureCount: number }) => void): void;
  on(event: 'half-open', listener: () => void): void;
  on(event: 'close', listener: (info: { successCount: number }) => void): void;
  on(event: 'rejection', listener: (info: { remainingMs: number }) => void): void;
  off(event: string, listener: (...args: unknown[]) => void): void;
}

// ── Retry Budget ────────────────────────────────────────────────────

/** Retry budget configuration. */
interface RetryBudgetConfig {
  /** Maximum tokens in the budget. Default: 20. */
  maxTokens: number;

  /** Tokens replenished per second. Default: 1. */
  refillRate: number;
}

/** Retry budget instance. */
interface RetryBudget {
  /** Current available tokens. */
  readonly remaining: number;

  /** Attempt to consume a token. Returns true if a token was available. */
  tryConsume(): boolean;

  /** Reset the budget to full. */
  reset(): void;
}

// ── LLM Error Formatting ────────────────────────────────────────────

/** LLM-formatted error object. */
interface LLMFormattedError {
  error: true;
  code: string;
  message: string;
  retriable: boolean;
  suggestion: string;
  tool?: string;
  attemptsMade?: number;
}

/** Error formatting options. */
interface FormatErrorOptions {
  /** Tool name to include in the formatted error. */
  toolName?: string;

  /** Output format. Default: 'object'. */
  outputFormat?: 'object' | 'string';

  /** Maximum length of the error message. Default: 500. */
  maxErrorLength?: number;

  /** Whether to apply sanitization. Default: true. */
  sanitize?: boolean;

  /** Custom sanitizer function. */
  sanitizer?: (text: string) => string;

  /** Custom error formatter. Overrides default formatting. */
  customFormatter?: (error: unknown, classification: ErrorClassification) => LLMFormattedError;
}

// ── Tool Wrapper Options ────────────────────────────────────────────

/** Options for withRetry. */
interface ToolRetryOptions {
  /** Retry policy. Can be a RetryPolicy object or individual options. */
  policy?: RetryPolicy;

  /** Maximum retries. Shorthand for policy.maxRetries. Default: 3. */
  maxRetries?: number;

  /** Backoff strategy. Shorthand for policy.strategy. Default: 'exponential'. */
  strategy?: BackoffStrategy;

  /** Initial delay. Shorthand for policy.initialDelayMs. Default: 1000. */
  initialDelayMs?: number;

  /** Maximum delay. Shorthand for policy.maxDelayMs. Default: 30000. */
  maxDelayMs?: number;

  /** Multiplier. Shorthand for policy.multiplier. Default: 2. */
  multiplier?: number;

  /** Jitter strategy. Shorthand for policy.jitter. Default: 'full'. */
  jitter?: JitterStrategy;

  /** Maximum total time. Shorthand for policy.maxTotalTimeMs. Default: 60000. */
  maxTotalTimeMs?: number;

  /** Circuit breaker config. Pass false to disable. */
  circuitBreaker?: CircuitBreakerConfig | CircuitBreaker | false;

  /** Custom error classifier for this tool. */
  classifyError?: ErrorClassifier;

  /** Custom error formatter for this tool. */
  formatError?: (error: unknown, classification: ErrorClassification) => LLMFormattedError;

  /** How to handle permanent failures. Default: 'throw'.
   *  'throw': Throw an error with the LLM-formatted message.
   *  'return-error': Return the LLMFormattedError object instead of throwing. */
  onPermanentFailure?: 'throw' | 'return-error';

  /** Shared retry budget. */
  retryBudget?: RetryBudget;

  /** MCP tool annotations for automatic policy adjustment. */
  annotations?: {
    readOnlyHint?: boolean;
    idempotentHint?: boolean;
    destructiveHint?: boolean;
  };

  /** AbortSignal for external cancellation. */
  signal?: AbortSignal;

  /** Event hooks. */
  hooks?: ToolRetryHooks;
}

/** Options for wrapTools. */
interface WrapToolsOptions extends ToolRetryOptions {
  /** Per-tool option overrides. Keys are tool names. */
  toolOptions?: Record<string, Partial<ToolRetryOptions>>;
}

// ── Event Hooks ─────────────────────────────────────────────────────

/** Event hooks for observability. */
interface ToolRetryHooks {
  /** Called before each retry attempt. */
  onRetry?: (info: {
    toolName?: string;
    attempt: number;
    maxRetries: number;
    error: unknown;
    classification: ErrorClassification;
    delayMs: number;
  }) => void;

  /** Called when the circuit breaker opens. */
  onCircuitOpen?: (info: { toolName?: string; failureCount: number }) => void;

  /** Called when the circuit breaker transitions to half-open. */
  onCircuitHalfOpen?: (info: { toolName?: string }) => void;

  /** Called when the circuit breaker closes. */
  onCircuitClose?: (info: { toolName?: string; successCount: number }) => void;

  /** Called when a tool call fails permanently (all retries exhausted or non-retriable). */
  onPermanentFailure?: (info: {
    toolName?: string;
    error: unknown;
    classification: ErrorClassification;
    formattedError: LLMFormattedError;
    attempts: number;
    totalMs: number;
  }) => void;

  /** Called when a tool call succeeds (including after retries). */
  onSuccess?: (info: {
    toolName?: string;
    attempts: number;
    totalMs: number;
  }) => void;
}

// ── Retry Result ────────────────────────────────────────────────────

/** Result of a retry-wrapped tool call (when using onPermanentFailure: 'return-error'). */
type RetryResult<T> =
  | { success: true; data: T; attempts: number; totalMs: number }
  | { success: false; error: LLMFormattedError; attempts: number; totalMs: number; circuitBreakerState: CircuitState };
```

### Function Signatures

```typescript
/**
 * Wrap a tool function with retry logic, circuit breaking, and LLM error formatting.
 *
 * @param toolFn - The async tool function to wrap.
 * @param options - Configuration options.
 * @returns A new function with the same signature that includes retry logic.
 */
function withRetry<TArgs, TResult>(
  toolFn: (args: TArgs) => Promise<TResult>,
  options?: ToolRetryOptions,
): (args: TArgs) => Promise<TResult>;

/**
 * Wrap a map of named tool functions with per-tool retry policies.
 *
 * @param tools - A record of tool name to tool function.
 * @param options - Global options with optional per-tool overrides.
 * @returns A record with the same keys, where each function is wrapped with retry logic.
 */
function wrapTools<T extends Record<string, (args: any) => Promise<any>>>(
  tools: T,
  options?: WrapToolsOptions,
): T;

/**
 * Create a reusable retry policy object.
 *
 * @param options - Policy configuration.
 * @returns A RetryPolicy object.
 */
function createRetryPolicy(options?: Partial<RetryPolicy>): RetryPolicy;

/**
 * Create a circuit breaker instance.
 *
 * @param options - Circuit breaker configuration.
 * @returns A CircuitBreaker instance.
 */
function createCircuitBreaker(options?: Partial<CircuitBreakerConfig>): CircuitBreaker;

/**
 * Create a shared retry budget.
 *
 * @param options - Budget configuration.
 * @returns A RetryBudget instance.
 */
function createRetryBudget(options?: Partial<RetryBudgetConfig>): RetryBudget;

/**
 * Classify an error into a category.
 *
 * @param error - The error to classify.
 * @param customClassifier - Optional custom classifier.
 * @returns The error classification.
 */
function classifyError(error: unknown, customClassifier?: ErrorClassifier): ErrorClassification;

/**
 * Format an error for LLM consumption.
 *
 * @param error - The error to format.
 * @param options - Formatting options.
 * @returns The formatted error (object or string, depending on options).
 */
function formatErrorForLLM(error: unknown, options?: FormatErrorOptions): LLMFormattedError | string;
```

---

## 10. Per-Tool Configuration

### Global Defaults with Per-Tool Overrides

The `wrapTools` function accepts global defaults that apply to all tools, plus a `toolOptions` map for per-tool overrides. Per-tool options are merged with global defaults -- per-tool values take precedence where specified, and global defaults fill in the rest.

```typescript
const tools = wrapTools(
  { search: searchFn, weather: weatherFn, calculator: calcFn, deleteFile: deleteFn },
  {
    // Global defaults
    maxRetries: 3,
    initialDelayMs: 1000,
    jitter: 'full',
    circuitBreaker: { failureThreshold: 5 },

    // Per-tool overrides
    toolOptions: {
      search: {
        maxRetries: 5,             // Override: search is flaky, retry more aggressively
        initialDelayMs: 500,       // Override: search should retry faster
      },
      calculator: {
        maxRetries: 0,             // Override: calculator never fails transiently
        circuitBreaker: false,     // Override: no circuit breaker for local computation
      },
      deleteFile: {
        maxRetries: 0,             // Override: destructive operation, do not retry
      },
    },
  },
);
```

### MCP Tool Annotations Integration

When tool metadata includes MCP annotations, `tool-call-retry` uses them to set intelligent defaults. These annotation-derived defaults are the lowest priority -- they are overridden by both global defaults and per-tool overrides.

| Annotation | Default Behavior |
|---|---|
| `readOnlyHint: true` | `retryOnTimeout: true`. Read-only tools are always safe to retry on timeout since they have no side effects. |
| `idempotentHint: true` | `retryOnTimeout: true`, `maxRetries: 3` (normal retry). Idempotent tools can be safely retried because repeated execution has the same effect as a single execution. |
| `destructiveHint: true` | `maxRetries: 0`, `retryOnTimeout: false`. Destructive tools should never be retried by default because a timed-out delete operation may have already completed. |
| `readOnlyHint: false, idempotentHint: false` | `retryOnTimeout: false`. Non-idempotent tools with side effects should not be retried on timeout because the operation may have partially or fully completed. |

Annotations are passed via the `annotations` option:

```typescript
const wrappedTool = withRetry(deleteFileFn, {
  annotations: { destructiveHint: true },
});
// Equivalent to: withRetry(deleteFileFn, { maxRetries: 0, retryOnTimeout: false })
```

When using `wrapTools`, annotations can be provided per tool:

```typescript
const tools = wrapTools(
  { search: searchFn, deleteFile: deleteFn },
  {
    toolOptions: {
      search: { annotations: { readOnlyHint: true } },
      deleteFile: { annotations: { destructiveHint: true } },
    },
  },
);
```

### Configuration Priority

Options are resolved in this order (highest priority first):

1. **Per-tool explicit options** (`toolOptions.search.maxRetries`)
2. **Global explicit options** (`maxRetries` at the top level)
3. **MCP annotation-derived defaults** (`annotations.readOnlyHint` implies `retryOnTimeout: true`)
4. **Package defaults** (`maxRetries: 3`, `initialDelayMs: 1000`, etc.)

---

## 11. Integration

### OpenAI Function Calling

In OpenAI's function calling flow, the LLM generates `tool_calls` in its response, the application executes each tool, and the results are sent back as `tool` role messages. `tool-call-retry` wraps the tool execution step.

```typescript
import { wrapTools } from 'tool-call-retry';
import OpenAI from 'openai';

const openai = new OpenAI();

// Original tool implementations
const rawTools = {
  get_weather: async (args: { location: string }) => {
    const resp = await fetch(`https://api.weather.com/v1?loc=${args.location}`);
    if (!resp.ok) throw Object.assign(new Error(resp.statusText), { status: resp.status });
    return resp.json();
  },
  search_web: async (args: { query: string }) => {
    const resp = await fetch(`https://api.search.com/v1?q=${args.query}`);
    if (!resp.ok) throw Object.assign(new Error(resp.statusText), { status: resp.status });
    return resp.json();
  },
};

// Wrap with retry logic
const tools = wrapTools(rawTools, {
  maxRetries: 3,
  circuitBreaker: { failureThreshold: 5 },
  onPermanentFailure: 'return-error',
});

// In the tool execution loop
for (const toolCall of response.choices[0].message.tool_calls) {
  const fn = tools[toolCall.function.name];
  const args = JSON.parse(toolCall.function.arguments);
  const result = await fn(args);

  messages.push({
    role: 'tool',
    tool_call_id: toolCall.id,
    content: JSON.stringify(result),
  });
}
```

When `onPermanentFailure: 'return-error'` is configured, the wrapped function returns an `LLMFormattedError` object instead of throwing, which is then serialized as the tool result. The LLM sees a structured error object and can reason about it.

### Anthropic Tool Use

In Anthropic's tool use flow, the model generates `tool_use` content blocks, the application executes each tool, and results are sent back as `tool_result` content blocks. The `is_error` field on the tool result signals an error to the model.

```typescript
import { withRetry, formatErrorForLLM } from 'tool-call-retry';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

const searchTool = withRetry(
  async (args: { query: string }) => {
    const resp = await fetch(`https://api.search.com/v1?q=${args.query}`);
    if (!resp.ok) throw Object.assign(new Error(resp.statusText), { status: resp.status });
    return resp.json();
  },
  { maxRetries: 3 },
);

// In the tool execution loop
for (const block of response.content) {
  if (block.type === 'tool_use') {
    try {
      const result = await searchTool(block.input);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result),
      });
    } catch (error) {
      const formatted = formatErrorForLLM(error, {
        toolName: block.name,
        outputFormat: 'string',
      });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: formatted as string,
        is_error: true,
      });
    }
  }
}
```

### MCP Tool Execution

In an MCP server, tool handlers are registered via `server.setRequestHandler` or the `McpServer.tool()` helper. `tool-call-retry` wraps the tool handler function so that transient failures from downstream services are retried transparently, and permanent failures are returned as MCP-compatible `isError: true` results.

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withRetry } from 'tool-call-retry';

const server = new McpServer({ name: 'my-server', version: '1.0.0' });

const resilientWeatherFn = withRetry(
  async (args: { location: string }) => {
    const resp = await fetch(`https://api.weather.com/v1?loc=${args.location}`);
    if (!resp.ok) throw Object.assign(new Error(resp.statusText), { status: resp.status });
    return resp.json();
  },
  {
    maxRetries: 3,
    annotations: { readOnlyHint: true },
    circuitBreaker: { failureThreshold: 5 },
  },
);

server.tool(
  'get_weather',
  { location: { type: 'string', description: 'City name' } },
  async (args) => {
    try {
      const data = await resilientWeatherFn(args);
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    } catch (error) {
      // error.message is already LLM-formatted and sanitized
      return {
        content: [{ type: 'text', text: error.message }],
        isError: true,
      };
    }
  },
);
```

### Vercel AI SDK

The Vercel AI SDK defines tools with a `tool()` helper that includes an `execute` function. `tool-call-retry` wraps the execute function.

```typescript
import { tool } from 'ai';
import { z } from 'zod';
import { withRetry } from 'tool-call-retry';

const weatherTool = tool({
  description: 'Get current weather for a location',
  parameters: z.object({
    location: z.string().describe('City name'),
  }),
  execute: withRetry(
    async ({ location }) => {
      const resp = await fetch(`https://api.weather.com/v1?loc=${location}`);
      if (!resp.ok) throw Object.assign(new Error(resp.statusText), { status: resp.status });
      return resp.json();
    },
    { maxRetries: 3, annotations: { readOnlyHint: true } },
  ),
});
```

### Generic Tool Function Wrapping

For custom agent loops or frameworks not listed above, the integration is the same pattern: wrap the tool function with `withRetry` and use the wrapped function in place of the original.

```typescript
import { wrapTools } from 'tool-call-retry';

// Agent loop
const tools = wrapTools(myToolMap, { maxRetries: 3 });

while (!done) {
  const llmResponse = await callLLM(messages);

  for (const toolCall of llmResponse.toolCalls) {
    const fn = tools[toolCall.name];
    try {
      const result = await fn(toolCall.arguments);
      messages.push({ role: 'tool', content: JSON.stringify(result), toolCallId: toolCall.id });
    } catch (error) {
      // Error is already LLM-formatted by tool-call-retry
      messages.push({ role: 'tool', content: error.message, toolCallId: toolCall.id });
    }
  }
}
```

---

## 12. Configuration

### Default Values

| Option | Default | Description |
|---|---|---|
| `maxRetries` | `3` | Maximum retry attempts. Total executions = maxRetries + 1. |
| `strategy` | `'exponential'` | Backoff strategy: `'exponential'`, `'linear'`, `'fixed'`, `'custom'`. |
| `initialDelayMs` | `1000` | Initial backoff delay in milliseconds. |
| `maxDelayMs` | `30000` | Maximum backoff delay in milliseconds. |
| `multiplier` | `2` | Exponential backoff multiplier. |
| `jitter` | `'full'` | Jitter strategy: `'full'`, `'equal'`, `'decorrelated'`, `'none'`. |
| `maxTotalTimeMs` | `60000` | Maximum wall-clock time for all attempts. |
| `respectRetryAfter` | `true` | Respect `Retry-After` headers on rate-limited responses. |
| `unknownErrorBehavior` | `'retry'` | What to do with unclassified errors. |
| `retryOnTimeout` | `true` (read-only/idempotent) / `false` (other) | Whether to retry on timeout errors. |
| `onPermanentFailure` | `'throw'` | Behavior on permanent failure: `'throw'` or `'return-error'`. |
| `circuitBreaker.enabled` | `true` | Whether circuit breaking is active. |
| `circuitBreaker.failureThreshold` | `5` | Failures within rolling window to trip circuit. |
| `circuitBreaker.rollingWindowMs` | `60000` | Rolling window for counting failures. |
| `circuitBreaker.resetTimeoutMs` | `30000` | Time before open circuit transitions to half-open. |
| `circuitBreaker.successThreshold` | `1` | Consecutive successes in half-open to close circuit. |
| `circuitBreaker.onlyCountRetriableFailures` | `true` | Only retriable errors trip the circuit. |
| `sanitize` | `true` | Whether to sanitize errors for LLM consumption. |
| `maxErrorLength` | `500` | Maximum error message length after formatting. |

### Configuration Validation

All options are validated when `withRetry`, `wrapTools`, `createRetryPolicy`, or `createCircuitBreaker` is called. Invalid values throw synchronous `TypeError` with actionable messages:

| Rule | Error |
|---|---|
| `maxRetries` must be a non-negative integer | `TypeError: maxRetries must be a non-negative integer, received -1` |
| `initialDelayMs` must be a positive number | `TypeError: initialDelayMs must be a positive number, received 0` |
| `maxDelayMs` must be >= `initialDelayMs` | `TypeError: maxDelayMs (500) must be >= initialDelayMs (1000)` |
| `multiplier` must be >= 1 | `TypeError: multiplier must be >= 1, received 0.5` |
| `maxTotalTimeMs` must be a positive number or `Infinity` | `TypeError: maxTotalTimeMs must be positive, received 0` |
| `failureThreshold` must be a positive integer | `TypeError: failureThreshold must be a positive integer, received 0` |
| `rollingWindowMs` must be a positive integer | `TypeError: rollingWindowMs must be a positive integer` |
| `resetTimeoutMs` must be a positive integer | `TypeError: resetTimeoutMs must be a positive integer` |
| `successThreshold` must be a positive integer | `TypeError: successThreshold must be a positive integer` |
| `retryBudget.maxTokens` must be a positive integer | `TypeError: maxTokens must be a positive integer` |
| `retryBudget.refillRate` must be a positive number | `TypeError: refillRate must be a positive number` |

---

## 13. Testing Strategy

### Unit Tests

**Error classification tests:** Each built-in classifier is tested with targeted error objects. HTTP classifier: errors with `status`, `statusCode`, and `response.status` properties at every status code in the table (400, 401, 403, 404, 429, 500, 502, 503, 504, 529). Network classifier: errors with `code` property for each network error code. Timeout detection: errors with `TimeoutError` name, errors with "timeout" in the message. AbortError detection. Unknown error fallback. Custom classifier returning non-null overrides built-in. Custom classifier returning null falls through. Classification priority order is verified with errors that match multiple classifiers.

**Backoff calculation tests:** Exponential backoff: verify delay sequence for default configuration (1000, 2000, 4000, 8000, 16000, 30000, 30000). Verify `maxDelayMs` cap. Linear backoff: verify delay sequence (1000, 2000, 3000, 4000). Fixed delay: verify all retries use the same delay. Custom delay function: verify it is called with correct attempt number and error. Jitter tests: full jitter produces values in `[0, baseDelay]`. Equal jitter produces values in `[baseDelay/2, baseDelay]`. Decorrelated jitter produces values in `[initialDelay, 3 * previousDelay]`. No jitter produces exact base delay. Statistical tests: run jitter 10000 times and verify distribution is within expected bounds.

**Retry-After extraction tests:** Error with `Retry-After` header as integer seconds. Error with `Retry-After` as HTTP date string. Error with `retryAfter` property. Retry-After value longer than computed backoff: use Retry-After. Retry-After value shorter than computed backoff: use computed backoff. No Retry-After: use computed backoff.

**Circuit breaker tests:** Initial state is closed. Failures below threshold do not open. Failures at threshold open the circuit. Open circuit rejects calls immediately. After `resetTimeoutMs`, circuit transitions to half-open. Success in half-open closes circuit. Failure in half-open re-opens circuit. `successThreshold > 1`: requires multiple successes. `onlyCountRetriableFailures: true`: non-retriable errors do not count. `onlyCountRetriableFailures: false`: all errors count. `reset()` returns to closed. `trip()` forces open. Rolling window: old failures age out of the window. Concurrent calls in half-open: only `successThreshold` calls allowed, rest rejected. Events emitted on each state transition.

**LLM error formatting tests:** Each error code produces the expected message and suggestion template. Sanitization: stack traces are stripped. Internal URLs are masked. File paths are masked. Secret patterns are masked. Authorization headers are masked. Length truncation at `maxErrorLength`. Sanitization disabled: raw error passes through. Custom formatter overrides default. String output format produces expected text. Object output format produces expected structure.

**Retry budget tests:** Full budget allows retries. Empty budget blocks retries. Tokens refill over time. `tryConsume` returns false when empty. `reset` restores to full capacity. Concurrent consumers drain budget correctly.

### Integration Tests

**Full retry loop tests:** Mock tool function that fails N times then succeeds. Verify: correct number of attempts, correct delays between attempts, successful result returned. Mock tool that always fails with retriable error. Verify: `maxRetries` attempts made, formatted error returned. Mock tool that fails with non-retriable error. Verify: no retry attempted, formatted error returned immediately. Mock tool that fails with rate-limited error including Retry-After. Verify: retry delay respects Retry-After. Mock tool that times out. Verify: retry behavior depends on `retryOnTimeout` setting.

**Circuit breaker integration tests:** Mock tool that starts failing after initial successes. Verify: circuit opens after threshold failures, subsequent calls rejected immediately, circuit transitions to half-open after timeout, successful probe closes circuit.

**wrapTools integration tests:** Wrap multiple tools with different per-tool options. Verify: each tool respects its own configuration. Shared circuit breaker: failure in one tool affects the other. Independent circuit breakers: failure in one tool does not affect the other.

**AbortSignal tests:** Cancel a retry loop mid-backoff. Verify: loop terminates promptly, formatted error returned.

### Edge Cases

- Tool function that returns normally (no error) -- wrapper returns the result unchanged.
- Tool function that throws a non-Error value (string, number, null) -- classifier handles gracefully.
- Tool function that returns a rejected Promise -- treated as an error.
- `maxRetries: 0` -- tool is called once, any failure is permanent.
- `maxTotalTimeMs` reached during backoff delay -- loop terminates, last error returned.
- `maxTotalTimeMs` reached during tool execution -- depends on tool's internal timeout handling.
- Circuit breaker transitions during a retry loop -- subsequent retries are rejected.
- Retry budget exhausted during a retry loop -- remaining retries are skipped.
- Error with both `status` and `code` properties -- HTTP classifier takes precedence over network classifier.
- Error message containing "timeout" but not actually a timeout -- classified as `timeout` by the built-in classifier (custom classifier can override).

### Test Organization

```
src/__tests__/
  classification/
    http-classifier.test.ts           -- HTTP status code classification
    network-classifier.test.ts        -- Network error code classification
    timeout-classifier.test.ts        -- Timeout detection
    abort-classifier.test.ts          -- AbortError handling
    custom-classifier.test.ts         -- Custom classifier function
    priority.test.ts                  -- Classification priority order
  retry/
    exponential-backoff.test.ts       -- Exponential backoff calculation
    linear-backoff.test.ts            -- Linear backoff calculation
    fixed-delay.test.ts               -- Fixed delay
    custom-delay.test.ts              -- Custom delay function
    jitter.test.ts                    -- All jitter strategies
    retry-after.test.ts               -- Retry-After header extraction and respect
    retry-loop.test.ts                -- Full retry loop integration
    abort-signal.test.ts              -- AbortSignal cancellation
  circuit-breaker/
    states.test.ts                    -- State transitions (closed/open/half-open)
    threshold.test.ts                 -- Failure threshold and rolling window
    half-open.test.ts                 -- Half-open behavior and success threshold
    events.test.ts                    -- Event emission
    shared.test.ts                    -- Shared circuit breaker across tools
    manual.test.ts                    -- Manual trip/reset
  formatting/
    error-codes.test.ts               -- Error code to message/suggestion mapping
    sanitization.test.ts              -- Stack trace, URL, path, secret sanitization
    custom-formatter.test.ts          -- Custom formatter function
    output-formats.test.ts            -- Object vs string output
    truncation.test.ts                -- Length truncation
  budget/
    token-bucket.test.ts              -- Token consumption and refill
    shared-budget.test.ts             -- Budget shared across tools
  integration/
    with-retry.test.ts                -- withRetry end-to-end
    wrap-tools.test.ts                -- wrapTools end-to-end
    annotations.test.ts               -- MCP annotation integration
    openai.test.ts                    -- OpenAI function calling pattern
    anthropic.test.ts                 -- Anthropic tool use pattern
    mcp.test.ts                       -- MCP tool execution pattern
  fixtures/
    mock-tools.ts                     -- Mock tool functions (succeed, fail, flaky)
    mock-errors.ts                    -- Mock errors (HTTP, network, timeout, etc.)
```

### Test Runner

`vitest` (configured in `package.json`).

---

## 14. Performance

### Wrapper Overhead (Successful Call, No Retry)

When a tool call succeeds on the first attempt, the wrapper adds:

1. **Circuit breaker state check**: One property read and one comparison (~1 microsecond).
2. **Try-catch around the tool function**: No overhead in the success path on modern V8.
3. **Circuit breaker success recording**: One counter decrement (~1 microsecond).
4. **Timer bookkeeping**: `Date.now()` before and after the call (~1 microsecond).

**Total overhead for a successful call**: approximately 3-5 microseconds. This is negligible compared to any tool function that makes a network request (milliseconds to seconds).

### Retry Path Overhead

For each retry:

1. **Error classification**: Property reads, string comparisons (~5-10 microseconds).
2. **Backoff calculation**: Arithmetic operations, `Math.random()` (~1 microsecond).
3. **Timer delay**: `setTimeout` with the computed delay. The delay itself is the dominant factor (seconds).
4. **Circuit breaker failure recording**: Array push and length check (~1 microsecond).

The backoff delay dominates retry-path latency. The wrapper's computation adds less than 20 microseconds per retry.

### Error Formatting Overhead

When a tool fails permanently and the error is formatted:

1. **Sanitization**: Regex matching and string replacement (~10-50 microseconds for typical error messages). The regex patterns are pre-compiled at module load time.
2. **Object construction**: Creating the `LLMFormattedError` object (~5 microseconds).
3. **String formatting** (if `outputFormat: 'string'`): Template string construction (~5 microseconds).

**Total formatting overhead**: approximately 20-60 microseconds. Negligible compared to the time spent in the retry loop.

### Circuit Breaker Memory

Each circuit breaker maintains:

- Current state (`CircuitState`): one string.
- Failure timestamps array: bounded by the rolling window. At most `failureThreshold` entries (~8 bytes each). For the default threshold of 5: 40 bytes.
- Reset timer reference: one `setTimeout` handle.

**Total per-circuit-breaker memory**: approximately 100-200 bytes. For an application with 50 tools, total circuit breaker memory is under 10 KB.

### Timer Management

Backoff delays use `setTimeout`. Each active retry loop holds at most one pending timer at a time (the current backoff delay). The timer is cleared on `AbortSignal` cancellation. The `resetTimeout` timer in each open circuit breaker is a single `setTimeout` with `unref()` so it does not prevent Node.js process exit.

---

## 15. Dependencies

### Runtime Dependencies

None. `tool-call-retry` has zero runtime dependencies. All functionality is implemented using built-in JavaScript APIs:

| API | Purpose |
|---|---|
| `Math.random()` | Jitter generation |
| `Math.min()`, `Math.max()`, `Math.pow()`, `Math.ceil()` | Backoff calculation |
| `setTimeout`, `clearTimeout` | Backoff delays, circuit breaker reset timeout |
| `Date.now()` | Timing, rolling window expiration |
| `AbortSignal`, `AbortController` | Cancellation support |
| `String.prototype.replace`, `RegExp` | Error sanitization |
| `JSON.stringify` | Error formatting for string output |

### Development Dependencies

| Package | Purpose |
|---|---|
| `typescript` | TypeScript compiler |
| `vitest` | Test runner |
| `eslint` | Linting |
| `@types/node` | Node.js type definitions |

### Why Zero Dependencies

The package performs four categories of operations: arithmetic (backoff, jitter, budget), state management (circuit breaker states, retry counters), string manipulation (error sanitization, formatting), and async control flow (retry loops, timers). All four are trivially implementable with built-in JavaScript APIs. Adding a dependency for any of these would increase install size, introduce supply chain risk, and create version conflicts -- with no benefit. The total implementation is under 2000 lines of TypeScript.

---

## 16. File Structure

```
tool-call-retry/
  package.json
  tsconfig.json
  SPEC.md
  README.md
  src/
    index.ts                          -- Public API exports
    types.ts                          -- All TypeScript type definitions
    with-retry.ts                     -- withRetry function implementation
    wrap-tools.ts                     -- wrapTools function implementation
    policy.ts                         -- createRetryPolicy factory
    classification/
      index.ts                        -- classifyError function and priority chain
      http.ts                         -- HTTP status code classifier
      network.ts                      -- Node.js network error classifier
      timeout.ts                      -- Timeout detection
      abort.ts                        -- AbortError detection
    retry/
      index.ts                        -- Retry loop orchestration
      backoff.ts                      -- Backoff calculation (exponential, linear, fixed)
      jitter.ts                       -- Jitter strategy implementations
      retry-after.ts                  -- Retry-After header extraction
    circuit-breaker/
      index.ts                        -- createCircuitBreaker factory
      state-machine.ts                -- Circuit breaker state machine (closed/open/half-open)
      rolling-window.ts               -- Rolling failure window with timestamp tracking
    formatting/
      index.ts                        -- formatErrorForLLM function
      sanitizer.ts                    -- Error sanitization (stack traces, URLs, secrets)
      templates.ts                    -- Error code to message/suggestion mapping
    budget.ts                         -- createRetryBudget factory (token bucket)
  src/__tests__/
    classification/
      http-classifier.test.ts
      network-classifier.test.ts
      timeout-classifier.test.ts
      abort-classifier.test.ts
      custom-classifier.test.ts
      priority.test.ts
    retry/
      exponential-backoff.test.ts
      linear-backoff.test.ts
      fixed-delay.test.ts
      custom-delay.test.ts
      jitter.test.ts
      retry-after.test.ts
      retry-loop.test.ts
      abort-signal.test.ts
    circuit-breaker/
      states.test.ts
      threshold.test.ts
      half-open.test.ts
      events.test.ts
      shared.test.ts
      manual.test.ts
    formatting/
      error-codes.test.ts
      sanitization.test.ts
      custom-formatter.test.ts
      output-formats.test.ts
      truncation.test.ts
    budget/
      token-bucket.test.ts
      shared-budget.test.ts
    integration/
      with-retry.test.ts
      wrap-tools.test.ts
      annotations.test.ts
      openai.test.ts
      anthropic.test.ts
      mcp.test.ts
    fixtures/
      mock-tools.ts
      mock-errors.ts
  dist/                               -- Compiled output (generated by tsc)
```

---

## 17. Implementation Roadmap

### Phase 1: Core Retry and Classification (v0.1.0)

Implement the foundation: error classification, exponential backoff, and the `withRetry` function.

1. **Types**: Define all TypeScript types in `types.ts` -- `ErrorClassification`, `ErrorCategory`, `RetryPolicy`, `ToolRetryOptions`, `LLMFormattedError`, `RetryResult`, `ToolRetryHooks`.
2. **Error classification**: Implement the HTTP status code classifier, Node.js network error classifier, timeout detection, and AbortError detection. Implement the classification priority chain with custom classifier support.
3. **Exponential backoff**: Implement backoff calculation with all four jitter strategies (full, equal, decorrelated, none). Implement `maxDelayMs` cap.
4. **Retry-After extraction**: Implement `Retry-After` header parsing from error objects (integer seconds and HTTP date formats).
5. **Retry loop**: Implement the core loop -- classify error, check if retriable, compute delay, wait, retry. Implement `maxRetries` and `maxTotalTimeMs` termination. Implement `AbortSignal` cancellation.
6. **withRetry function**: Wire the retry loop into the `withRetry` wrapper function.
7. **Tests**: Full test suite for classification, backoff, jitter, and the retry loop.

### Phase 2: Circuit Breaker (v0.2.0)

Add per-tool circuit breakers.

1. **Rolling window**: Implement timestamp-based rolling failure window with automatic expiration of old entries.
2. **State machine**: Implement the closed/open/half-open state transitions with configurable thresholds.
3. **Circuit breaker factory**: Implement `createCircuitBreaker` with event emission.
4. **Integration with retry loop**: Wire circuit breaker checks before each attempt. Record successes and failures after each attempt.
5. **Half-open concurrency**: Implement the `successThreshold` gate in half-open state.
6. **Tests**: State transition tests, threshold tests, half-open behavior tests, shared circuit breaker tests.

### Phase 3: Error Formatting and Sanitization (v0.3.0)

Add LLM-friendly error formatting and message sanitization.

1. **Error templates**: Implement the error code to message/suggestion mapping for all classification codes.
2. **Sanitizer**: Implement regex-based sanitization for stack traces, internal URLs, file paths, secret patterns, and authorization headers. Pre-compile regexes at module load time.
3. **formatErrorForLLM function**: Implement the standalone formatting function with object and string output modes.
4. **Integration with withRetry**: Wire formatting into the permanent failure path of the retry wrapper.
5. **Custom formatter support**: Implement per-tool custom formatter override.
6. **Tests**: Formatting tests for every error code, sanitization tests with targeted inputs, custom formatter tests, truncation tests.

### Phase 4: wrapTools, Budget, and Annotations (v0.4.0)

Add the batch wrapper, retry budget, and MCP annotation integration.

1. **wrapTools function**: Implement the batch wrapper with global defaults and per-tool overrides. Implement configuration merging with correct priority.
2. **Retry budget**: Implement the token bucket with `tryConsume`, refill, and `reset`. Wire into the retry loop.
3. **MCP annotations**: Implement annotation-to-defaults mapping. Wire into configuration resolution priority.
4. **createRetryPolicy factory**: Implement the policy factory for creating reusable policy objects.
5. **Tests**: wrapTools integration tests, budget tests, annotation tests.

### Phase 5: Polish and Production Readiness (v1.0.0)

Harden for production use.

1. **Configuration validation**: Validate all options at construction time with clear `TypeError` messages.
2. **Edge case hardening**: Test with non-Error throws, null/undefined errors, very large error messages, concurrent retry loops, timer edge cases.
3. **Performance profiling**: Benchmark wrapper overhead, backoff calculation, and formatting. Verify sub-10-microsecond overhead for successful calls.
4. **Documentation**: Comprehensive README with installation, quick start, configuration reference, integration examples, and troubleshooting guide.

---

## 18. Example Use Cases

### Wrapping API Tools with Retry

An agent has a search tool that calls an external API. The API occasionally returns 503 during peak hours. Without retry, the agent tells the user "I couldn't search for that." With `tool-call-retry`, the 503 is retried transparently and the agent never sees it.

```typescript
import { withRetry } from 'tool-call-retry';

const searchWeb = withRetry(
  async (args: { query: string; limit?: number }) => {
    const url = new URL('https://api.search.com/v2/search');
    url.searchParams.set('q', args.query);
    url.searchParams.set('limit', String(args.limit ?? 10));

    const response = await fetch(url);
    if (!response.ok) {
      throw Object.assign(new Error(`Search API error: ${response.statusText}`), {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
      });
    }
    return response.json();
  },
  {
    maxRetries: 3,
    initialDelayMs: 1000,
    jitter: 'full',
    annotations: { readOnlyHint: true },
    hooks: {
      onRetry: ({ attempt, classification, delayMs }) => {
        console.log(`[search] Retry ${attempt}: ${classification.code}, waiting ${delayMs}ms`);
      },
    },
  },
);

// In the agent loop, use exactly like the original function
const results = await searchWeb({ query: 'latest TypeScript features', limit: 5 });
```

### MCP Server with Circuit Breakers for Flaky Downstream Services

An MCP server exposes three tools that each call different external services. One service is reliable, one is flaky, and one has strict rate limits. Each tool gets appropriate configuration.

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { wrapTools, createRetryBudget } from 'tool-call-retry';

const server = new McpServer({ name: 'research-server', version: '2.0.0' });

const budget = createRetryBudget({ maxTokens: 15, refillRate: 1 });

const toolImpls = {
  search_papers: async (args: { query: string }) => {
    // Calls a reliable academic search API
    const resp = await fetch(`https://api.papers.com/search?q=${args.query}`);
    if (!resp.ok) throw Object.assign(new Error(resp.statusText), { status: resp.status });
    return resp.json();
  },
  fetch_citations: async (args: { paperId: string }) => {
    // Calls a flaky citation service that frequently 503s
    const resp = await fetch(`https://citations.internal/api/v1/${args.paperId}`);
    if (!resp.ok) throw Object.assign(new Error(resp.statusText), { status: resp.status });
    return resp.json();
  },
  translate_abstract: async (args: { text: string; targetLang: string }) => {
    // Calls a translation API with strict rate limits
    const resp = await fetch('https://api.translate.com/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: args.text, target: args.targetLang }),
    });
    if (!resp.ok) throw Object.assign(new Error(resp.statusText), {
      status: resp.status,
      headers: Object.fromEntries(resp.headers.entries()),
    });
    return resp.json();
  },
};

const tools = wrapTools(toolImpls, {
  retryBudget: budget,
  circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 30000 },
  toolOptions: {
    search_papers: {
      maxRetries: 2,
      annotations: { readOnlyHint: true },
    },
    fetch_citations: {
      maxRetries: 4,                  // Flaky service, retry aggressively
      initialDelayMs: 500,
      circuitBreaker: { failureThreshold: 3, resetTimeoutMs: 60000 },
      annotations: { readOnlyHint: true },
    },
    translate_abstract: {
      maxRetries: 2,
      initialDelayMs: 2000,           // Rate-limited service, longer initial delay
      annotations: { readOnlyHint: true },
    },
  },
  hooks: {
    onCircuitOpen: ({ toolName, failureCount }) => {
      console.error(`[${toolName}] Circuit opened after ${failureCount} failures`);
    },
    onPermanentFailure: ({ toolName, classification, attempts }) => {
      console.error(`[${toolName}] Permanent failure: ${classification.code} after ${attempts} attempts`);
    },
  },
});

// Register each tool with the MCP server
for (const [name, fn] of Object.entries(tools)) {
  server.tool(name, {}, async (args) => {
    try {
      const result = await fn(args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: error.message }],
        isError: true,
      };
    }
  });
}
```

### LLM-Formatted Error Responses in an OpenAI Agent

An agent uses OpenAI function calling. When a tool permanently fails, the error is formatted so the LLM can reason about it and decide what to do next.

```typescript
import { wrapTools, formatErrorForLLM } from 'tool-call-retry';
import OpenAI from 'openai';

const openai = new OpenAI();

const tools = wrapTools({
  get_stock_price: async (args: { symbol: string }) => {
    const resp = await fetch(`https://api.stocks.com/v1/price/${args.symbol}`);
    if (!resp.ok) throw Object.assign(new Error(resp.statusText), { status: resp.status });
    return resp.json();
  },
  get_news: async (args: { topic: string }) => {
    const resp = await fetch(`https://api.news.com/v2/search?q=${args.topic}`);
    if (!resp.ok) throw Object.assign(new Error(resp.statusText), { status: resp.status });
    return resp.json();
  },
}, {
  maxRetries: 2,
  circuitBreaker: { failureThreshold: 3 },
});

// Agent conversation loop
const messages: OpenAI.ChatCompletionMessageParam[] = [
  { role: 'system', content: 'You are a helpful financial assistant with access to stock prices and news.' },
  { role: 'user', content: 'What is the current price of AAPL and any recent news about Apple?' },
];

while (true) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages,
    tools: [
      { type: 'function', function: { name: 'get_stock_price', parameters: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] } } },
      { type: 'function', function: { name: 'get_news', parameters: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] } } },
    ],
  });

  const choice = response.choices[0];
  messages.push(choice.message);

  if (choice.finish_reason === 'tool_calls') {
    for (const toolCall of choice.message.tool_calls!) {
      const fn = tools[toolCall.function.name as keyof typeof tools];
      const args = JSON.parse(toolCall.function.arguments);

      let content: string;
      try {
        const result = await fn(args);
        content = JSON.stringify(result);
      } catch (error) {
        // Error is already classified, retried, and formatted by tool-call-retry.
        // Format it as an LLM-readable string for the tool result.
        content = formatErrorForLLM(error, {
          toolName: toolCall.function.name,
          outputFormat: 'string',
        }) as string;
      }

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content,
      });
    }
  } else {
    // LLM finished with a text response
    console.log(choice.message.content);
    break;
  }
}
```

In this example, if `get_stock_price` returns a 503, `tool-call-retry` retries it transparently. If all retries fail, the LLM receives:

```
Error: The service experienced a temporary error after 3 attempts.
Code: SERVICE_UNAVAILABLE
Retriable: yes
Suggestion: This service is temporarily unstable. You may try again later, or use an alternative approach.
```

The LLM can then decide to: inform the user that stock prices are temporarily unavailable, proceed with just the news results, or suggest the user try again in a moment.

### Circuit Breaker Preventing Cascading Failures

An agent has a database tool that starts failing because the database is undergoing maintenance. Without a circuit breaker, the agent generates tool calls, each waits through 3 retries with backoff (10+ seconds per call), and the user experiences progressively longer delays. With a circuit breaker, after the 5th failure, subsequent calls are rejected in microseconds with a clear message.

```typescript
import { withRetry } from 'tool-call-retry';

const queryDatabase = withRetry(
  async (args: { sql: string }) => {
    const resp = await fetch('https://db-proxy.internal/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: args.sql }),
    });
    if (!resp.ok) throw Object.assign(new Error(resp.statusText), { status: resp.status });
    return resp.json();
  },
  {
    maxRetries: 2,
    circuitBreaker: {
      failureThreshold: 5,
      resetTimeoutMs: 60000,      // Wait 1 minute before testing recovery
      successThreshold: 2,         // Require 2 successes before fully reopening
      onlyCountRetriableFailures: true,
    },
    annotations: { readOnlyHint: true },
    hooks: {
      onCircuitOpen: () => {
        console.error('[database] Circuit breaker opened -- database appears to be down');
      },
      onCircuitClose: () => {
        console.log('[database] Circuit breaker closed -- database has recovered');
      },
    },
  },
);

// First 5 failed calls: each retries 2 times, circuit opens on 5th failure.
// Subsequent calls: rejected immediately with CIRCUIT_OPEN error.
// After 60 seconds: next call is allowed through as a test.
// If test succeeds twice: circuit closes, normal operation resumes.
```
