import { describe, it, expect } from 'vitest';
import { computeDelay } from '../backoff.js';
import type { RetryPolicy } from '../types.js';

function makePolicy(overrides?: Partial<RetryPolicy>): Required<RetryPolicy> {
  return {
    maxRetries: 3,
    strategy: 'exponential',
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    multiplier: 2,
    jitter: 'none',
    maxTotalTimeMs: 60000,
    ...overrides,
  };
}

describe('computeDelay', () => {
  describe('exponential strategy', () => {
    it('returns initialDelayMs on attempt 1', () => {
      const policy = makePolicy();
      const delay = computeDelay(1, policy, policy.initialDelayMs);
      expect(delay).toBe(1000);
    });

    it('doubles on attempt 2', () => {
      const policy = makePolicy();
      const delay = computeDelay(2, policy, 1000);
      expect(delay).toBe(2000);
    });

    it('grows to 4x on attempt 3', () => {
      const policy = makePolicy();
      const delay = computeDelay(3, policy, 2000);
      expect(delay).toBe(4000);
    });

    it('is capped at maxDelayMs', () => {
      const policy = makePolicy({ maxDelayMs: 3000 });
      const delay = computeDelay(5, policy, 3000);
      expect(delay).toBe(3000);
    });
  });

  describe('linear strategy', () => {
    it('returns 1x initialDelayMs on attempt 1', () => {
      const policy = makePolicy({ strategy: 'linear' });
      expect(computeDelay(1, policy, 1000)).toBe(1000);
    });

    it('returns 2x initialDelayMs on attempt 2', () => {
      const policy = makePolicy({ strategy: 'linear' });
      expect(computeDelay(2, policy, 1000)).toBe(2000);
    });

    it('is capped at maxDelayMs', () => {
      const policy = makePolicy({ strategy: 'linear', maxDelayMs: 1500 });
      expect(computeDelay(3, policy, 1500)).toBe(1500);
    });
  });

  describe('fixed strategy', () => {
    it('always returns initialDelayMs', () => {
      const policy = makePolicy({ strategy: 'fixed' });
      expect(computeDelay(1, policy, 0)).toBe(1000);
      expect(computeDelay(5, policy, 5000)).toBe(1000);
    });
  });

  describe('jitter', () => {
    const rng05 = () => 0.5;
    const rng0 = () => 0;
    const rng1 = () => 0.9999;

    it('full jitter: result is in [0, baseDelay]', () => {
      const policy = makePolicy({ jitter: 'full', strategy: 'exponential' });
      for (let i = 0; i < 20; i++) {
        const delay = computeDelay(1, policy, 1000);
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(1000);
      }
    });

    it('full jitter: scales with rng value', () => {
      const policy = makePolicy({ jitter: 'full', strategy: 'exponential' });
      expect(computeDelay(1, policy, 1000, rng05)).toBe(Math.round(0.5 * 1000));
      expect(computeDelay(1, policy, 1000, rng0)).toBe(0);
    });

    it('equal jitter: result is in [baseDelay/2, baseDelay]', () => {
      const policy = makePolicy({ jitter: 'equal', strategy: 'exponential' });
      for (let i = 0; i < 20; i++) {
        const delay = computeDelay(1, policy, 1000);
        expect(delay).toBeGreaterThanOrEqual(500);
        expect(delay).toBeLessThanOrEqual(1000);
      }
    });

    it('equal jitter: lower bound is baseDelay/2 when rng=0', () => {
      const policy = makePolicy({ jitter: 'equal', strategy: 'exponential' });
      expect(computeDelay(1, policy, 1000, rng0)).toBe(500);
    });

    it('none jitter: returns exact baseDelay', () => {
      const policy = makePolicy({ jitter: 'none' });
      expect(computeDelay(2, policy, 1000)).toBe(2000);
    });

    it('decorrelated: bounded by maxDelayMs', () => {
      const policy = makePolicy({ jitter: 'decorrelated', strategy: 'exponential', maxDelayMs: 5000 });
      for (let i = 0; i < 20; i++) {
        const delay = computeDelay(2, policy, 1000);
        expect(delay).toBeLessThanOrEqual(5000);
      }
    });

    it('decorrelated: uses rng correctly', () => {
      const policy = makePolicy({ jitter: 'decorrelated', strategy: 'exponential', maxDelayMs: 30000 });
      // decorrelated = rng * (prev*3 - initial) + initial, prev=1000
      // = rng * (3000 - 1000) + 1000 = rng * 2000 + 1000
      const prev = 1000;
      expect(computeDelay(1, policy, prev, rng0)).toBe(Math.round(0 * 2000 + 1000));
      expect(computeDelay(1, policy, prev, rng1)).toBe(Math.round(0.9999 * 2000 + 1000));
    });
  });

  describe('maxDelayMs enforcement', () => {
    it('caps exponential at maxDelayMs with none jitter', () => {
      const policy = makePolicy({ maxDelayMs: 500, strategy: 'exponential', jitter: 'none' });
      expect(computeDelay(10, policy, 500)).toBe(500);
    });
  });
});
