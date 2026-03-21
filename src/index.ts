// tool-call-retry - AI-specific retry wrapper with circuit breaker for tool calls
export { withRetry, wrapTools, createRetryPolicy } from './retry.js';
export { createCircuitBreaker } from './circuit-breaker.js';
export { classifyError } from './classify.js';
export { formatErrorForLLM } from './format-error.js';

export type {
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
} from './types.js';

export type { CircuitBreakerInstance } from './circuit-breaker.js';

