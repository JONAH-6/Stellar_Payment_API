import { logger } from '../../src/lib/logging';

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN'
}

export class ErrorRecovery {
  private maxRetries = 3;
  private circuitState: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private failureThreshold = 5;

  private isRetryable(error: any): boolean {
    const nonRetryableReasons = ['invalid_signature', 'malformed_request', 'authorization_failure'];
    if (error && error.reason && nonRetryableReasons.includes(error.reason)) {
      return false;
    }
    // Assume other DB failures / Horizon timeouts are retryable
    return true;
  }

  public async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    if (this.circuitState === CircuitState.OPEN) {
      throw new Error('Circuit Breaker is OPEN');
    }

    let attempt = 0;
    while (attempt <= this.maxRetries) {
      try {
        const result = await operation();
        this.onSuccess();
        return result;
      } catch (error) {
        attempt++;
        if (!this.isRetryable(error) || attempt > this.maxRetries) {
          this.onFailure();
          throw error;
        }
        logger.warn({ event: "path_payment_retry", attempt });
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
    throw new Error('Max retries exceeded');
  }

  private onSuccess() {
    this.failureCount = 0;
    this.circuitState = CircuitState.CLOSED;
  }

  private onFailure() {
    this.failureCount++;
    if (this.failureCount >= this.failureThreshold) {
      this.circuitState = CircuitState.OPEN;
      // In a real app, transition to half-open after a timeout
      setTimeout(() => {
        this.circuitState = CircuitState.HALF_OPEN;
      }, 10000);
    }
  }
}
