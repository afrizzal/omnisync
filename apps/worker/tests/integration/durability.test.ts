import { describe, it } from "vitest";

// TST-02 (RES-07): in-flight events survive a Postgres outage with zero drops.
// Implemented in Plan 06-02 (Wave 1) using @testcontainers/postgresql + dockerode pause/unpause.
describe("TST-02 kill-Postgres durability", () => {
	it.todo("pauses Postgres mid-flight; queue survives; events drain on unpause");
});
