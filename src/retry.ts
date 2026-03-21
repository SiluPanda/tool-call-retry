import type { LLMFormattedError, RetryPolicy, ToolRetryOptions } from './types.js';
import { classifyError } from './classify.js';
import { computeDelay } from './backoff.js';
import { createCircuitBreaker } from './circuit-breaker.js';
import { formatErrorForLLM } from './format-error.js';

export function createRetryPolicy(options?: Partial<RetryPolicy>): Required<RetryPolicy> {
  return {
    maxRetries: options?.maxRetries ?? 3,
    strategy: options?.strategy ?? 'exponential',
    initialDelayMs: options?.initialDelayMs ?? 1000,
    maxDelayMs: options?.maxDelayMs ?? 30000,
    multiplier: options?.multiplier ?? 2,
    jitter: options?.jitter ?? 'full',
    maxTotalTimeMs: options?.maxTotalTimeMs ?? 60000,
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: ToolRetryOptions & { toolName?: string }
): Promise<T | LLMFormattedError> {
  const policy = createRetryPolicy({
    ...options?.policy,
    ...(options?.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
  });

  const cb =
    options?.circuitBreaker !== false
      ? createCircuitBreaker(
          options?.circuitBreaker === undefined ? undefined : options.circuitBreaker
        )
      : null;

  const startTime = Date.now();
  let prevDelay = policy.initialDelayMs;
  let attempt = 0;

  while (true) {
    // Check circuit breaker before each attempt
    if (cb && !cb.isCallPermitted) {
      const formatted = formatErrorForLLM(
        new Error('Circuit breaker is open'),
        { toolName: options?.toolName, attemptsMade: attempt }
      );
      if (options?.onPermanentFailure === 'return-error') return formatted;
      const err = new Error('Circuit breaker is open');
      options?.hooks?.onPermanentFailure?.({
        error: err,
        attempts: attempt,
        totalMs: Date.now() - startTime,
        formattedError: formatted,
      });
      throw err;
    }

    try {
      const result = await fn();
      cb?.recordSuccess();
      options?.hooks?.onSuccess?.({ attempts: attempt + 1, totalMs: Date.now() - startTime });
      return result;
    } catch (error) {
      // Check if aborted by signal
      if (options?.signal?.aborted) {
        throw error;
      }

      cb?.recordFailure();
      const classification = classifyError(error, options?.classifyError);
      attempt++;

      const isPermanent =
        classification.category === 'non-retriable' || attempt > policy.maxRetries;

      if (isPermanent) {
        const formatted = formatErrorForLLM(error, {
          toolName: options?.toolName,
          attemptsMade: attempt,
        });
        options?.hooks?.onPermanentFailure?.({
          error,
          attempts: attempt,
          totalMs: Date.now() - startTime,
          formattedError: formatted,
        });
        if (options?.onPermanentFailure === 'return-error') return formatted;
        throw error;
      }

      // Check total time budget
      if (Date.now() - startTime >= policy.maxTotalTimeMs) {
        const formatted = formatErrorForLLM(error, {
          toolName: options?.toolName,
          attemptsMade: attempt,
        });
        options?.hooks?.onPermanentFailure?.({
          error,
          attempts: attempt,
          totalMs: Date.now() - startTime,
          formattedError: formatted,
        });
        if (options?.onPermanentFailure === 'return-error') return formatted;
        throw error;
      }

      let delay = computeDelay(attempt, policy, prevDelay);
      if (classification.retryAfterMs !== undefined) {
        delay = Math.max(delay, classification.retryAfterMs);
      }
      prevDelay = delay;

      options?.hooks?.onRetry?.({ attempt, error, delayMs: delay, classification });

      await sleep(delay, options?.signal);
    }
  }
}

export function wrapTools<T extends Record<string, (args: unknown) => Promise<unknown>>>(
  tools: T,
  options?: ToolRetryOptions
): T {
  const wrapped: Record<string, (args: unknown) => Promise<unknown>> = {};
  for (const key of Object.keys(tools)) {
    const original = tools[key];
    wrapped[key] = (args: unknown) =>
      withRetry(() => original(args), { ...options, toolName: key }) as Promise<unknown>;
  }
  return wrapped as T;
}
