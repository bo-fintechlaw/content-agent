/**
 * Circuit breaker for external services (architecture spec section 8).
 */

export class CircuitBreaker {
  constructor(serviceName, maxFailures = 3, resetTimeout = 60000) {
    this.serviceName = serviceName;
    this.failures = 0;
    this.maxFailures = maxFailures;
    this.circuitOpen = false;
    this.resetTimeout = resetTimeout;
  }

  /**
   * Run `operation`. On failure, return a fallback whose `reason` / `status`
   * fields carry the *real* upstream error so callers can surface it to humans
   * instead of a fixed sentinel.
   *
   * `fallback` may be:
   *  - a string: shorthand for `{ error: <string> }`
   *  - an object: returned as-is, augmented with `reason` + `status`
   *  - null / undefined: derive a minimal `{ error }` from the upstream message
   *
   * The object form preserves legacy callsites that depend on a specific
   * fallback shape (e.g. `{ data: { id: null }, error: 'linkedin_unavailable' }`).
   */
  async execute(operation, fallback = null) {
    const fallbackObj =
      typeof fallback === 'string'
        ? { error: fallback }
        : fallback && typeof fallback === 'object'
          ? { ...fallback }
          : null;

    if (this.circuitOpen) {
      console.warn(`⚠️ Circuit open for ${this.serviceName}`);
      return {
        ...(fallbackObj ?? { error: 'Service temporarily unavailable' }),
        reason: `circuit_open:${this.serviceName}`,
        status: null,
      };
    }
    try {
      const result = await operation();
      this.reset();
      return result;
    } catch (error) {
      this.recordFailure();
      const rawMessage = error?.message ?? String(error);
      const status = error?.status ?? error?.response?.status ?? null;
      console.error(
        `❌ ${this.serviceName} failed (${this.failures}/${this.maxFailures}):`,
        rawMessage
      );
      return {
        ...(fallbackObj ?? { error: rawMessage }),
        reason: rawMessage.slice(0, 500),
        status,
      };
    }
  }

  recordFailure() {
    this.failures++;
    if (this.failures >= this.maxFailures) {
      this.circuitOpen = true;
      setTimeout(() => this.reset(), this.resetTimeout);
    }
  }

  reset() {
    this.failures = 0;
    this.circuitOpen = false;
  }
}
