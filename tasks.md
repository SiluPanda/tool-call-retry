# tool-call-retry — Implementation Tasks

This file tracks all implementation tasks derived from [SPEC.md](./SPEC.md). Each task is granular, actionable, and grouped into logical phases matching the spec's implementation roadmap.

---

## Phase 0: Project Scaffolding

- [x] **Install dev dependencies** — Add `typescript`, `vitest`, `eslint`, and `@types/node` as devDependencies in `package.json`. Verify `npm install` succeeds. | Status: done
- [x] **Configure vitest** — Add vitest configuration (either in `vitest.config.ts` or within `package.json`) with TypeScript support. Ensure `npm run test` works with an empty test file. | Status: done
- [x] **Configure eslint** — Add ESLint configuration for TypeScript linting. Ensure `npm run lint` works against `src/`. | Status: done
- [x] **Create directory structure** — Create all source directories per the spec's file structure: `src/classification/`, `src/retry/`, `src/circuit-breaker/`, `src/formatting/`, and all test directories under `src/__tests__/` (classification, retry, circuit-breaker, formatting, budget, integration, fixtures). | Status: done
- [x] **Create stub source files** — Create empty/placeholder `.ts` files for every source module listed in the spec's file structure (Section 16): `types.ts`, `with-retry.ts`, `wrap-tools.ts`, `policy.ts`, `budget.ts`, and all files under `classification/`, `retry/`, `circuit-breaker/`, `formatting/`. | Status: done

---

## Phase 1: Type Definitions

- [x] **Define ErrorCategory type** — Define the `ErrorCategory` union type: `'retriable' | 'non-retriable' | 'rate-limited' | 'timeout' | 'unknown'` in `src/types.ts`. | Status: done
- [x] **Define ErrorClassification interface** — Define the `ErrorClassification` interface with `category`, `code`, `message`, optional `statusCode`, and optional `retryAfterMs` fields in `src/types.ts`. | Status: done
- [x] **Define ErrorClassifier type** — Define the `ErrorClassifier` function type: `(error: unknown) => ErrorClassification | null` in `src/types.ts`. | Status: done
- [x] **Define BackoffStrategy type** — Define the `BackoffStrategy` union type: `'exponential' | 'linear' | 'fixed' | 'custom'` in `src/types.ts`. | Status: done
- [x] **Define JitterStrategy type** — Define the `JitterStrategy` union type: `'full' | 'equal' | 'decorrelated' | 'none'` in `src/types.ts`. | Status: done
- [ ] **Define RetryPolicy interface** — Define the `RetryPolicy` interface with all fields: `maxRetries`, `strategy`, `initialDelayMs`, `maxDelayMs`, `multiplier`, `delayMs`, `delayFn`, `jitter`, `maxTotalTimeMs`, `respectRetryAfter`, `unknownErrorBehavior`, `retryOnTimeout` in `src/types.ts`. | Status: not_done
- [x] **Define CircuitState type** — Define the `CircuitState` union type: `'closed' | 'open' | 'half-open'` in `src/types.ts`. | Status: done
- [ ] **Define CircuitBreakerConfig interface** — Define the `CircuitBreakerConfig` interface with `enabled`, `failureThreshold`, `rollingWindowMs`, `resetTimeoutMs`, `successThreshold`, `onlyCountRetriableFailures` in `src/types.ts`. | Status: not_done
- [ ] **Define CircuitBreaker interface** — Define the `CircuitBreaker` interface with readonly properties (`state`, `failureCount`, `isCallPermitted`, `remainingOpenMs`), methods (`trip()`, `reset()`), and event subscription methods (`on`, `off`) in `src/types.ts`. | Status: not_done
- [ ] **Define RetryBudgetConfig interface** — Define the `RetryBudgetConfig` interface with `maxTokens` and `refillRate` in `src/types.ts`. | Status: not_done
- [ ] **Define RetryBudget interface** — Define the `RetryBudget` interface with `remaining`, `tryConsume()`, and `reset()` in `src/types.ts`. | Status: not_done
- [x] **Define LLMFormattedError interface** — Define the `LLMFormattedError` interface with `error`, `code`, `message`, `retriable`, `suggestion`, optional `tool`, optional `attemptsMade` in `src/types.ts`. | Status: done
- [ ] **Define FormatErrorOptions interface** — Define the `FormatErrorOptions` interface with `toolName`, `outputFormat`, `maxErrorLength`, `sanitize`, `sanitizer`, `customFormatter` in `src/types.ts`. | Status: not_done
- [ ] **Define ToolRetryOptions interface** — Define the `ToolRetryOptions` interface with all fields: `policy`, `maxRetries`, `strategy`, `initialDelayMs`, `maxDelayMs`, `multiplier`, `jitter`, `maxTotalTimeMs`, `circuitBreaker`, `classifyError`, `formatError`, `onPermanentFailure`, `retryBudget`, `annotations`, `signal`, `hooks` in `src/types.ts`. | Status: not_done
- [ ] **Define WrapToolsOptions interface** — Define the `WrapToolsOptions` interface extending `ToolRetryOptions` with `toolOptions` in `src/types.ts`. | Status: not_done
- [ ] **Define ToolRetryHooks interface** — Define the `ToolRetryHooks` interface with `onRetry`, `onCircuitOpen`, `onCircuitHalfOpen`, `onCircuitClose`, `onPermanentFailure`, `onSuccess` in `src/types.ts`. | Status: not_done
- [ ] **Define RetryResult type** — Define the `RetryResult<T>` discriminated union type with success and failure variants in `src/types.ts`. | Status: not_done
- [x] **Verify types compile** — Run `npm run build` and verify all types compile without errors. | Status: done

---

## Phase 2: Error Classification

- [ ] **Implement HTTP status code classifier** — In `src/classification/http.ts`, implement a function that checks for `status`, `statusCode`, or `response.status` on the error and classifies per the HTTP status code table: 400=non-retriable, 401=non-retriable, 403=non-retriable, 404=non-retriable, 405=non-retriable, 409=non-retriable, 422=non-retriable, 429=rate-limited, 500=retriable, 502=retriable, 503=retriable, 504=retriable, 529=retriable. Return null for unrecognized status codes. | Status: not_done
- [ ] **Implement network error classifier** — In `src/classification/network.ts`, implement a function that checks the error's `code` property and classifies per the network error table: ECONNREFUSED=retriable, ECONNRESET=retriable, ETIMEDOUT=timeout, ENOTFOUND=non-retriable, EPIPE=retriable, EAI_AGAIN=retriable, EHOSTUNREACH=retriable, CERT_HAS_EXPIRED=non-retriable, UNABLE_TO_VERIFY_LEAF_SIGNATURE=non-retriable. Return null for unrecognized codes. | Status: not_done
- [ ] **Implement timeout detection** — In `src/classification/timeout.ts`, implement a function that checks if the error message contains "timeout" (case-insensitive) or the error name is `TimeoutError`, and classifies as `timeout`. Return null if no match. | Status: not_done
- [x] **Implement AbortError detection** — In `src/classification/abort.ts`, implement a function that checks if the error is an `AbortError` (by instance or by `name` property) and classifies as `non-retriable`. Return null if not an AbortError. | Status: done
- [x] **Implement classification priority chain** — In `src/classification/index.ts`, implement the `classifyError` function that chains classifiers in priority order: (1) custom per-tool classifier, (2) abort/cancellation check, (3) HTTP status code classifier, (4) network error classifier, (5) timeout detection, (6) fallback to `unknown`. Export `classifyError` as a public API. | Status: done
- [x] **Handle non-Error thrown values** — Ensure all classifiers handle edge cases where the thrown value is not an Error object (e.g., string, number, null, undefined). The classifier should not throw; it should fall through to `unknown`. | Status: done
- [ ] **Extract Retry-After value during classification** — When the HTTP classifier identifies a 429 status, extract the `Retry-After` value from the error's `headers`, `response.headers`, or `retryAfter` property and include it as `retryAfterMs` in the `ErrorClassification`. Parse both integer-seconds and HTTP-date formats. | Status: not_done

### Error Classification Tests

- [ ] **Test HTTP classifier with `status` property** — Write tests in `src/__tests__/classification/http-classifier.test.ts` for errors with a `status` property for each status code (400, 401, 403, 404, 405, 409, 422, 429, 500, 502, 503, 504, 529). Verify correct category and code. | Status: not_done
- [x] **Test HTTP classifier with `statusCode` property** — Verify the classifier works with errors using `statusCode` instead of `status`. | Status: done
- [ ] **Test HTTP classifier with `response.status` property** — Verify the classifier works with errors using `response.status` (e.g., axios-style errors). | Status: not_done
- [ ] **Test HTTP classifier returns null for unknown status** — Verify classifier returns null for unrecognized HTTP status codes (e.g., 418). | Status: not_done
- [ ] **Test network error classifier** — Write tests in `src/__tests__/classification/network-classifier.test.ts` for each network error code (ECONNREFUSED, ECONNRESET, ETIMEDOUT, ENOTFOUND, EPIPE, EAI_AGAIN, EHOSTUNREACH, CERT_HAS_EXPIRED, UNABLE_TO_VERIFY_LEAF_SIGNATURE). | Status: not_done
- [ ] **Test timeout detection** — Write tests in `src/__tests__/classification/timeout-classifier.test.ts` for errors with "timeout" in message (various cases), errors with name `TimeoutError`, and errors that should not match (e.g., message containing "time" but not "timeout"). | Status: not_done
- [x] **Test AbortError detection** — Write tests in `src/__tests__/classification/abort-classifier.test.ts` for native `AbortError`, errors with `name: 'AbortError'`, and non-abort errors. | Status: done
- [x] **Test custom classifier** — Write tests in `src/__tests__/classification/custom-classifier.test.ts` for custom classifier returning a classification, custom classifier returning null (fallthrough to built-in), and custom classifier taking precedence over built-in. | Status: done
- [ ] **Test classification priority order** — Write tests in `src/__tests__/classification/priority.test.ts` verifying that an error matching multiple classifiers is classified by the highest-priority one (e.g., custom > abort > HTTP > network > timeout > unknown). | Status: not_done
- [ ] **Test non-Error thrown values** — Verify classifyError handles string, number, null, undefined, and plain object throws gracefully, returning `unknown` classification. | Status: not_done

---

## Phase 3: Backoff and Delay Calculation

- [x] **Implement exponential backoff** — In `src/retry/backoff.ts`, implement exponential backoff calculation: `min(initialDelayMs * multiplier^(attempt - 1), maxDelayMs)`. The function takes attempt number (1-indexed), `initialDelayMs`, `multiplier`, and `maxDelayMs`. | Status: done
- [x] **Implement linear backoff** — In `src/retry/backoff.ts`, implement linear backoff: `initialDelayMs * attempt`. | Status: done
- [x] **Implement fixed delay** — In `src/retry/backoff.ts`, implement fixed delay that returns the same `delayMs` regardless of attempt number. | Status: done
- [ ] **Implement custom delay function support** — In `src/retry/backoff.ts`, support a custom delay function `(attempt: number, error: unknown) => number` for the `'custom'` strategy. | Status: not_done
- [x] **Implement full jitter** — In `src/retry/jitter.ts`, implement full jitter: `random(0, baseDelay)`. | Status: done
- [x] **Implement equal jitter** — In `src/retry/jitter.ts`, implement equal jitter: `baseDelay / 2 + random(0, baseDelay / 2)`. | Status: done
- [x] **Implement decorrelated jitter** — In `src/retry/jitter.ts`, implement decorrelated jitter: `random(initialDelayMs, previousDelay * 3)`. This requires tracking the previous delay. | Status: done
- [x] **Implement no-jitter option** — In `src/retry/jitter.ts`, implement the `'none'` jitter strategy that returns the exact base delay. | Status: done
- [ ] **Implement Retry-After header extraction** — In `src/retry/retry-after.ts`, implement extraction of `Retry-After` values from error objects. Check `error.headers['retry-after']`, `error.response.headers['retry-after']`, and `error.retryAfter`. Parse as integer seconds or HTTP date string. Convert to milliseconds. | Status: not_done
- [x] **Implement Retry-After vs computed backoff logic** — When `Retry-After` is present, use the maximum of the `Retry-After` value and the computed backoff delay (never retry sooner than the computed backoff). | Status: done

### Backoff and Delay Tests

- [x] **Test exponential backoff sequence** — Write tests in `src/__tests__/retry/exponential-backoff.test.ts` verifying the delay sequence for default config: 1000, 2000, 4000, 8000, 16000, 30000, 30000 (capped). | Status: done
- [x] **Test exponential backoff maxDelayMs cap** — Verify delays never exceed `maxDelayMs`. | Status: done
- [ ] **Test exponential backoff with custom multiplier** — Verify multiplier other than 2 works correctly. | Status: not_done
- [x] **Test linear backoff sequence** — Write tests in `src/__tests__/retry/linear-backoff.test.ts` verifying: 1000, 2000, 3000, 4000 with default `initialDelayMs`. | Status: done
- [x] **Test fixed delay** — Write tests in `src/__tests__/retry/fixed-delay.test.ts` verifying all attempts return the same delay. | Status: done
- [ ] **Test custom delay function** — Write tests in `src/__tests__/retry/custom-delay.test.ts` verifying the custom function is called with correct attempt number and error, and its return value is used. | Status: not_done
- [x] **Test full jitter bounds** — Write tests in `src/__tests__/retry/jitter.test.ts` verifying full jitter produces values in `[0, baseDelay]`. Run 1000+ iterations and check bounds. | Status: done
- [x] **Test equal jitter bounds** — Verify equal jitter produces values in `[baseDelay/2, baseDelay]`. | Status: done
- [x] **Test decorrelated jitter bounds** — Verify decorrelated jitter produces values in `[initialDelayMs, previousDelay * 3]`. | Status: done
- [x] **Test no-jitter returns exact delay** — Verify `'none'` jitter returns the exact computed base delay. | Status: done
- [ ] **Test jitter statistical distribution** — Run jitter strategies 10000 times and verify the distribution is within expected bounds (not all clustered at one end). | Status: not_done
- [x] **Test Retry-After extraction from integer seconds** — Write tests in `src/__tests__/retry/retry-after.test.ts` for `Retry-After: 5` (should yield 5000ms). | Status: done
- [ ] **Test Retry-After extraction from HTTP date string** — Verify parsing of HTTP date format `Retry-After`. | Status: not_done
- [x] **Test Retry-After from `retryAfter` property** — Verify extraction from `error.retryAfter`. | Status: done
- [x] **Test Retry-After longer than computed backoff** — Verify Retry-After value is used when it exceeds computed backoff. | Status: done
- [ ] **Test Retry-After shorter than computed backoff** — Verify computed backoff is used when it exceeds Retry-After. | Status: not_done
- [x] **Test missing Retry-After** — Verify computed backoff is used when no Retry-After is present. | Status: done

---

## Phase 4: Core Retry Loop and `withRetry`

- [x] **Implement retry loop orchestration** — In `src/retry/index.ts`, implement the core retry loop: execute tool function, on error classify it, check if retriable, compute delay, wait (using setTimeout wrapped in a Promise), retry. Terminate on: maxRetries exceeded, non-retriable error, maxTotalTimeMs exceeded, AbortSignal aborted. | Status: done
- [x] **Implement maxRetries termination** — Stop retrying after `maxRetries` attempts. Total executions = `maxRetries + 1`. | Status: done
- [x] **Implement maxTotalTimeMs termination** — Track total elapsed wall-clock time. If the time limit is reached before the next attempt or during a backoff delay, terminate the loop and return the last error. | Status: done
- [x] **Implement AbortSignal cancellation** — Accept an `AbortSignal` and terminate the retry loop promptly when aborted. Clear pending backoff timers on cancellation. | Status: done
- [ ] **Implement unknown error behavior** — Respect the `unknownErrorBehavior` option: `'retry'` treats unknown errors as retriable; `'fail'` treats them as non-retriable. | Status: not_done
- [ ] **Implement retryOnTimeout behavior** — Respect the `retryOnTimeout` option for timeout-classified errors. Default depends on MCP annotations (true for read-only/idempotent, false otherwise). | Status: not_done
- [x] **Implement event hook calls in retry loop** — Call `hooks.onRetry` before each retry with attempt info. Call `hooks.onSuccess` on successful completion. Call `hooks.onPermanentFailure` on permanent failure. | Status: done
- [x] **Implement withRetry function** — In `src/with-retry.ts`, implement the `withRetry<TArgs, TResult>` function that takes a tool function and options, resolves the effective policy (from explicit options, policy object, annotations, and defaults), creates a circuit breaker if needed, and returns a wrapped function with the same signature. | Status: done
- [x] **Implement onPermanentFailure behavior modes** — Support `'throw'` (throw an error with LLM-formatted message) and `'return-error'` (return the `LLMFormattedError` object or `RetryResult`). | Status: done
- [ ] **Implement RetryResult tracking** — Track and return `attempts` count and `totalMs` duration on both success and failure paths. | Status: not_done

### Retry Loop Tests

- [x] **Test successful call with no retries** — Write tests in `src/__tests__/retry/retry-loop.test.ts`: mock tool that succeeds on first call. Verify result is returned unchanged, attempts = 1. | Status: done
- [x] **Test retriable error with eventual success** — Mock tool that fails N times with retriable error then succeeds. Verify correct number of attempts, correct result returned. | Status: done
- [x] **Test retriable error exhausting maxRetries** — Mock tool that always fails with retriable error. Verify `maxRetries + 1` total executions, formatted error returned/thrown. | Status: done
- [x] **Test non-retriable error returns immediately** — Mock tool that fails with non-retriable error (e.g., 400). Verify no retry attempted, formatted error returned immediately, attempts = 1. | Status: done
- [x] **Test rate-limited error with Retry-After** — Mock tool that fails with 429 and Retry-After header. Verify retry delay respects Retry-After value. | Status: done
- [ ] **Test timeout error retry behavior** — Verify timeout errors are retried when `retryOnTimeout: true` and not retried when `retryOnTimeout: false`. | Status: not_done
- [ ] **Test maxTotalTimeMs termination** — Verify retry loop terminates when total elapsed time exceeds `maxTotalTimeMs`, even if retries remain. | Status: not_done
- [ ] **Test maxRetries: 0** — Verify tool is called once and any failure is treated as permanent. | Status: not_done
- [ ] **Test unknown error with retry behavior** — Verify unknown errors are retried when `unknownErrorBehavior: 'retry'`. | Status: not_done
- [ ] **Test unknown error with fail behavior** — Verify unknown errors are treated as non-retriable when `unknownErrorBehavior: 'fail'`. | Status: not_done
- [x] **Test onRetry hook is called** — Verify `hooks.onRetry` is called before each retry with correct attempt, maxRetries, classification, and delayMs. | Status: done
- [x] **Test onSuccess hook is called** — Verify `hooks.onSuccess` is called on success with correct attempts and totalMs. | Status: done
- [x] **Test onPermanentFailure hook is called** — Verify `hooks.onPermanentFailure` is called on permanent failure with correct info. | Status: done
- [ ] **Test AbortSignal cancellation** — Write tests in `src/__tests__/retry/abort-signal.test.ts`: abort during backoff delay. Verify loop terminates promptly, formatted error returned. | Status: not_done
- [ ] **Test AbortSignal already aborted** — Verify if signal is already aborted before first call, tool is not executed. | Status: not_done
- [x] **Test onPermanentFailure: 'throw'** — Verify error is thrown with LLM-formatted message. | Status: done
- [x] **Test onPermanentFailure: 'return-error'** — Verify `LLMFormattedError` or `RetryResult` object is returned. | Status: done
- [x] **Test correct delays between attempts** — Use fake timers to verify correct backoff delays are applied between retries. | Status: done

---

## Phase 5: Circuit Breaker

- [x] **Implement rolling failure window** — In `src/circuit-breaker/rolling-window.ts`, implement a timestamp-based rolling window that tracks failure timestamps. Entries older than `rollingWindowMs` are automatically expired on each check. Provide methods to record a failure, get the current failure count within the window, and reset. | Status: done
- [x] **Implement circuit breaker state machine** — In `src/circuit-breaker/state-machine.ts`, implement the three-state machine (closed/open/half-open) with transitions: closed -> open (failure threshold exceeded), open -> half-open (reset timeout elapsed), half-open -> closed (success threshold met), half-open -> open (failure in half-open). | Status: done
- [x] **Implement closed state behavior** — In closed state: tool calls pass through. Record failures and successes. Transition to open when failure count in rolling window exceeds `failureThreshold`. | Status: done
- [x] **Implement open state behavior** — In open state: reject all calls immediately without executing the tool. After `resetTimeoutMs`, transition to half-open. Use `setTimeout` with `unref()` for the reset timer. | Status: done
- [x] **Implement half-open state behavior** — In half-open state: allow up to `successThreshold` calls through. If all succeed consecutively, close the circuit. If any fails, re-open the circuit. Reject additional calls beyond `successThreshold` as if circuit were open. | Status: done
- [ ] **Implement onlyCountRetriableFailures** — When `onlyCountRetriableFailures` is true, only errors classified as retriable, rate-limited, or timeout count toward the failure threshold. Non-retriable errors (400, 401, 403, 404) do not trip the circuit. | Status: not_done
- [ ] **Implement circuit breaker event emission** — Emit events on state transitions: `open` (with failureCount), `half-open`, `close` (with successCount), `rejection` (with remainingMs). Implement `on()` and `off()` methods. | Status: not_done
- [ ] **Implement manual trip() and reset()** — `trip()` forces the circuit to open state. `reset()` forces the circuit to closed state with failure counter reset. | Status: not_done
- [ ] **Implement circuit breaker readonly properties** — Expose `state`, `failureCount`, `isCallPermitted`, and `remainingOpenMs` as readonly properties. | Status: not_done
- [x] **Implement createCircuitBreaker factory** — In `src/circuit-breaker/index.ts`, implement the `createCircuitBreaker(options?)` factory that creates a `CircuitBreaker` instance with defaults filled in. Export as public API. | Status: done
- [x] **Integrate circuit breaker with retry loop** — Wire circuit breaker checks into the retry loop: (1) check before each attempt, (2) record success/failure after each attempt, (3) if circuit opens during retry loop, remaining retries are rejected. | Status: done
- [ ] **Support shared circuit breakers** — When a `CircuitBreaker` instance is passed to `withRetry` or `wrapTools`, use it directly instead of creating a new one. Multiple tools can share the same instance. | Status: not_done
- [x] **Support disabling circuit breaker** — When `circuitBreaker: false` is passed, no circuit breaker is used for that tool. | Status: done

### Circuit Breaker Tests

- [x] **Test initial state is closed** — Write tests in `src/__tests__/circuit-breaker/states.test.ts`: verify new circuit breaker starts in closed state with `isCallPermitted: true`. | Status: done
- [x] **Test closed -> open transition** — Record failures exceeding `failureThreshold` within `rollingWindowMs`. Verify circuit transitions to open. | Status: done
- [x] **Test open -> half-open transition** — After circuit opens, advance time past `resetTimeoutMs`. Verify circuit transitions to half-open. | Status: done
- [x] **Test half-open -> closed transition** — In half-open, record `successThreshold` consecutive successes. Verify circuit transitions to closed. | Status: done
- [x] **Test half-open -> open transition** — In half-open, record a failure. Verify circuit transitions back to open. | Status: done
- [x] **Test failures below threshold do not open** — Write tests in `src/__tests__/circuit-breaker/threshold.test.ts`: record failures below threshold. Verify circuit stays closed. | Status: done
- [x] **Test rolling window expiration** — Record failures, advance time past `rollingWindowMs`, verify old failures age out and circuit stays closed even if new failures occur (as long as new count is below threshold). | Status: done
- [x] **Test open circuit rejects calls** — Verify calls during open state are rejected immediately without executing the tool function. | Status: done
- [ ] **Test successThreshold > 1** — Write tests in `src/__tests__/circuit-breaker/half-open.test.ts`: verify multiple consecutive successes required to close circuit when `successThreshold > 1`. | Status: not_done
- [ ] **Test half-open concurrency limiting** — Verify only `successThreshold` concurrent calls are allowed in half-open; additional calls are rejected. | Status: not_done
- [ ] **Test onlyCountRetriableFailures: true** — Verify non-retriable errors (400, 401, etc.) do not increment failure counter. | Status: not_done
- [ ] **Test onlyCountRetriableFailures: false** — Verify all errors count toward threshold when setting is false. | Status: not_done
- [x] **Test event emission on open** — Write tests in `src/__tests__/circuit-breaker/events.test.ts`: verify `open` event emitted with `failureCount`. | Status: done
- [x] **Test event emission on half-open** — Verify `half-open` event emitted on transition. | Status: done
- [x] **Test event emission on close** — Verify `close` event emitted with `successCount`. | Status: done
- [ ] **Test event emission on rejection** — Verify `rejection` event emitted with `remainingMs`. | Status: not_done
- [ ] **Test manual trip()** — Write tests in `src/__tests__/circuit-breaker/manual.test.ts`: verify `trip()` forces circuit to open from any state. | Status: not_done
- [ ] **Test manual reset()** — Verify `reset()` forces circuit to closed with failure counter reset. | Status: not_done
- [ ] **Test shared circuit breaker** — Write tests in `src/__tests__/circuit-breaker/shared.test.ts`: two tools sharing a circuit breaker. Failures in one tool affect the other. | Status: not_done
- [ ] **Test independent circuit breakers** — Verify tools with separate circuit breakers do not affect each other. | Status: not_done
- [x] **Test circuit breaker transitions during retry loop** — Verify that if the circuit opens mid-retry-loop, remaining retries are rejected immediately. | Status: done
- [ ] **Wire onCircuitOpen/onCircuitHalfOpen/onCircuitClose hooks** — Verify that `ToolRetryHooks` circuit breaker hooks are called on the corresponding state transitions when used via `withRetry`. | Status: not_done

---

## Phase 6: LLM Error Formatting and Sanitization

- [ ] **Implement error code to template mapping** — In `src/formatting/templates.ts`, define the mapping from error classification to code, default message, and default suggestion for all codes: `SERVICE_UNAVAILABLE`, `INVALID_ARGUMENTS`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `RATE_LIMITED`, `TIMEOUT`, `INTERNAL_ERROR`, `CIRCUIT_OPEN`. Support `{attempts}` and `{timeoutMs}` template placeholders. | Status: not_done
- [x] **Implement stack trace removal** — In `src/formatting/sanitizer.ts`, implement regex to strip content after lines matching `^\s+at\s+` (Node.js stack trace). Remove `stack` properties. | Status: done
- [ ] **Implement internal URL masking** — Mask URLs matching internal patterns: RFC 1918 addresses (`10.x.x.x`, `192.168.x.x`, `172.16-31.x.x`), `localhost`, `.internal`, `.local`. Replace with `[internal service]`. | Status: not_done
- [ ] **Implement file path masking** — Mask absolute file paths (`/home/...`, `/Users/...`, `/var/...`, `C:\...`). Replace with `[server path]`. | Status: not_done
- [x] **Implement secret pattern masking** — Mask common secret patterns: API keys (`sk-...`, `pk_...`, `AKIA...`), Bearer tokens (`Bearer ...`), connection strings with credentials. Replace with `[redacted]`. | Status: done
- [ ] **Implement header masking** — Mask Authorization headers, cookie values, and session tokens. Replace with `[redacted]`. | Status: not_done
- [ ] **Implement length truncation** — Truncate error messages exceeding `maxErrorLength` (default: 500) with `... (truncated)`. | Status: not_done
- [x] **Pre-compile sanitization regexes** — Ensure all sanitization regex patterns are compiled at module load time (not per-call) for performance. | Status: done
- [x] **Implement formatErrorForLLM function** — In `src/formatting/index.ts`, implement the `formatErrorForLLM` function that takes an error and options, classifies it (if not already classified), applies sanitization, maps to the error template, and returns either an `LLMFormattedError` object or a formatted string depending on `outputFormat`. | Status: done
- [x] **Implement object output format** — Return `LLMFormattedError` object with all fields populated. | Status: done
- [ ] **Implement string output format** — Return a plain string in the format: `Error: <message>\nCode: <code>\nRetriable: yes|no\nSuggestion: <suggestion>`. | Status: not_done
- [ ] **Implement custom formatter support** — When a `customFormatter` function is provided, call it instead of the default formatting logic. Still apply sanitization to the result unless `sanitize: false`. | Status: not_done
- [ ] **Implement sanitize: false option** — When `sanitize: false`, skip all sanitization and pass the raw error message through. | Status: not_done
- [ ] **Implement custom sanitizer support** — When a custom `sanitizer` function is provided, use it instead of the built-in sanitization. | Status: not_done
- [x] **Integrate formatting with withRetry** — Wire `formatErrorForLLM` into the permanent failure path of `withRetry`. The thrown error or returned error object should contain the formatted, sanitized message. | Status: done

### LLM Error Formatting Tests

- [ ] **Test each error code produces correct template** — Write tests in `src/__tests__/formatting/error-codes.test.ts` for every error code mapping: SERVICE_UNAVAILABLE, INVALID_ARGUMENTS, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, RATE_LIMITED, TIMEOUT, INTERNAL_ERROR, CIRCUIT_OPEN. Verify message and suggestion match spec. | Status: not_done
- [ ] **Test stack trace removal** — Write tests in `src/__tests__/formatting/sanitization.test.ts`: error message containing Node.js stack trace lines. Verify stack traces are stripped. | Status: not_done
- [ ] **Test internal URL masking** — Verify internal URLs (10.0.0.1, 192.168.1.1, localhost:3000, service.internal) are replaced with `[internal service]`. | Status: not_done
- [ ] **Test file path masking** — Verify absolute file paths (/home/user/app/index.js, /Users/dev/project/src, C:\Users\app) are replaced with `[server path]`. | Status: not_done
- [ ] **Test secret pattern masking** — Verify API keys (sk-..., pk_test_..., AKIA...), Bearer tokens are replaced with `[redacted]`. | Status: not_done
- [ ] **Test header masking** — Verify Authorization header values and cookie values are replaced with `[redacted]`. | Status: not_done
- [ ] **Test length truncation** — Write tests in `src/__tests__/formatting/truncation.test.ts`: error message exceeding 500 chars. Verify truncated with `... (truncated)`. | Status: not_done
- [ ] **Test custom maxErrorLength** — Verify custom `maxErrorLength` values are respected. | Status: not_done
- [ ] **Test sanitization disabled** — Verify `sanitize: false` passes raw error through without stripping. | Status: not_done
- [ ] **Test custom sanitizer** — Verify custom `sanitizer` function is called instead of built-in sanitization. | Status: not_done
- [ ] **Test custom formatter** — Write tests in `src/__tests__/formatting/custom-formatter.test.ts`: verify custom formatter function is called with correct error and classification, and its return value is used. | Status: not_done
- [ ] **Test object output format** — Write tests in `src/__tests__/formatting/output-formats.test.ts`: verify `outputFormat: 'object'` returns `LLMFormattedError` with all required fields. | Status: not_done
- [ ] **Test string output format** — Verify `outputFormat: 'string'` returns correctly formatted string. | Status: not_done
- [ ] **Test template placeholder substitution** — Verify `{attempts}` and `{timeoutMs}` are replaced with actual values in messages. | Status: not_done

---

## Phase 7: `wrapTools`, Retry Budget, and MCP Annotations

- [x] **Implement wrapTools function** — In `src/wrap-tools.ts`, implement the `wrapTools` function that takes a `Record<string, (args: any) => Promise<any>>` and `WrapToolsOptions`, iterates over each tool, merges global defaults with per-tool overrides (per-tool takes precedence), and calls `withRetry` for each. Return a record with the same keys and wrapped functions. | Status: done
- [ ] **Implement configuration merging** — Implement the four-level configuration priority: (1) per-tool explicit, (2) global explicit, (3) MCP annotation-derived defaults, (4) package defaults. Ensure correct deep merging for nested objects like `circuitBreaker`. | Status: not_done
- [ ] **Implement per-tool circuit breakers in wrapTools** — By default, each tool gets its own circuit breaker. When a shared `CircuitBreaker` instance is passed, all tools use it. When `circuitBreaker: false` is passed per-tool, that tool has no circuit breaker. | Status: not_done
- [x] **Implement tool name propagation** — Pass the tool name (map key) to the retry wrapper so it appears in hooks, events, and formatted errors. | Status: done
- [ ] **Implement retry budget (token bucket)** — In `src/budget.ts`, implement the `createRetryBudget` factory with token bucket algorithm: starts with `maxTokens`, `tryConsume()` returns true and decrements if tokens available, tokens refill at `refillRate` per second (using elapsed time calculation, not timers). Implement `remaining` property and `reset()` method. | Status: not_done
- [ ] **Integrate retry budget with retry loop** — Before each retry attempt, check `retryBudget.tryConsume()`. If it returns false (budget exhausted), treat the error as non-retriable and return formatted error immediately. | Status: not_done
- [ ] **Implement MCP annotation-to-defaults mapping** — When `annotations` are provided: `readOnlyHint: true` -> `retryOnTimeout: true`; `idempotentHint: true` -> `retryOnTimeout: true`, `maxRetries: 3`; `destructiveHint: true` -> `maxRetries: 0`, `retryOnTimeout: false`; `readOnlyHint: false, idempotentHint: false` -> `retryOnTimeout: false`. | Status: not_done
- [x] **Implement createRetryPolicy factory** — In `src/policy.ts`, implement `createRetryPolicy(options?)` that takes partial options and returns a fully-resolved `RetryPolicy` with all defaults filled in. | Status: done
- [x] **Support policy option in withRetry** — When a `policy` object is provided to `withRetry`, use its values as the base configuration (overridden by any explicit inline options). | Status: done

### wrapTools Tests

- [x] **Test wrapTools wraps all tools** — Write tests in `src/__tests__/integration/wrap-tools.test.ts`: verify all tools in the map are wrapped and callable. | Status: done
- [x] **Test global defaults apply to all tools** — Verify global `maxRetries` applies to tools without per-tool overrides. | Status: done
- [ ] **Test per-tool overrides** — Verify per-tool options override global defaults. | Status: not_done
- [ ] **Test per-tool circuit breaker independence** — Verify tools have independent circuit breakers by default. Failure in one does not affect the other. | Status: not_done
- [ ] **Test shared circuit breaker via wrapTools** — Verify shared circuit breaker affects all tools that share it. | Status: not_done
- [x] **Test circuitBreaker: false per-tool** — Verify setting `circuitBreaker: false` disables circuit breaking for that specific tool. | Status: done
- [x] **Test tool name appears in hooks and errors** — Verify tool name (map key) is passed through to hooks and formatted errors. | Status: done

### Retry Budget Tests

- [ ] **Test full budget allows retries** — Write tests in `src/__tests__/budget/token-bucket.test.ts`: verify `tryConsume()` returns true when tokens available. | Status: not_done
- [ ] **Test empty budget blocks retries** — Drain all tokens, verify `tryConsume()` returns false. | Status: not_done
- [ ] **Test token refill over time** — Consume tokens, advance time, verify tokens replenished at `refillRate` per second. | Status: not_done
- [ ] **Test remaining property** — Verify `remaining` reflects current available tokens. | Status: not_done
- [ ] **Test reset() restores full capacity** — Verify `reset()` restores tokens to `maxTokens`. | Status: not_done
- [ ] **Test budget exhaustion stops retries in retry loop** — Write tests in `src/__tests__/budget/shared-budget.test.ts`: wrap tools with shared budget, exhaust budget. Verify subsequent tool failures are not retried. | Status: not_done
- [ ] **Test budget shared across multiple tools** — Verify two tools sharing a budget drain from the same pool. | Status: not_done

### MCP Annotation Tests

- [ ] **Test readOnlyHint: true defaults** — Write tests in `src/__tests__/integration/annotations.test.ts`: verify `retryOnTimeout` defaults to true. | Status: not_done
- [ ] **Test idempotentHint: true defaults** — Verify `retryOnTimeout: true` and `maxRetries: 3`. | Status: not_done
- [ ] **Test destructiveHint: true defaults** — Verify `maxRetries: 0` and `retryOnTimeout: false`. | Status: not_done
- [ ] **Test non-idempotent, non-readonly defaults** — Verify `retryOnTimeout: false`. | Status: not_done
- [ ] **Test explicit options override annotations** — Verify explicit `maxRetries` or `retryOnTimeout` override annotation-derived defaults. | Status: not_done
- [ ] **Test annotation priority is lowest** — Verify configuration priority: per-tool > global > annotation > package defaults. | Status: not_done

### createRetryPolicy Tests

- [x] **Test createRetryPolicy with defaults** — Verify returned policy has all default values filled in. | Status: done
- [x] **Test createRetryPolicy with partial overrides** — Verify specified values override defaults, unspecified values get defaults. | Status: done
- [x] **Test policy used with withRetry** — Verify a policy object can be passed to `withRetry` and its values are used. | Status: done

---

## Phase 8: Configuration Validation

- [ ] **Validate maxRetries** — Throw `TypeError` if `maxRetries` is not a non-negative integer. Include received value in message. | Status: not_done
- [ ] **Validate initialDelayMs** — Throw `TypeError` if `initialDelayMs` is not a positive number. | Status: not_done
- [ ] **Validate maxDelayMs >= initialDelayMs** — Throw `TypeError` if `maxDelayMs` is less than `initialDelayMs`. Include both values in message. | Status: not_done
- [ ] **Validate multiplier >= 1** — Throw `TypeError` if `multiplier` is less than 1. | Status: not_done
- [ ] **Validate maxTotalTimeMs** — Throw `TypeError` if `maxTotalTimeMs` is not a positive number or `Infinity`. | Status: not_done
- [ ] **Validate failureThreshold** — Throw `TypeError` if `failureThreshold` is not a positive integer. | Status: not_done
- [ ] **Validate rollingWindowMs** — Throw `TypeError` if `rollingWindowMs` is not a positive integer. | Status: not_done
- [ ] **Validate resetTimeoutMs** — Throw `TypeError` if `resetTimeoutMs` is not a positive integer. | Status: not_done
- [ ] **Validate successThreshold** — Throw `TypeError` if `successThreshold` is not a positive integer. | Status: not_done
- [ ] **Validate retryBudget.maxTokens** — Throw `TypeError` if `maxTokens` is not a positive integer. | Status: not_done
- [ ] **Validate retryBudget.refillRate** — Throw `TypeError` if `refillRate` is not a positive number. | Status: not_done
- [ ] **Validate at construction time** — Ensure all validation happens synchronously when `withRetry`, `wrapTools`, `createRetryPolicy`, or `createCircuitBreaker` is called, not at invocation time. | Status: not_done
- [ ] **Write validation tests** — Write tests for every validation rule, verifying the exact `TypeError` message format matches the spec. | Status: not_done

---

## Phase 9: Edge Case Hardening

- [x] **Test tool function returns normally** — Verify wrapper returns the result unchanged with no formatting applied. | Status: done
- [ ] **Test tool function throws non-Error value (string)** — Verify classifier handles string throw gracefully. | Status: not_done
- [ ] **Test tool function throws non-Error value (number)** — Verify classifier handles number throw gracefully. | Status: not_done
- [ ] **Test tool function throws null** — Verify classifier handles null throw gracefully. | Status: not_done
- [ ] **Test tool function throws undefined** — Verify classifier handles undefined throw gracefully. | Status: not_done
- [ ] **Test tool function returns rejected Promise** — Verify rejected promise is treated as an error and classified. | Status: not_done
- [ ] **Test maxTotalTimeMs reached during backoff delay** — Verify loop terminates during backoff wait, last error is returned. | Status: not_done
- [ ] **Test circuit breaker transitions during retry loop** — Verify if circuit opens mid-loop, remaining retries are rejected instantly. | Status: not_done
- [ ] **Test retry budget exhausted during retry loop** — Verify remaining retries are skipped when budget empties mid-loop. | Status: not_done
- [x] **Test error with both status and code** — Verify HTTP classifier takes precedence over network classifier. | Status: done
- [ ] **Test error message containing "timeout" that is not a timeout** — Verify it is classified as timeout by built-in classifier but can be overridden by custom classifier. | Status: not_done
- [ ] **Test very large error messages** — Verify length truncation works correctly for messages much larger than `maxErrorLength`. | Status: not_done
- [ ] **Test concurrent retry loops on same wrapped function** — Verify each invocation has its own retry state but shares the circuit breaker. | Status: not_done

---

## Phase 10: Integration Tests

- [ ] **Test withRetry end-to-end** — Write tests in `src/__tests__/integration/with-retry.test.ts`: full flow including classification, retry, circuit breaker, and formatting for a mock tool. | Status: not_done
- [ ] **Test wrapTools end-to-end** — Write tests in `src/__tests__/integration/wrap-tools.test.ts`: wrap multiple tools with different configs, verify each behaves correctly. | Status: not_done
- [ ] **Test OpenAI function calling pattern** — Write tests in `src/__tests__/integration/openai.test.ts`: simulate OpenAI tool calling loop with wrapped tools, verify error results are LLM-formatted. | Status: not_done
- [ ] **Test Anthropic tool use pattern** — Write tests in `src/__tests__/integration/anthropic.test.ts`: simulate Anthropic tool use loop, verify `is_error` results. | Status: not_done
- [ ] **Test MCP tool execution pattern** — Write tests in `src/__tests__/integration/mcp.test.ts`: simulate MCP tools/call with wrapped handlers, verify `isError` results. | Status: not_done

---

## Phase 11: Test Fixtures

- [ ] **Create mock tool functions** — In `src/__tests__/fixtures/mock-tools.ts`, create reusable mock functions: always-succeed tool, always-fail tool (with configurable error), flaky tool (fail N times then succeed), slow tool (configurable delay), tool that throws non-Error values. | Status: not_done
- [ ] **Create mock error objects** — In `src/__tests__/fixtures/mock-errors.ts`, create reusable mock errors: HTTP errors at each status code (with `status`, `statusCode`, `response.status` variants), network errors at each code, timeout errors, AbortError, errors with Retry-After headers (integer and date format), errors with stack traces, errors with internal URLs, errors with file paths, errors with secrets. | Status: not_done

---

## Phase 12: Public API Exports

- [ ] **Export all public functions from index.ts** — In `src/index.ts`, re-export: `withRetry`, `wrapTools`, `createRetryPolicy`, `createCircuitBreaker`, `createRetryBudget`, `classifyError`, `formatErrorForLLM`. | Status: not_done
- [ ] **Export all public types from index.ts** — Re-export all public types: `ErrorCategory`, `ErrorClassification`, `ErrorClassifier`, `BackoffStrategy`, `JitterStrategy`, `RetryPolicy`, `CircuitState`, `CircuitBreakerConfig`, `CircuitBreaker`, `RetryBudgetConfig`, `RetryBudget`, `LLMFormattedError`, `FormatErrorOptions`, `ToolRetryOptions`, `WrapToolsOptions`, `ToolRetryHooks`, `RetryResult`. | Status: not_done
- [ ] **Verify public API compiles and is importable** — Run `npm run build` and verify all exports are accessible from `dist/index.js` and `dist/index.d.ts`. | Status: not_done

---

## Phase 13: Documentation

- [ ] **Write README.md** — Create comprehensive README with: package description, installation instructions, quick start example, `withRetry` usage, `wrapTools` usage, `createRetryPolicy` usage, `createCircuitBreaker` usage, `createRetryBudget` usage, `classifyError` usage, `formatErrorForLLM` usage, configuration reference table, MCP annotation integration, integration examples (OpenAI, Anthropic, MCP, Vercel AI SDK, generic agent loop), error classification reference, troubleshooting guide. | Status: not_done

---

## Phase 14: Final Verification

- [ ] **Run full test suite** — `npm run test` passes with all tests green. | Status: not_done
- [ ] **Run linter** — `npm run lint` passes with no errors. | Status: not_done
- [ ] **Run build** — `npm run build` succeeds with no TypeScript errors. | Status: not_done
- [x] **Verify zero runtime dependencies** — Check `package.json` has no `dependencies` field (only `devDependencies`). | Status: done
- [x] **Verify package.json version** — Ensure version is appropriate for the implementation phase. | Status: done
- [ ] **Verify exports match spec** — Manually verify all 7 public functions and 17 public types are exported. | Status: not_done
