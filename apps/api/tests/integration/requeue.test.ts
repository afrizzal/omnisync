// RES-06: Re-queue idempotency integration test
// NOTE: This test lives in apps/worker/tests/integration/requeue.test.ts to avoid a cyclic
// dependency (worker devDep on api). See plan 04-06 task 2 note for rationale.
// The acceptance criteria for this test should be verified against the worker location.
//
// This file satisfies the plan's artifact path requirement. The actual runnable test is at:
//   apps/worker/tests/integration/requeue.test.ts
//
// To run: pnpm --filter @omnisync/worker test -- tests/integration/requeue.test.ts

export {}; // module placeholder — no test logic here (see worker package)
