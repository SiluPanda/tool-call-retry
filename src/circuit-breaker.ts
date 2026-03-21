import type { CircuitBreakerConfig, CircuitState } from './types.js';

export interface CircuitBreakerInstance {
  readonly state: CircuitState;
  readonly isCallPermitted: boolean;
  recordSuccess(): void;
  recordFailure(): void;
  on(event: 'open' | 'half-open' | 'close', fn: () => void): () => void;
}

const DEFAULTS: Required<CircuitBreakerConfig> = {
  enabled: true,
  failureThreshold: 5,
  rollingWindowMs: 60000,
  resetTimeoutMs: 30000,
  successThreshold: 1,
};

export function createCircuitBreaker(config?: CircuitBreakerConfig): CircuitBreakerInstance {
  const cfg: Required<CircuitBreakerConfig> = { ...DEFAULTS, ...config };

  let _state: CircuitState = 'closed';
  let _openedAt: number | null = null;
  let _successesInHalfOpen = 0;
  const _failureTimestamps: number[] = [];

  type EventName = 'open' | 'half-open' | 'close';
  const _listeners: Map<EventName, Set<() => void>> = new Map([
    ['open', new Set()],
    ['half-open', new Set()],
    ['close', new Set()],
  ]);

  function emit(event: EventName): void {
    const fns = _listeners.get(event);
    if (fns) fns.forEach(fn => fn());
  }

  function cleanWindow(): void {
    const cutoff = Date.now() - cfg.rollingWindowMs;
    let i = 0;
    while (i < _failureTimestamps.length && _failureTimestamps[i] < cutoff) i++;
    _failureTimestamps.splice(0, i);
  }

  function transitionToOpen(): void {
    _state = 'open';
    _openedAt = Date.now();
    _successesInHalfOpen = 0;
    emit('open');
  }

  function checkHalfOpen(): void {
    if (_state === 'open' && _openedAt !== null) {
      if (Date.now() - _openedAt >= cfg.resetTimeoutMs) {
        _state = 'half-open';
        _successesInHalfOpen = 0;
        emit('half-open');
      }
    }
  }

  return {
    get state(): CircuitState {
      checkHalfOpen();
      return _state;
    },

    get isCallPermitted(): boolean {
      checkHalfOpen();
      return _state !== 'open';
    },

    recordSuccess(): void {
      if (_state === 'half-open') {
        _successesInHalfOpen++;
        if (_successesInHalfOpen >= cfg.successThreshold) {
          _state = 'closed';
          _failureTimestamps.length = 0;
          _openedAt = null;
          _successesInHalfOpen = 0;
          emit('close');
        }
      }
      // In closed state successes don't change anything
    },

    recordFailure(): void {
      if (_state === 'half-open') {
        transitionToOpen();
        return;
      }
      if (_state === 'open') {
        // Already open, just update timestamp
        _openedAt = Date.now();
        return;
      }
      // closed state — track failure in rolling window
      cleanWindow();
      _failureTimestamps.push(Date.now());
      if (_failureTimestamps.length >= cfg.failureThreshold) {
        transitionToOpen();
      }
    },

    on(event: EventName, fn: () => void): () => void {
      const set = _listeners.get(event);
      if (set) set.add(fn);
      return () => {
        const s = _listeners.get(event);
        if (s) s.delete(fn);
      };
    },
  };
}
