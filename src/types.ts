export type ErrorCategory = 'retriable' | 'non-retriable' | 'rate-limited' | 'timeout' | 'unknown';

export interface ErrorClassification {
  category: ErrorCategory;
  code: string;
  message: string;
  statusCode?: number;
  retryAfterMs?: number;
}

export type ErrorClassifier = (error: unknown) => ErrorClassification | null;

export type BackoffStrategy = 'exponential' | 'linear' | 'fixed' | 'custom';
export type JitterStrategy = 'full' | 'equal' | 'decorrelated' | 'none';
export type CircuitState = 'closed' | 'open' | 'half-open';

export interface RetryPolicy {
  maxRetries?: number;       // default 3
  strategy?: BackoffStrategy; // default 'exponential'
  initialDelayMs?: number;   // default 1000
  maxDelayMs?: number;       // default 30000
  multiplier?: number;       // default 2
  jitter?: JitterStrategy;   // default 'full'
  maxTotalTimeMs?: number;   // default 60000
}

export interface CircuitBreakerConfig {
  enabled?: boolean;          // default true
  failureThreshold?: number;  // default 5
  rollingWindowMs?: number;   // default 60000
  resetTimeoutMs?: number;    // default 30000
  successThreshold?: number;  // default 1
}

export interface LLMFormattedError {
  error: true;
  code: string;
  message: string;
  retriable: boolean;
  suggestion: string;
  tool?: string;
  attemptsMade?: number;
}

export interface ToolRetryOptions {
  policy?: RetryPolicy;
  maxRetries?: number;        // shorthand
  circuitBreaker?: CircuitBreakerConfig | false;
  circuitBreakerInstance?: import('./circuit-breaker.js').CircuitBreakerInstance;
  classifyError?: ErrorClassifier;
  onPermanentFailure?: 'throw' | 'return-error';
  signal?: AbortSignal;
  hooks?: ToolRetryHooks;
}

export interface ToolRetryHooks {
  onRetry?: (info: { attempt: number; error: unknown; delayMs: number; classification: ErrorClassification }) => void;
  onSuccess?: (info: { attempts: number; totalMs: number }) => void;
  onPermanentFailure?: (info: { error: unknown; attempts: number; totalMs: number; formattedError: LLMFormattedError }) => void;
}
