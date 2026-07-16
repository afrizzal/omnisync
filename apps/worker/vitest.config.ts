import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/**/*.test.ts"],
    passWithNoTests: true,
    // BullMQ force-closes its internally-duplicated blocking Redis client on
    // worker.close(); the aborted blocking command rejects AFTER test teardown with
    // "Connection is closed." — an ioredis/BullMQ teardown artifact outside test
    // control (github.com/taskforcesh/bullmq teardown race). Every other unhandled
    // error still fails the run.
    onUnhandledError(error) {
      if (error.message === "Connection is closed.") return false;
    },
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/index.ts"],
      thresholds: { lines: 80 },
    },
  },
});
