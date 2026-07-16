import {
  type CircuitBreakerPolicy,
  ConsecutiveBreaker,
  circuitBreaker,
  handleAll,
} from "cockatiel";

// D-02 resolution: BullMQ owns RETRY scheduling; cockatiel owns the CIRCUIT BREAKER only.
// We deliberately do NOT use cockatiel retry() — that would nest against BullMQ attempts (Pitfall 3).
// The returned policy is a MODULE-LEVEL SINGLETON in the worker: it accumulates consecutive
// failures across multiple BullMQ job attempts (Pitfall 1 — never recreate per job).
export function createCrmPolicy(halfOpenAfterMs: number): CircuitBreakerPolicy {
  return circuitBreaker(handleAll, {
    halfOpenAfter: halfOpenAfterMs,
    breaker: new ConsecutiveBreaker(5),
  });
}
