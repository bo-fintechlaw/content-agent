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

  async execute(operation, fallback = null) {
    if (this.circuitOpen) {
      console.warn(`⚠️ Circuit open for ${this.serviceName}`);
      return fallback ?? { error: 'Service temporarily unavailable' };
    }
    try {
      const result = await operation();
      this.reset();
      return result;
    } catch (error) {
      this.recordFailure();
      console.error(
        `❌ ${this.serviceName} failed (${this.failures}/${this.maxFailures}):`,
        error.message
      );
      return fallback ?? { error: error.message };
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
