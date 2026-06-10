import type { InboundEvent } from "@omnisync/types";

// InboundEvent imported to prove cross-package type resolution at build time.
// Real dashboard UI lands in Phase 5.
type _Proof = InboundEvent;

export default function HomePage() {
  return (
    <main>
      <h1>OmniSync</h1>
      <p>Coming soon — dashboard UI in Phase 5.</p>
    </main>
  );
}
