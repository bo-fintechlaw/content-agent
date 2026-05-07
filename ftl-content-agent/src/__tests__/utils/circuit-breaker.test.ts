import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const { CircuitBreaker } = await import('../../utils/circuit-breaker.js');

describe('CircuitBreaker', () => {
  let breaker: InstanceType<typeof CircuitBreaker>;

  beforeEach(() => {
    breaker = new CircuitBreaker('test-service', 3, 60000);
    jest.clearAllMocks();
  });

  it('returns the result of a successful operation', async () => {
    const result = await breaker.execute(() => Promise.resolve('ok'));
    expect(result).toBe('ok');
  });

  it('returns fallback shape on failure, augmented with real reason', async () => {
    const result = await breaker.execute(
      () => Promise.reject(new Error('fail')),
      { error: 'fallback' }
    );
    expect(result).toMatchObject({ error: 'fallback', reason: 'fail', status: null });
  });

  it('preserves all fallback object fields (e.g. nested data) on failure', async () => {
    const result = await breaker.execute(
      () => Promise.reject(new Error('boom')),
      { data: { id: null }, error: 'linkedin_unavailable' }
    );
    expect(result).toMatchObject({
      data: { id: null },
      error: 'linkedin_unavailable',
      reason: 'boom',
    });
  });

  it('returns default error object when no fallback provided', async () => {
    const result = await breaker.execute(() => Promise.reject(new Error('boom')));
    expect(result).toMatchObject({ error: 'boom', reason: 'boom' });
  });

  it('opens circuit after max failures', async () => {
    for (let i = 0; i < 3; i++) {
      await breaker.execute(() => Promise.reject(new Error('fail')));
    }
    // Circuit should now be open
    const result = await breaker.execute(
      () => Promise.resolve('should not run'),
      { error: 'Service temporarily unavailable' }
    );
    expect(result).toMatchObject({
      error: 'Service temporarily unavailable',
      reason: 'circuit_open:test-service',
    });
  });

  it('resets failure count on success', async () => {
    await breaker.execute(() => Promise.reject(new Error('fail1')));
    await breaker.execute(() => Promise.reject(new Error('fail2')));
    // 2 failures, then a success should reset
    await breaker.execute(() => Promise.resolve('ok'));
    // Should not be open
    const result = await breaker.execute(() => Promise.resolve('still ok'));
    expect(result).toBe('still ok');
  });

  it('tracks failure count correctly', async () => {
    await breaker.execute(() => Promise.reject(new Error('f1')));
    expect(breaker.failures).toBe(1);
    await breaker.execute(() => Promise.reject(new Error('f2')));
    expect(breaker.failures).toBe(2);
  });

  it('circuit stays closed below threshold', async () => {
    await breaker.execute(() => Promise.reject(new Error('f1')));
    await breaker.execute(() => Promise.reject(new Error('f2')));
    expect(breaker.circuitOpen).toBe(false);
    // Third failure should open it
    await breaker.execute(() => Promise.reject(new Error('f3')));
    expect(breaker.circuitOpen).toBe(true);
  });

  it('uses default fallback when circuit is open and no fallback given', async () => {
    for (let i = 0; i < 3; i++) {
      await breaker.execute(() => Promise.reject(new Error('fail')));
    }
    const result = await breaker.execute(() => Promise.resolve('nope'));
    expect(result).toMatchObject({
      error: 'Service temporarily unavailable',
      reason: 'circuit_open:test-service',
    });
  });
});
