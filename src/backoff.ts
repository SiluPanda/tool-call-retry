import type { RetryPolicy } from './types.js';

export function computeDelay(
  attempt: number,
  policy: Required<RetryPolicy>,
  previousDelay: number,
  rng: () => number = Math.random
): number {
  let baseDelay: number;

  switch (policy.strategy) {
    case 'exponential':
      baseDelay = Math.min(
        policy.initialDelayMs * Math.pow(policy.multiplier, attempt - 1),
        policy.maxDelayMs
      );
      break;
    case 'linear':
      baseDelay = Math.min(policy.initialDelayMs * attempt, policy.maxDelayMs);
      break;
    case 'fixed':
    case 'custom':
    default:
      baseDelay = Math.min(policy.initialDelayMs, policy.maxDelayMs);
      break;
  }

  let finalDelay: number;

  switch (policy.jitter) {
    case 'full':
      finalDelay = rng() * baseDelay;
      break;
    case 'equal':
      finalDelay = baseDelay / 2 + rng() * (baseDelay / 2);
      break;
    case 'decorrelated':
      finalDelay = Math.min(
        rng() * (previousDelay * 3 - policy.initialDelayMs) + policy.initialDelayMs,
        policy.maxDelayMs
      );
      break;
    case 'none':
    default:
      finalDelay = baseDelay;
      break;
  }

  return Math.round(finalDelay);
}
