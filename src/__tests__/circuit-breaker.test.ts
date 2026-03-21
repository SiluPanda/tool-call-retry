import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCircuitBreaker } from '../circuit-breaker.js';

describe('createCircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts in closed state', () => {
    const cb = createCircuitBreaker({ failureThreshold: 3 });
    expect(cb.state).toBe('closed');
    expect(cb.isCallPermitted).toBe(true);
  });

  it('remains closed below failure threshold', () => {
    const cb = createCircuitBreaker({ failureThreshold: 3 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.state).toBe('closed');
    expect(cb.isCallPermitted).toBe(true);
  });

  it('opens after reaching failure threshold', () => {
    const cb = createCircuitBreaker({ failureThreshold: 3 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.state).toBe('open');
    expect(cb.isCallPermitted).toBe(false);
  });

  it('emits "open" event when transitioning to open', () => {
    const cb = createCircuitBreaker({ failureThreshold: 2 });
    const handler = vi.fn();
    cb.on('open', handler);
    cb.recordFailure();
    cb.recordFailure();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('transitions to half-open after resetTimeoutMs', () => {
    const cb = createCircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 5000 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.state).toBe('open');

    vi.advanceTimersByTime(5000);
    expect(cb.state).toBe('half-open');
    expect(cb.isCallPermitted).toBe(true);
  });

  it('emits "half-open" event on transition', () => {
    const cb = createCircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 5000 });
    const handler = vi.fn();
    cb.on('half-open', handler);
    cb.recordFailure();
    cb.recordFailure();
    vi.advanceTimersByTime(5000);
    // Accessing state triggers the checkHalfOpen transition
    expect(cb.state).toBe('half-open');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('closes after success in half-open state', () => {
    const cb = createCircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 5000, successThreshold: 1 });
    cb.recordFailure();
    cb.recordFailure();
    vi.advanceTimersByTime(5000);
    expect(cb.state).toBe('half-open');

    cb.recordSuccess();
    expect(cb.state).toBe('closed');
    expect(cb.isCallPermitted).toBe(true);
  });

  it('emits "close" event when closing from half-open', () => {
    const cb = createCircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 5000 });
    const handler = vi.fn();
    cb.on('close', handler);
    cb.recordFailure();
    cb.recordFailure();
    vi.advanceTimersByTime(5000);
    void cb.state; // trigger half-open
    cb.recordSuccess();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('goes back to open on failure in half-open state', () => {
    const cb = createCircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 5000 });
    cb.recordFailure();
    cb.recordFailure();
    vi.advanceTimersByTime(5000);
    expect(cb.state).toBe('half-open');

    cb.recordFailure();
    expect(cb.state).toBe('open');
    expect(cb.isCallPermitted).toBe(false);
  });

  it('resets failure count after closing', () => {
    const cb = createCircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure(); // open

    vi.advanceTimersByTime(1000);
    void cb.state; // half-open
    cb.recordSuccess(); // close

    // Should need 3 new failures to open again
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.state).toBe('closed');
    cb.recordFailure();
    expect(cb.state).toBe('open');
  });

  it('removes listener when unsubscribe function is called', () => {
    const cb = createCircuitBreaker({ failureThreshold: 2 });
    const handler = vi.fn();
    const unsubscribe = cb.on('open', handler);
    unsubscribe();
    cb.recordFailure();
    cb.recordFailure();
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not count failures outside rolling window', () => {
    const cb = createCircuitBreaker({
      failureThreshold: 3,
      rollingWindowMs: 5000,
    });
    cb.recordFailure();
    cb.recordFailure();
    // Advance past rolling window
    vi.advanceTimersByTime(6000);
    // This failure is within the window, the previous two are not
    cb.recordFailure();
    expect(cb.state).toBe('closed');
  });
});
