# Brainstorming — Fitur "Out of the Box" Berorientasi Industri untuk OmniSync

> **Tanggal:** 2026-07-03
> **Metode:** ultracode workflow 12-agent — 6 ideator (lensa industri berbeda, 2 ide per lensa = 12 kandidat) → panel 3 juri (persona: *senior hiring manager SEA e-commerce*, *staff engineer feasibility/free-tier*, *VP Operations retailer omnichannel Indonesia*; 4 sumbu skor: technical depth, business value, feasibility, differentiation, maks 120 poin) → deep design untuk 3 pemenang.
> **Status:** artefak riset / brainstorming — **belum ada keputusan implementasi**. Rekomendasi urutan build di bagian akhir.
> **Konstrain yang dipegang semua desain:** stack eksisting saja (Fastify → BullMQ → Worker → Prisma/Postgres + Redis), free-tier only (Upstash 500k commands/bulan, Neon 0.5GB, Render free), demoable lewat halaman `/demo` yang sudah ada, dan setiap fitur wajib punya cerita data-integrity yang **lebih keras dari dedup**.

---

## TL;DR

| # | Fitur | Industri | Teknik inti | Skor |
|---|-------|----------|-------------|------|
| 1 | **FlashGuard** — Escrow Bounded-Counter Stock Reservations | E-commerce/Retail | Bounded Counter CRDT (escrow rights per channel) + Lua atomik + hash-chained ledger | 96/120 |
| 2 | **GoldenGraph** — Reversible Streaming Identity Resolution | Retail (CDP-native) | Union-find sebagai proyeksi atas evidence journal append-only; LWW register per-field | 96/120 |
| 3 | **Downtime Time-Machine** — watermarked, hash-chained OEE ledger | Manufaktur | Low watermark ala Flink (min-of-inputs + idle-source exclusion); dua urutan terpisah (arrival vs event-time) | 85/120 |

Benang merah ketiganya: masing-masing menjaga **invariant yang lebih kuat dari dedup** (jumlah numerik global, forest bebas siklus, rantai hash tak terputus) di bawah at-least-once delivery, dengan matematika budget Upstash eksplisit dan momen demo yang memvisualisasikan race condition-nya live.

**Urutan build yang direkomendasikan:** FlashGuard → Downtime Time-Machine → GoldenGraph.

---

## Leaderboard (top 6 dari 12 kandidat)

| Rank | Kandidat | Industri | Skor |
|------|----------|----------|------|
| 1 | FlashGuard — Escrow Bounded-Counter Stock Reservations | ecommerce | 96 |
| 1 | SLA Sentinel — Event-Time SLA Breach Detection (watermarks, retractable breaches, stuck-order recovery) | ecommerce | 96 |
| 1 | GoldenGraph — Reversible Streaming Identity Resolution | retail | 96 |
| 4 | RefundRadar — Out-of-Order Refund-Fraud Saga (OCC + temporal watermarks) | ecommerce | 95 |
| 5 | FlashGuard (varian saga) — Oversell-Proof Order Saga Orchestrator + hash-chained compensation ledger | ecommerce | 88 |
| 5 | RTO Sentinel — Cross-Marketplace COD Fraud Ledger (merge-proof counters) | ecommerce | 88 |

SLA Sentinel skornya setara pemenang tapi kalah slot karena aturan diversitas industri (slot e-commerce sudah diambil FlashGuard). Downtime Time-Machine (85) masuk sebagai wakil manufaktur. Catatan juri per kandidat ada di bagian *Runners-up* di bawah.

---

# Pemenang 1 — FlashGuard: Escrow Bounded-Counter Stock Reservations (E-commerce/Retail)

> **Tagline:** Flash-sale stock that can never oversell: per-channel escrow rights (Bounded Counter CRDT) spent via atomic Lua, audited by a hash-chained Postgres ledger that can rebuild Redis from zero.

## Problem Statement

Saat flash sale Indonesia (Shopee 9.9, Harbolnas 12.12), satu SKU dijual serentak di Shopee, Tokopedia, webstore seller, dan POS offline — semuanya mendekremen satu angka stok bersama via *read-modify-write*, sehingga burst menyebabkan oversell. Setiap pembatalan paksa di Shopee/Tokopedia = poin penalti seller, demosi pencarian, dan akhirnya risiko suspend toko. Seller menengah 15k order/bulan dengan oversell rate flash-sale 2% menelan ~300 pembatalan/bulan; pada AOV Rp150k dan margin 30% itu **~Rp13,5jt (~$850)/bulan margin hancur** sebelum menghitung pajak trafik akibat penalti. Workaround standar — safety-stock buffer 10–20% per channel — hanya mengubah oversell menjadi inventori yang sengaja tidak terjual.

Presisi soal letak masalahnya: untuk webstore/POS kegagalannya adalah race yang bisa ditolak real-time; untuk marketplace (yang mendekremen stok di checkout mereka sendiri) kegagalannya adalah me-listing stok lebih besar dari jatah wajar platform itu — **masalah alokasi, bukan masalah lock**.

## Konsep "Out of the Box"

CDP generik men-dedup dan me-routing event; FlashGuard menjaga **invariant numerik global** (`stock >= 0`, `Sum(rights) + Sum(spent) == initialQty`) di bawah beban multi-writer konkuren — jaminan yang secara kategoris berbeda, diimplementasikan sebagai **Bounded Counter CRDT / escrow transactions dari Balegas et al. (proyek SyncFree)** — riset yang bisa disitasi di interview.

Pertahanan untuk keberatan staff-interview yang paling jelas — *"di satu Redis yang linearizable, satu Lua conditional-decrement sudah memberi stock >= 0; kenapa escrow?"* — jawaban jujurnya: escrow bukan untuk atomisitas Redis, melainkan karena **dua dari empat writer bukan milik kita**. Shopee dan Tokopedia mendekremen stok di checkout mereka sendiri, di infrastruktur yang tidak bisa kita lewati Redis kita. Satu-satunya kontrol atas marketplace adalah angka stok yang kita listing — jadi *"listed stock" ADALAH alokasi escrow channel itu*, secara fisik hidup di replica remote. Bounded Counter adalah model akuntansi yang menjaga spender eksternal tak-terkoordinasi tetap sum-safe: marketplace dibatasi alokasinya, webstore/POS dibatasi hot-path rejection di `reserve.lua`, dan rebalancer async memindahkan rights dari channel dingin ke channel panas (dengan protokol **two-phase shrink-then-confirm** saat reclaim dari marketplace, karena kita hanya boleh mengambil kembali rights yang sudah dikonfirmasi ter-unlisting oleh platform).

Ini juga membunuh baris rupiah kedua: tidak ada dead buffer per channel, karena rights bermigrasi mengikuti demand alih-alih dibekukan di awal kampanye. Postgres menyimpan **hash-chained append-only ledger** untuk setiap pergerakan rights; hash Redis hanyalah proyeksi sekali-pakai yang dibangun ulang dengan mem-fold ledger — *kill Redis live, replay ledger, invariant utuh*.

## Arsitektur High-Level

1. **Seeding:** `POST /admin/stock` (apps/api) membuat `StockItem`, menulis satu baris `SEED` per channel di `StockLedger` (pembagian awal), fold ke Redis hash `fg:rights:{sku}` (field `SHOPEE`, `TOKOPEDIA`, `WEBSTORE`, `POS`, `pool`), dan push `listedStock = allocation` ke tiap marketplace via `apps/mock-crm` (dapat endpoint mock listing Shopee/Tokopedia, reuse simulator flakiness yang sudah ada).
2. **Ingestion (pipeline tidak berubah):** webhook reservasi webstore/POS dan webhook `order.created` marketplace masuk `POST /ingest` yang sama. Identitas channel berasal dari **HMAC key per-channel mana yang memverifikasi raw body** (map key-id → channel di env), tidak pernah dari payload. Fingerprint SHA-256 eksisting menjadi jobId BullMQ di queue `events` yang sudah ada; HTTP 202 seperti sekarang.
3. **Hot path worker:** `event.processor` di apps/worker mendapat cabang `stock.*` (`stock.processor.ts` di samping `event.processor.ts`). Ia memanggil `reserveRights()` — satu `EVALSHA reserve.lua` terhadap `fg:rights:{sku}` + replay cache `fg:res:{sku}` — untuk reserve webstore/POS, atau `settle.lua` untuk webhook order marketplace (mendebit rights marketplace tsb; penjualan sudah terjadi, jadi selalu tercatat). Lalu append baris `StockLedger` hash-chained via `appendLedger()` (head-row per-SKU `FOR UPDATE`; `reservationId UNIQUE` menyerap replay — kontrak D-05 "conflict is success" yang sama dengan `persistEvent`). `INSUFFICIENT` adalah **verdict bisnis yang dipersist di row Event, bukan exception** — tidak ada retry storm saat sold-out.
4. **Rebalancer:** saat `reserve.lua` mengembalikan `OK_LOW` (sisa <= watermark), worker meng-enqueue job ke queue BullMQ baru `stock-rebalance` dengan `jobId = rebalance:{sku}` — dedup jobId BullMQ menjamin **maksimal satu rebalance pending per SKU, nol polling**. Processor rebalance menghitung target berbobot-demand dari window query Postgres atas `StockLedger` (kecepatan reservasi per channel, N menit terakhir), lalu mengeksekusi `transfer.lua` per perpindahan (compare-and-transfer dengan floor per channel) dan me-ledger tiap `TRANSFER`. Reclaim dari marketplace two-phase: (a) shrink listing via API marketplace dan baca balik level terkonfirmasi, (b) baru `transfer.lua` kuantitas terkonfirmasi ke `pool`. Job rebalance repeatable safety-net **hanya ada selama `StockItem.campaign = true`** (didaftar/dicabut oleh route admin) — biaya idle Upstash tetap nol.
5. **Read path:** `GET /stock/:sku` (apps/api) = satu `HGETALL` `fg:rights:{sku}` + head ledger (seq, hash) dari Postgres; panel rights-bar per-channel baru di dashboard mem-poll-nya dan merender bar yang terkuras + counter oversold.
6. **Recovery:** `POST /admin/stock/:sku/rebuild` memverifikasi rantai hash link-per-link (409 di link putus pertama), fold ledger ke `fg:rights:{sku}` segar, dan re-register script. Ini endpoint demo kill-Redis; job ber-202 yang belum ter-ledger di-drive ulang oleh replay BullMQ dan mendarat idempoten.
7. Semuanya mendarat di observabilitas dashboard/Postgres eksisting: verdict = Events, transfer = baris ledger, jalur DLQ tak tersentuh.

## Model Prisma

```prisma
enum LedgerKind {
  SEED     // initial per-channel allocation at seeding
  RESERVE  // webstore/POS rights spent on the hot path
  SETTLE   // marketplace order webhook debited that channel's allocation
  TRANSFER // rebalancer moved rights channel -> counterparty (incl. pool)
  ADJUST   // manual admin correction — still chained, still auditable
}

model StockItem {
  sku        String   @id      // natural key; all Redis keys derive from it
  name       String
  initialQty Int
  floorQty   Int      @default(0) // per-channel floor enforced by transfer.lua
  campaign   Boolean  @default(false) // true => safety-net rebalance job registered
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@map("stock_items")
}

model StockLedger {
  id            String     @id @default(uuid())
  sku           String
  seq           Int        // per-SKU monotonic, issued under the head-row lock
  channel       String     // EventSource value, "WEBSTORE" | "POS", or "pool"
  counterparty  String?    // TRANSFER only: who received what `channel` gave up
  kind          LedgerKind
  delta         Int        // negative = rights spent/donated; positive = granted
  reservationId String     @unique // idempotency: replayed job -> P2002 -> absorbed
                            // (mirrors events_fingerprint_unique / D-05 pattern);
                            // TRANSFER rows store their deterministic transferId here
  prevHash      String
  hash          String     // sha256(prevHash | sku | seq | channel | kind | delta | reservationId)
  createdAt     DateTime   @default(now())

  @@map("stock_ledger")
  @@unique([sku, seq])          // exactly one successor per chain link — a fork or gap is detectable
  @@index([sku, createdAt])     // rebuild fold + dashboard time-range reads
  @@index([channel, createdAt]) // per-channel reservation velocity for demand-weighted rebalancing
}

model StockLedgerHead {
  sku  String @id // SELECT ... FOR UPDATE target: serializes appends PER SKU only —
                  // hot SKUs pay ~1ms; distinct SKUs never contend
  seq  Int
  hash String

  @@map("stock_ledger_heads")
}
```

## Kode Inti

```typescript
// packages/queue/src/flashguard/reserve.ts
import { createHash } from "node:crypto";
import type { Redis } from "ioredis";
import type { PrismaClient } from "@omnisync/db";

// ── reserve.lua ─────────────────────────────────────────────────────────────
// KEYS[1] fg:rights:{sku}  hash: rights per channel + "pool" (unallocated)
// KEYS[2] fg:res:{sku}     hash: opId -> first verdict (at-least-once replay cache)
// ARGV[1] channel  ARGV[2] qty  ARGV[3] reservationId  ARGV[4] lowWatermark
// Redis runs the whole script single-threaded: the read-check-write window that
// causes oversell in naive SQL cannot exist inside it. Braces in the key make
// both keys hash to one slot if we ever move to Redis Cluster.
const RESERVE_LUA = `
local cached = redis.call('HGET', KEYS[2], ARGV[3])
if cached then return cached end            -- replayed job: same verdict, no double-spend
local rights = tonumber(redis.call('HGET', KEYS[1], ARGV[1]) or '-1')
if rights < 0 then return 'NO_CHANNEL' end  -- authz backstop: channel must be provisioned
local qty = tonumber(ARGV[2])
local verdict
if rights >= qty then
  local left = redis.call('HINCRBY', KEYS[1], ARGV[1], -qty)
  if left <= tonumber(ARGV[4]) then verdict = 'OK_LOW:' .. left  -- worker enqueues rebalance
  else verdict = 'OK:' .. left end
else
  verdict = 'INSUFFICIENT:' .. rights       -- fail safe: reject; never overdraft the channel
end
redis.call('HSET', KEYS[2], ARGV[3], verdict)
redis.call('EXPIRE', KEYS[2], 172800)       -- replay window (48h) >> max BullMQ retry horizon
return verdict`;

// ── transfer.lua ────────────────────────────────────────────────────────────
// Compare-and-transfer: move qty donor -> receiver ONLY if donor keeps >= floor.
// ARGV[1] donor  ARGV[2] receiver  ARGV[3] qty  ARGV[4] floor  ARGV[5] transferId
// Atomicity means a concurrent reserve.lua on the donor can never interleave
// between the check and the two HINCRBYs; a replayed rebalance job is absorbed
// by the same fg:res cache, so rights are moved exactly once per transferId.
const TRANSFER_LUA = `
local cached = redis.call('HGET', KEYS[2], ARGV[5])
if cached then return cached end
local donor = tonumber(redis.call('HGET', KEYS[1], ARGV[1]) or '0')
local qty, floor = tonumber(ARGV[3]), tonumber(ARGV[4])
local verdict
if donor < qty + floor then verdict = 'DENIED:' .. donor
else
  redis.call('HINCRBY', KEYS[1], ARGV[1], -qty)
  redis.call('HINCRBY', KEYS[1], ARGV[2], qty)
  verdict = 'OK'
end
redis.call('HSET', KEYS[2], ARGV[5], verdict)
return verdict`;

export type Verdict =
  | { kind: "reserved"; remaining: number; low: boolean }
  | { kind: "rejected"; channelRights: number }
  | { kind: "no_channel" };

export async function reserveRights(
  redis: Redis, sku: string, channel: string, qty: number,
  reservationId: string, lowWatermark: number,
): Promise<Verdict> {
  const raw = (await redis.eval(RESERVE_LUA, 2, // prod path uses EVALSHA + NOSCRIPT fallback
    `fg:rights:{${sku}}`, `fg:res:{${sku}}`,
    channel, String(qty), reservationId, String(lowWatermark))) as string;
  const [tag, n] = raw.split(":");
  if (tag === "OK" || tag === "OK_LOW")
    return { kind: "reserved", remaining: Number(n), low: tag === "OK_LOW" };
  if (tag === "INSUFFICIENT") return { kind: "rejected", channelRights: Number(n) };
  return { kind: "no_channel" };
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Hash-chained append. FOR UPDATE on the per-SKU head row serializes appends
 *  per SKU so every chain link has exactly one successor; distinct SKUs run in
 *  parallel. The reservationId lookup inside the same lock absorbs BullMQ
 *  replays that already committed (D-05: conflict is success, no throw). */
export async function appendLedger(
  prisma: PrismaClient,
  row: { sku: string; channel: string; counterparty?: string;
         kind: string; delta: number; reservationId: string },
): Promise<"appended" | "duplicate"> {
  return prisma.$transaction(async (tx) => {
    const heads = await tx.$queryRaw<{ seq: number; hash: string }[]>`
      SELECT seq, hash FROM stock_ledger_heads WHERE sku = ${row.sku} FOR UPDATE`;
    const head = heads[0];
    if (!head) throw new Error(`no ledger head for ${row.sku} — SKU not seeded`);
    const dup = await tx.stockLedger.findUnique({
      where: { reservationId: row.reservationId }, select: { id: true } });
    if (dup) return "duplicate";           // replay already chained — absorb, don't re-link
    const seq = head.seq + 1;
    const hash = sha256(
      `${head.hash}|${row.sku}|${seq}|${row.channel}|${row.kind}|${row.delta}|${row.reservationId}`);
    await tx.stockLedger.create({ data: { ...row, seq, prevHash: head.hash, hash } });
    await tx.stockLedgerHead.update({ where: { sku: row.sku }, data: { seq, hash } });
    return "appended";
  });
}
```

**Penjelasan:** kode ini melindungi satu invariant: `Sum(rights per channel) + Sum(spent) == initialQty` dengan setiap rights channel >= 0 — yang mengimplikasikan stok tak pernah negatif. Subtilitasnya: atomisitas saja tidak cukup di bawah at-least-once delivery — worker bisa crash setelah `reserve.lua` mendekremen tapi sebelum Postgres commit, maka kedua script Lua mengonsultasi replay cache (`fg:res`, keyed reservationId/transferId) dan mengembalikan verdict PERTAMA saat redelivery alih-alih mendekremen dua kali — idempotensi ditegakkan di Redis, lalu ditegakkan lagi di Postgres oleh constraint UNIQUE `reservationId`. Append ledger mengambil lock `FOR UPDATE` di tabel head satu-baris-per-SKU: append untuk SKU yang sama ter-serialisasi (~1ms), SKU berbeda tak pernah saling sentuh. `INSUFFICIENT` dan `DENIED` adalah nilai kembali, bukan exception — sold-out adalah hasil bisnis, bukan fault untuk di-retry.

## Race Conditions (integritas data lebih keras dari dedup)

- **R1 — unit terakhir, dua channel, dua worker (race utama):** worker A memproses reserve webstore, worker B reserve POS, keduanya untuk unit terakhir SKU-X. Event berbeda → fingerprint dedup tak berguna; `SELECT qty; UPDATE qty-1` naif membuat keduanya membaca qty=1 dan commit qty=-1. Di bawah escrow kedua worker mendekremen **field hash BERBEDA** (WEBSTORE vs POS) — channel yang masih pegang right menang, yang lain dapat `INSUFFICIENT` dan mungkin terlayani setelah rebalancer memindahkan sisa pool. Tidak ada interleaving yang bisa menciptakan −1 karena tiap field hanya didekremen setelah cek in-script.
- **R2 — channel sama, dua worker:** keduanya EVALSHA `reserve.lua` untuk WEBSTORE dengan rights=1. Redis mengeksekusi script satu per satu per node: HGET+HINCRBY script pertama selesai sebelum script kedua mulai, jadi yang kedua membaca rights=0 dan `INSUFFICIENT`. Tidak ada window — bukan window kecil, melainkan **tidak ada**.
- **R3 — crash antara dekremen Redis dan commit Postgres (replay at-least-once):** worker mati setelah `reserve.lua` sukses tapi sebelum `appendLedger` commit. BullMQ redeliver; `reserve.lua` menemukan reservationId di `fg:res:{sku}` dan mengembalikan verdict ter-cache TANPA dekremen ulang; `appendLedger` lalu tidak menemukan row dan men-chain-nya. Urutan sebaliknya (ledger committed, ack hilang): replay kena cache `fg:res` di Redis DAN lookup UNIQUE reservationId di Postgres — terserap sebagai "duplicate", persis kontrak `persistEvent` D-05. TTL 48h `fg:res` melebihi horizon retry maksimum BullMQ; UNIQUE Postgres adalah backstop permanen.
- **R4 — rebalancer vs spend konkuren pada donor:** rebalancer menghitung "pindahkan 40 dari POS" dari snapshot, tapi POS menjual 15 lagi sebelum transfer dieksekusi. `transfer.lua` re-check `donor >= qty + floor` **atomik pada saat eksekusi** dan mengembalikan `DENIED` (atau job retry dengan qty lebih kecil) — keputusan boleh dari read basi, tapi ENFORCEMENT selalu atas state terkini di dalam satu script atomik. Job rebalance yang di-replay tak bisa double-move: transferId deterministik (hash sku + donor + receiver + decision-window) dan kena replay cache + UNIQUE ledger.
- **R5 — reclaim marketplace vs penjualan marketplace in-flight (yang jujur):** Tokopedia mendekremen di checkout-nya sendiri, jadi me-reclaim rights-nya saat ia sedang menjual bisa double-count. Karena itu reclaim two-phase: (a) shrink listing Tokopedia via API marketplace dan baca balik level TERKONFIRMASI (platform menolak turun di bawah yang sudah terjual), (b) baru `transfer.lua` delta terkonfirmasi ke pool. Webhook order yang telat (terjual sebelum shrink dikonfirmasi, delivered setelahnya) men-settle terhadap rights Tokopedia dan bisa mendorong satu field itu negatif transien — tercatat sebagai **bounded drift** (ter-bound latensi webhook), dibayar dari pool oleh rebalance berikutnya, dan krusialnya tak pernah merusak non-negativitas ketat webstore/POS — channel yang benar-benar kita gate real-time. Kita nyatakan jujur: untuk marketplace jaminannya "allocation == listed stock, reconciled", bukan hot-path rejection — hot-path rejection mustahil secara fisik saat checkout-nya di server orang lain, dan justru itulah kenapa model escrow (batasi spender eksternal lewat alokasi) adalah teknik yang tepat, bukan satu conditional decrement global.

## Cost Efficiency

Dua baris rupiah sekaligus. (1) **Eliminasi oversell:** seller skenario kehilangan ~300 pembatalan flash-sale/bulan pada AOV Rp150k margin 30% = ~Rp13,5jt (~$850)/bulan margin hancur, plus poin penalti Shopee/Tokopedia yang menekan ranking organik — pajak trafik compounding yang FlashGuard hapus dengan tak pernah me-listing lebih dari alokasi. (2) **Pemulihan dead buffer:** pertahanan standar adalah buffer 10–20% per channel; pada alokasi flash 500 unit itu 50–100 unit yang sengaja tak ditawarkan di mana pun. Karena rights bermigrasi ke demand saat runtime, buffer menyusut ke floor per channel (~2%), mengonversi 8–18% inventori kampanye kembali jadi stok terjual — pada AOV sama itu Rp1,1–2,7jt revenue ekstra per kampanye 500 unit. Delta infra: **$0** — satu EVALSHA per reservasi di Upstash eksisting, baris ledger di Neon eksisting, rebalancer sebagai job BullMQ di worker Render eksisting; tanpa service baru, tanpa polling.

## Scalability

State terpartisi per SKU: `fg:rights:{sku}` satu hash kecil, tiap reservasi satu EVALSHA O(1), SKU panas tak pernah kontensi satu sama lain di Redis maupun Postgres (satu-satunya lock adalah head row ledger per-SKU, ~1ms per append). Budget command Redis di Upstash free (500k/bulan), dihitung **pesimis** seolah tiap command di dalam Lua ditagih individual: `reserve.lua` ≈ 6 command, lifecycle job BullMQ ≈ 12 dengan `stalledInterval`/`drainDelay` yang sudah kita tune, jadi ~18–20 command per reservasi end-to-end. Menyisihkan 100k/bulan untuk heartbeat idle BullMQ + read dashboard menyisakan 400k / 20 ≈ **20.000 reservasi/bulan di free tier ter-deploy** (~650/hari) — lega untuk demo recruiter; demo lokal docker-compose (Redis terkontainer, tanpa metering) menahan blaster 4 channel di ribuan reservasi/menit. Rebalancer nyaris nol biaya idle by design: event-driven (verdict `OK_LOW` → enqueue dengan `jobId=rebalance:{sku}`, dedup BullMQ meng-cap satu job pending per SKU) plus job repeatable safety-net yang hanya ada selama `campaign=true` — **tidak pernah busy-polling**. Postgres: insert append-only dengan tiga index tertarget; penyerap burst diwarisi arsitektur eksisting (ingestion 202 <5ms, BullMQ concurrency 5 per worker, scalable horizontal).

## Security

Otorisasi **kriptografis, bukan deklaratif**: tiap channel punya HMAC-SHA256 key sendiri; key-id yang memverifikasi raw body menentukan channel (field channel di payload diabaikan), jadi webhook Shopee tak akan pernah bisa membelanjakan rights POS — dan backstop `NO_CHANNEL` di `reserve.lua` menolak channel yang tak diprovisikan bahkan jika bug routing lolos. **Tamper-evidence:** tiap pergerakan rights adalah baris `StockLedger` yang menyimpan `prevHash` dan `hash = SHA-256(prevHash | canonical row)`; `@@unique([sku, seq])` membuat fork dan gap mustahil secara struktural, dan endpoint rebuild memverifikasi ulang seluruh rantai link-per-link (409 dengan seq putus pertama) sebelum fold — baris yang dihapus/diedit/dipalsukan terdeteksi, menjadikan ledger stok artefak audit yang bisa dipercaya tim finance. **Rate limiting:** route stok mendapat fixed-window counter per channel (INCR + EXPIRE di `fg:rl:{channel}:{epochMinute}`, 2 Redis command) dengan 429. Permukaan admin (`/admin/stock/*`, rebuild, seed) di belakang auth admin eksisting; rebuild idempoten dan read-only atas ledger. **PII:** event stok hanya membawa sku/qty/channel — tidak menyentuh jalur PII normalizer.

## Demo Story (60–90 detik, ekstensi halaman /demo)

1. Klik **"Seed 500 units"** — SKU FLASH-001 muncul dengan empat bar rights channel (Shopee 200 / Tokopedia 150 / Webstore 100 / POS 50) dan counter "Oversold: 0"; seed terlihat sebagai baris ledger hash-chained pertama.
2. Tekan Start mode **"Naive read-modify-write"**: empat blaster channel menembakkan reservasi konkuren lewat jalur `/ingest` → BullMQ → worker asli ke waveform live, dan counter terjual menembus cap — **517/500, oversold merah menanjak**. ITULAH race-nya, direproduksi live di pipeline yang sama.
3. Flip toggle **"Escrow CRDT"** dan reseed: blaster sama, throughput sama, tapi terjual terkunci **tepat 500/500** dan oversold tetap 0 — sementara penonton melihat bar rights Shopee terkuras cepat, menyentuh low-watermark, dan rebalancer terlihat menyedot rights dari bar POS yang sepi ke Shopee (tiap transfer berkedip sebagai baris ledger di feed).
4. Finale: **"Kill Redis"** (stop container di docker-compose) — bar jadi abu-abu — lalu **"Rebuild from ledger"**: API memverifikasi rantai hash dan mem-fold ~500 baris ledger Postgres kembali ke Redis dalam <1 detik; bar tergambar ulang persis di nilai pra-crash dan banner hijau "chain verified, invariant intact: 500 = rights + reserved" mendaratkan janji inti: state counter itu disposable, ledger-lah kebenarannya, dan tak satu pun reservasi terkonfirmasi hilang.

## Interview Talking Points

- *"I implemented the Bounded Counter CRDT (escrow transactions, Balegas et al., SyncFree) on Redis+Postgres — and I can tell you exactly when it's over-engineering: on a single linearizable Redis, one conditional-decrement Lua script already gives you stock >= 0. Escrow earns its keep because two of my writers are Shopee and Tokopedia, whose checkouts I cannot route through my Redis — their 'listed stock' is escrow physically living on a replica I don't control."*
- *"Atomicity is table stakes; the real problem is atomicity UNDER at-least-once delivery. My idempotency is two-layer: a replay cache inside the Lua script and a reservationId UNIQUE in the ledger. I can walk through both crash orderings on a whiteboard."*
- *"Redis is a disposable projection: the source of truth is an append-only, hash-chained Postgres ledger serialized per SKU by a head-row lock — so I can kill Redis live in the demo, verify the chain, fold it back, and prove the invariant held across the crash."*
- *"Every decision is free-tier-costed: ~20 Redis commands per reservation counted pessimistically, an event-driven rebalancer with BullMQ jobId dedup instead of polling, and the whole feature adds two tables, two Lua scripts, and one queue — small surface, sharp guarantee."*

---

# Pemenang 2 — GoldenGraph: Reversible Streaming Identity Resolution (Retail / CDP-native)

> **Tagline:** A streaming identity graph where union-find is a rebuildable projection over an append-only evidence journal — so merges are concurrent-safe, replays converge, and wrong merges can be surgically undone.

## Problem Statement

Retailer omnichannel Indonesia melihat satu manusia sebagai empat orang asing: buyer ID Shopee, buyer ID Tokopedia, lead Meta Ads dengan telepon "0812-3456-7890", dan kontak loyalty CRM dengan telepon yang sama sebagai "+62 812 3456 7890". Duplicate-contact rate CDP tipikal 20–30%; untuk seller berbudget retargeting Meta Rp100jt/bulan, 15–25% audiensnya adalah pelanggan yang sudah konversi — **Rp15–25jt/bulan ad waste murni**, plus segmen LTV/RFM salah dan agen CS buta riwayat lintas channel. Perbaikan naif (batch malam "match phone lalu merge rows") gagal dua kali: basi berjam-jam untuk retargeting, dan **merge yang salah — telepon kantor bersama, akun keluarga — irreversible** begitu row digabung fisik. Bagian yang sulit di industri bukan matching; melainkan **un-matching di bawah konkurensi tanpa kehilangan siapa pun**.

## Konsep "Out of the Box"

CDP generik melakukan batch entity resolution: match key, merge row, selesai — dan saat merge-nya salah, data hancur. GoldenGraph **membalik struktur datanya**: sumber kebenaran adalah journal evidence-edge append-only ("node A dan node B berbagi peppered-hash key H karena event E"), dan forest union-find adalah **proyeksi turunan** atas edge ACTIVE. Inversi itu seluruh triknya — union-find terkenal tak bisa delete, tapi proyeksi bisa dibangun ulang, jadi unmerge menjadi "tombstone satu evidence edge, rebuild hanya komponen terdampak" alih-alih operasi mustahil.

Teknik ini tepat karena berkomposisi dengan semua jaminan OmniSync yang sudah ada: append journal adalah upsert idempoten (replay at-least-once BullMQ dan requeue DLQ konvergen), golden record adalah **LWW register per-field dengan urutan total `(sourcePriority, occurredAt, eventId)`** (nama asli CRM mengalahkan username Shopee, tapi event Tokopedia yang di-replay telat tak pernah bisa menimpa nilai CRM yang lebih baru), dan **tombstone operator mengalahkan evidence yang di-replay** (keputusan unmerge manusia bertahan terhadap event replay). Streaming, reversible, konvergen — properti yang batch merge job secara struktural tak bisa tawarkan.

## Arsitektur High-Level

1. **Ingestion (tak berubah):** `/ingest` verifikasi HMAC atas raw body, bangun fingerprint SHA-256, enqueue ke queue `events` dengan jobId=fingerprint, 202.
2. **Fan-out:** `event.processor.ts` mendapat satu langkah setelah `persistEvent()` sukses dan sebelum sync CRM — enqueue ke **queue BullMQ BARU `identity`** (packages/queue mengekspor `QUEUE_IDENTITY` + `createIdentityQueue()`, custom backoff full-jitter yang sama) dengan `jobId = ${fingerprint}:id`, reuse dedup jobId eksisting. Enqueue-setelah-persist berarti identity hanya melihat event durable; enqueue idempoten sehingga replay events-job tidak berbahaya.
3. **Resolver:** Worker kedua di proses apps/worker yang sama (`apps/worker/src/identity/resolver.ts`, concurrency 5), per job: (a) ekstrak match key dari payload yang SUDAH dinormalisasi — reuse output RoutingRule `phone_normalize_e164` sehingga "0812…" dan "+62 812…" menghasilkan hash identik; (b) hitung `HMAC-SHA256(IDENTITY_PEPPER, type\0value)` per key (pemisah null-byte, meniru idiom fingerprint.ts); (c) **Bloom check: SATU command Redis `BITFIELD`** dengan k=7 probe GET u1 terhadap bitmap `bloom:matchkeys` — miss pasti = skip lookup DB seluruhnya; (d) jika mungkin hit, lookup unique-index `match_keys.hash`; (e) upsert `IdentityNode` pada UNIQUE(source, externalId); (f) untuk tiap node asing yang match, `unionWithEvidence()` (kode di bawah): journal-first edge upsert, ordered advisory locks, double-checked find, CAS parent attach, fold LWW field pihak kalah ke root pemenang dalam transaksi yang sama; (g) LWW-upsert field profil event ini ke root yang bertahan; (h) set bit Bloom untuk key baru (BITFIELD kedua).
4. **Unmerge:** `POST /admin/unmerge/:edgeId` (auth token /admin eksisting) menandai edge TOMBSTONED, append baris `MergeAudit` hash-chained, enqueue job `identity-rebuild`. Rebuild men-snapshot `clusterVersion` v milik root, BFS edge ACTIVE komponen, hitung forest baru di memori, lalu swap atomik dalam satu transaksi ber-guard `WHERE id = root AND clusterVersion = v` — merge konkuren mem-bump v dan memaksa rebuild retry; reader melihat proyeksi lama yang konsisten sampai swap commit.
5. **Read path:** `GET /identity/:key` (rate-limited) → pepper-HMAC → MatchKey → find() root → baris profile_fields → golden record JSON dengan badge sumber per field. `GET /identity/graph` memberi makan viz force-directed di /demo (poll hanya saat demo aktif — nol chatter idle). `GET /admin/suppression.csv` mengekspor telepon cluster yang sudah konversi sebagai SHA-256(E.164) — **format upload native Meta Custom Audiences**, jadi artefak ekspornya production-real walau berhenti sebelum memanggil Ads API.
6. **Dashboard:** panel graph, kartu golden-record, viewer audit-chain, tombol unmerge/replay. Postgres tetap satu-satunya store (identity_nodes, identity_edges, match_keys, profile_fields, merge_audits); Redis hanya membawa dua queue BullMQ + bitmap Bloom 1,2MB.

## Model Prisma

```prisma
enum EdgeStatus {
  ACTIVE
  TOMBSTONED
}

enum AuditType {
  MERGE
  UNMERGE
}

model IdentityNode {
  id             String   @id @default(uuid())
  source         String   // EventSource: SHOPEE | TOKOPEDIA | META_ADS | CRM
  externalId     String
  parentId       String?  // null = component root. DSU projection — rebuildable from edges.
  rank           Int      @default(0) // union-by-rank keeps depth O(log n) pre-compression
  clusterVersion Int      @default(0) // OCC token on roots: every union bumps it; rebuild swap requires it unchanged
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@map("identity_nodes")
  // One node per channel identity — resolver upserts on this, so replays can't duplicate nodes.
  @@unique([source, externalId], map: "identity_nodes_source_external_unique")
  // find() walks parentId; rebuild BFS and compaction scan children by parent.
  @@index([parentId])
}

model IdentityEdge {
  id              String     @id @default(uuid())
  nodeAId         String     // canonical order enforced in code: nodeAId < nodeBId,
  nodeBId         String     // so (A,B) and (B,A) hit the same unique row.
  matchKeyHash    String     // HMAC-SHA256(pepper, type\0value) — zero raw PII in the journal
  evidenceEventId String     // events.id — WHY these two are the same human (auditable provenance)
  status          EdgeStatus @default(ACTIVE)
  createdAt       DateTime   @default(now())
  tombstonedAt    DateTime?

  @@map("identity_edges")
  // The journal's idempotency key: replaying the same evidence upserts a no-op.
  // Also why tombstones stick — upsert update:{} never resurrects a TOMBSTONED edge.
  @@unique([nodeAId, nodeBId, matchKeyHash], map: "identity_edges_evidence_unique")
  @@index([nodeAId, status]) // component BFS over ACTIVE edges, both directions
  @@index([nodeBId, status])
}

model MatchKey {
  id     String @id @default(uuid())
  type   String // "phone_e164" | "email"
  hash   String @unique // peppered HMAC — the ONLY stored form; Bloom filter fronts this index
  nodeId String

  @@map("match_keys")
  @@index([nodeId]) // reverse lookup when folding/rebuilding a component
}

model ProfileField {
  clusterId      String   // current root node id (folded to the winner inside the union txn)
  field          String
  value          String   // raw value lives ONLY here, behind the authed API
  sourcePriority Int      // CRM=4 > TOKOPEDIA=3 > SHOPEE=2 > META_ADS=1
  occurredAt     DateTime // event time, not arrival time — late replays lose deterministically
  eventId        String   // total-order tiebreaker: (priority, occurredAt, eventId) is a strict total order
  updatedAt      DateTime @updatedAt

  @@map("profile_fields")
  @@id([clusterId, field]) // one LWW register per (cluster, field) — the ON CONFLICT target
}

model MergeAudit {
  id        String    @id @default(uuid())
  type      AuditType
  edgeId    String
  actor     String    // "worker" | "admin"
  prevHash  String    @unique // UNIQUE prevHash = the chain cannot fork: a concurrent
                              // appender hits a constraint violation, refetches head, retries.
  hash      String    @unique // SHA-256(prevHash \0 type \0 edgeId \0 createdAtISO)
  createdAt DateTime  @default(now())

  @@map("merge_audits")
  @@index([edgeId])
}
```

## Kode Inti

```typescript
// apps/worker/src/identity/union.ts
import type { PrismaClient, Prisma } from "@omnisync/db";

type Tx = Prisma.TransactionClient;
const MAX_RETRIES = 5;

/** Walk parent pointers to the component root. Returns the traversed path so
 *  path compression can be written back lazily AFTER commit (CAS-guarded
 *  updateMany on observed parentId) — reads never mutate under a lock. */
async function find(tx: Tx, id: string): Promise<{ root: string; path: string[] }> {
  const path: string[] = [];
  for (let cur = id; ; ) {
    const n = await tx.identityNode.findUniqueOrThrow({
      where: { id: cur },
      select: { id: true, parentId: true },
    });
    if (n.parentId === null) return { root: n.id, path };
    path.push(n.id);
    cur = n.parentId;
  }
}

/** Union two nodes under an evidence edge. Invariants protected:
 *  (1) journal-first — the edge, not the DSU, is the source of truth;
 *  (2) no parent-pointer cycles — ordered advisory locks + double-checked find;
 *  (3) at-least-once safe — every statement is an idempotent upsert or a no-op. */
export async function unionWithEvidence(
  prisma: PrismaClient,
  aId: string,
  bId: string,
  matchKeyHash: string,
  evidenceEventId: string,
): Promise<string> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const rootId = await prisma.$transaction(async (tx) => {
      // Optimistic pre-read: discover which component roots to lock.
      const pre = [(await find(tx, aId)).root, (await find(tx, bId)).root];
      const [lo, hi] = [...pre].sort(); // ascending UUID order = one global lock
      // order across all workers = wait-for graph is acyclic = deadlock-free.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lo}, 0))`;
      if (hi !== lo)
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hi}, 0))`;

      // Double-checked find: between pre-read and lock grant, a concurrent union
      // may have re-rooted either component — we'd hold the WRONG locks. Retry.
      const a = await find(tx, aId);
      const b = await find(tx, bId);
      const held = new Set([lo, hi]);
      if (!held.has(a.root) || !held.has(b.root)) return null;

      // Journal FIRST (canonical order so (A,B)===(B,A)). update:{} means a replay
      // is a no-op AND a TOMBSTONED edge is never silently resurrected by replay.
      const [nA, nB] = aId < bId ? [aId, bId] : [bId, aId];
      const edge = await tx.identityEdge.upsert({
        where: { nodeAId_nodeBId_matchKeyHash: { nodeAId: nA, nodeBId: nB, matchKeyHash } },
        create: { nodeAId: nA, nodeBId: nB, matchKeyHash, evidenceEventId, status: "ACTIVE" },
        update: {},
      });
      if (edge.status === "TOMBSTONED" || a.root === b.root) return a.root; // idempotent no-op

      // Union by rank: smaller-rank root becomes the child.
      const roots = await tx.identityNode.findMany({
        where: { id: { in: [a.root, b.root] } },
        select: { id: true, rank: true },
      });
      const [child, parent] =
        roots[0]!.rank <= roots[1]!.rank ? [roots[0]!, roots[1]!] : [roots[1]!, roots[0]!];

      // CAS: attach child ONLY if it is still a root — the last defense against the
      // unmerge rebuild, which swaps trees under clusterVersion OCC, not advisory locks.
      const cas = await tx.identityNode.updateMany({
        where: { id: child.id, parentId: null },
        data: { parentId: parent.id },
      });
      if (cas.count === 0) return null; // root vanished beneath us — full retry

      await tx.identityNode.update({
        where: { id: parent.id },
        data: {
          clusterVersion: { increment: 1 }, // aborts any in-flight rebuild swap
          ...(roots[0]!.rank === roots[1]!.rank ? { rank: { increment: 1 } } : {}),
        },
      });

      // Fold the losing root's LWW registers into the winner while both component
      // locks are held — readers never observe a torn golden record. Same conditional
      // upsert as below, per field; loser rows deleted after fold. (Elided for length.)
      return parent.id;
    });
    if (rootId !== null) return rootId;
  }
  throw new Error(`union contention exceeded ${MAX_RETRIES} retries (${aId}, ${bId})`);
}

/** Per-field LWW register. The write wins iff its tuple is STRICTLY greater under
 *  the total order (sourcePriority, occurredAt, eventId) — commutative and
 *  idempotent, so concurrent workers and DLQ replays converge to one golden record.
 *  ON CONFLICT takes the row lock and re-evaluates WHERE against the latest
 *  committed row, so both interleavings of two racing writers converge. */
export async function lwwUpsertField(
  db: PrismaClient | Tx, clusterId: string, field: string, value: string,
  sourcePriority: number, occurredAt: Date, eventId: string,
): Promise<void> {
  await db.$executeRaw`
    INSERT INTO profile_fields (cluster_id, field, value, source_priority, occurred_at, event_id, updated_at)
    VALUES (${clusterId}, ${field}, ${value}, ${sourcePriority}, ${occurredAt}, ${eventId}, now())
    ON CONFLICT (cluster_id, field) DO UPDATE SET
      value = EXCLUDED.value, source_priority = EXCLUDED.source_priority,
      occurred_at = EXCLUDED.occurred_at, event_id = EXCLUDED.event_id, updated_at = now()
    WHERE (EXCLUDED.source_priority, EXCLUDED.occurred_at, EXCLUDED.event_id)
        > (profile_fields.source_priority, profile_fields.occurred_at, profile_fields.event_id)`;
}
```

**Penjelasan:** invariant yang dilindungi: forest parent-pointer selalu forest (tanpa siklus, tanpa union hilang) dan selalu bisa diturunkan ulang dari edge ACTIVE, sementara setiap statement aman dijalankan dua kali — disiplin "every path is safe to run twice" yang sama dengan event.processor.ts. Subtilitasnya di celah antara pre-read optimistik dan pemberian lock: worker lain bisa me-re-root komponen di window itu, maka kode me-rerun `find()` DI BAWAH lock dan retry jika salah satu root segar lolos dari set yang di-lock — double-checked locking klasik, dengan akuisisi lock ascending-UUID yang membuat deadlock mustahil. Dua lapisan lagi: CAS (`WHERE parentId IS NULL`) bertahan terhadap rebuild unmerge (yang sengaja tidak memakai advisory lock); dan retry setelah upsert journal tidak berbahaya karena journal-lah sumber kebenaran dan upsert-nya idempoten. Terakhir, `update: {}` pada upsert edge meng-encode keputusan kebijakan: **event yang di-replay tak pernah bisa menghidupkan kembali edge TOMBSTONED** — keputusan unmerge operator durable terhadap at-least-once delivery.

## Race Conditions

- **RACE 1 — union konkuren berbagi node:** W1 union A–B (email bersama) sementara W2 union B–C (telepon bersama). Find-then-write naif kehilangan satu union atau menciptakan siklus parent (masing-masing meng-attach root lawan di bawah root sendiri). Resolusi berlapis: (a) keduanya mengambil `pg_advisory_xact_lock` pada root pre-read dalam urutan UUID naik — siapa pun yang dapat root B duluan memblokir yang lain; urutan naik membuat wait-for graph asiklik = bebas deadlock; (b) worker yang terblokir, begitu diberi lock, me-rerun find() di bawah lock; jika W1 sudah me-re-root B, root segar W2 di luar set lock-nya dan ia retry terhadap root BARU — inilah yang mencegah mengunci root basi dan menulis siklus; (c) CAS `UPDATE ... WHERE parentId IS NULL` adalah penjaga final: jika kena nol row, seluruh transaksi retry. Hasil: kedua union mendarat, {A,B,C} satu komponen, urutan interleaving tak teramati.
- **RACE 2 — split-brain field write:** Shopee (prioritas 2, occurredAt T1) dan CRM (prioritas 4, occurredAt T0) sama-sama menulis `phone` di dua worker konkuren. ON CONFLICT LWW upsert mengambil row lock; yang kalah race lock me-re-evaluasi perbandingan tuple WHERE-nya terhadap row yang baru di-commit pemenang (semantik ON CONFLICT Postgres di READ COMMITTED). Apapun urutan commit-nya, (4, T0, e1) CRM > (2, T1, e2) Shopee — kedua interleaving konvergen ke nilai CRM. Karena occurredAt adalah event time, event Tokopedia yang di-replay dari DLQ berhari-hari kemudian tetap membawa tuple aslinya dan kalah deterministik. eventId sebagai tiebreaker final membuat urutan total — dua write same-priority same-timestamp pun konvergen.
- **RACE 3 — rebuild unmerge vs merge konkuren:** admin men-tombstone edge telepon; job rebuild men-snapshot clusterVersion=v root R, BFS edge ACTIVE, menghitung dua forest baru di memori. Sementara itu event baru meng-union node baru ke komponen R — union mem-bump clusterVersion ke v+1 di dalam transaksi ter-lock-nya. Transaksi swap rebuild ber-guard `UPDATE ... WHERE id = R AND clusterVersion = v` match nol row, abort, re-enqueue untuk re-BFS (kini termasuk node baru). Reader tak pernah melihat kondisi robek: swap adalah satu transaksi. Sisi union simetris: jika rebuild swap duluan, CAS union menemukan parentId NOT NULL di tempat yang seharusnya root dan retry terhadap forest pasca-rebuild.
- **RACE 4 — retry me-replay side effect:** job identity crash setelah upsert edge tapi sebelum tulis LWW; BullMQ redeliver. Edge upsert: no-op (unique journal key). Union: no-op (root sama). LWW: no-op (tuple sama tidak strictly greater). Append audit: head rantai dijaga UNIQUE(prevHash) — append duplikat tak bisa mem-fork; replay MERGE yang sama terdeteksi lookup (edgeId, type) sebelum append. Setiap langkah idempoten → at-least-once delivery konvergen — properti yang sama yang sudah dibuktikan fingerprint-UNIQUE persist, diperluas ke mutasi graph.

## Cost Efficiency

Angka jangkar: mengekspor set "sudah membeli di channel mana pun" yang terresolve sebagai Meta suppression list memulihkan 15–25% audiens retargeting yang sudah konversi di tempat lain — **Rp15–25jt/bulan pada budget Meta Rp100jt/bulan**, kira-kira 2–3× gaji engineer mid-level Jakarta dalam spend terpulihkan. Ekspornya sengaja production-real: Meta Custom Audiences menerima SHA-256 hash telepon E.164 secara native, dan `GET /admin/suppression.csv` memancarkan format persis itu — satu-satunya langkah ter-mock adalah klik upload, yang menjawab kritik juri "rupiahnya baru nyata kalau ter-wire ke platform iklan" tanpa integrasi API berbayar. Penghematan sekunder: LTV lintas-channel menghentikan voucher akuisisi terbakar ke pelanggan lama; handle time CS turun saat satu profil menampilkan empat channel. Delta infra: **$0.00** — satu queue BullMQ ekstra dan bitmap Redis 1,2MB di infrastruktur yang sudah jalan; ~6–8 Redis command dan 3–6 row write Postgres inkremental per event.

## Scalability

Konkurensi ter-scale karena advisory lock **per-komponen, bukan global**: `hashtextextended(rootUuid)` mempartisi ruang lock, jadi concurrency 5 BullMQ hanya men-serialisasi worker yang menyentuh cluster yang SAMA; identitas tak berhubungan union paralel penuh, dan cluster panas patologis (satu telepon bersama ribuan node) terdegradasi menjadi *serialized-but-correct*, bukan salah. `find()` tetap amortized mendekati O(1): union-by-rank mem-bound kedalaman O(log n), lazy path compression menulis balik setelah commit dengan CAS pada parentId yang diamati (tak pernah menimpa re-root konkuren), dan job kompaksi repeatable malam hari meratakan pohon + membangun ulang bitmap Bloom. Budget Redis: per event ~1 BITFIELD read (k=7 probe dalam SATU command) + ≤1 BITFIELD write + ~6 command BullMQ ≈ 8 command inkremental; pada 1.000 event/hari ≈ 240k/bulan — nyaman di bawah 500k Upstash, nol idle polling tambahan (poll graph /demo hanya jalan saat demo aktif). Ukuran Bloom: n=1jt key @1% FPR butuh m ≈ 9,59jt bit ≈ **1,2MB, k=7** — satu bitmap statis, dan false positive hanya berbiaya satu SELECT ter-index di match_keys.hash, jadi **correctness tak pernah bergantung pada filter**. Postgres: MatchKey.hash UNIQUE dan index IdentityNode(parentId) menjaga tiap lookup O(log n); jutaan identitas ~150 byte/node muat di 0,5GB Neon; burst mendarat di queue (ingestion 202-cepat tak tersentuh) dan terkuras sesuai tempo worker — persis cerita backpressure OmniSync yang sudah ada.

## Security

PII tak pernah masuk layer graph: match key disimpan hanya sebagai `HMAC-SHA256(IDENTITY_PEPPER, type\0value)` — pemisah null-byte meniru idiom fingerprint.ts, dan pepper server-side (divalidasi saat startup via pola env Zod @omnisync/config) berarti tabel identity_edges/match_keys yang bocor tak membuka telepon/email apa pun dan **tahan dictionary attack offline** — tidak seperti SHA-256 polos atas nomor telepon ber-entropi rendah. Nilai mentah hidup eksklusif di profile_fields di belakang API ber-auth. Tamper-evidence: merge_audits adalah rantai hash — hash tiap baris mencakup hash baris sebelumnya — dengan UNIQUE(prevHash) yang membuat fork mustahil secara struktural; auditor bisa me-replay rantai dan membuktikan tak ada profil yang dijahit/dilepas diam-diam — penting karena merge identitas menggerakkan uang (suppression list, saldo loyalty). Authz: `POST /admin/unmerge/:edgeId` + ekspor suppression di belakang bearer-token /admin eksisting; `GET /identity/:key` rate-limited per token via @fastify/rate-limit untuk mencegah enumerasi ruang key ter-hash; semua data identitas inbound tetap hanya masuk lewat /ingest ber-HMAC — tak ada yang bisa menyuntik evidence edge palsu dari luar.

## Demo Story (~80 detik, ekstensi halaman /demo)

1. **0:00** — klik "Same Human, Three Channels": halaman menembakkan order Shopee (telepon "0812-3456-7890"), order Tokopedia ("+62 812 3456 7890"), dan update kontak CRM dalam 2 detik, diproses worker konkuren; waveform familiar berdetak.
2. **0:05** — panel graph force-directed baru menampilkan tiga node menyatu jadi satu cluster saat union commit; kartu golden-record terrakit field-demi-field dengan badge sumber; hover "name" membuka tuple LWW — CRM (prioritas 4) terlihat mengalahkan username Shopee walau event Shopee tiba terakhir.
3. **0:25** — klik "Unmerge" pada evidence edge telepon (skenario telepon kantor bersama): cluster pecah live, panel audit meng-append baris UNMERGE hash-chained dengan link prevHash→hash tersorot.
4. **0:40** — *kill shot*: "Replay the same 3 events." Duplikat terserap, tombstone bertahan, cluster **TETAP pecah** — membuktikan keputusan operator selamat dari redelivery at-least-once, mode gagal yang paling sering salah di sistem identitas. Lalu "New email evidence" menembakkan event CRM yang berbagi email dengan akun Shopee — cluster **re-merge secara sah** lewat edge baru: replay tak bisa menjahit ulang, evidence segar bisa.
5. **1:10** — "Export Meta suppression list" mengunduh CSV telepon ter-hash SHA-256 untuk cluster yang sudah konversi, dengan matematika Rp15–25jt/bulan ditampilkan di sampingnya.

## Interview Talking Points

- *"Union-find can't delete, so I made it a derived projection over an append-only evidence journal — unmerge is tombstone-plus-rebuild of one component, and I can defend on a whiteboard why journal-first ordering makes every crash point recoverable."*
- *"I ran concurrent DSU on Postgres with deadlock-free ordered advisory locks, double-checked find under the locks, and a parentId-IS-NULL CAS as the final guard — and I can walk through the exact interleaving each layer catches, plus the testcontainers test that fires racing unions to prove convergence."*
- *"The golden record is a per-field LWW register over the total order (sourcePriority, occurredAt, eventId), implemented as one conditional ON CONFLICT upsert — commutative and idempotent, so DLQ replays and out-of-order delivery converge byte-identically, which I demonstrate live."*
- *"Everything runs on free tier by design: a hand-rolled Bloom filter as k packed probes in a single Redis BITFIELD (no RedisBloom module) keeps the hot path at ~8 Redis commands per event, and I can do the 500k/month Upstash budget math from memory."*

---

# Pemenang 3 — Downtime Time-Machine: Watermarked, Hash-Chained OEE Ledger (Manufaktur)

> **Tagline:** Flink-grade event-time correctness on a free-tier stack: an append-only, hash-chained machine ledger whose downtime intervals heal themselves when late telemetry arrives — and prove they were never falsified.

## Problem Statement

Pabrik menengah Indonesia (food-processing, lini garmen) masih mengatribusi downtime mesin dari logbook kertas akhir-shift, yang under-report micro-stoppage 30–50% — angka OEE-nya fiksi dan kebocoran kapasitas kronis tak pernah diperbaiki. Di lini yang memproduksi ~Rp30jt/jam pada OEE 65%, **satu poin OEE terpulihkan ≈ Rp4–5jt/hari kapasitas yang ditemukan**. Pembunuh teknisnya: telemetri PLC/gateway datang **telat dan out-of-order** — edge gateway mem-buffer saat Wi-Fi/LoRa putus dan flush menit kemudian, teracak. Sistem apa pun yang mem-fold event dalam urutan kedatangan menghitung interval downtime yang salah — antara membuang data telat atau diam-diam mengorupsi metrik. Dan karena OEE memberi makan klaim garansi dan pelaporan ISO 22400, angkanya juga harus **tamper-evident**: catatan maintenance yang diedit diam-diam setelah kejadian adalah skenario sengketa nyata, bukan hipotesis.

## Konsep "Out of the Box"

CDP generik memperlakukan event sebagai fakta untuk disimpan; fitur ini memperlakukannya sebagai **input ke fold deterministik atas waktu-mesin, bukan waktu-kedatangan**. Langkah khasnya adalah **memisahkan dua urutan yang semua orang campur**: ledger append-only dalam urutan kedatangan (`seq`) dan di-hash-chain SHA-256 — tidak pernah menulis ulang, itulah yang membuatnya tamper-evident — sementara interval downtime adalah proyeksi yang di-fold ulang dalam urutan `occurredAt`, bebas ditulis ulang retroaktif dan terlihat. **Low watermark gaya Flink** (min dari high-watermark per-gateway, dengan aturan idle-source exclusion Flink) menentukan persis kapan interval berpindah PROVISIONAL→FINAL — sehingga "sejarah menyembuhkan diri" dan "sejarah immutable" hidup berdampingan tanpa kontradiksi.

Teknik ini tepat karena disorder-nya **struktural** (gateway yang buffering), bukan noise: dedup dan retry — yang OmniSync sudah punya — tak bisa memperbaiki folding salah-urutan; hanya semantik event-time yang bisa. Krusial untuk narasi portfolio: engine-nya **channel-agnostic** — `PLC_GATEWAY` hanyalah EventSource kelima, dan proyeksi identik dengan tabel FSM berbeda menghitung SLA lifecycle order Shopee/Tokopedia (paid→shipped→delivered juga tiba out-of-order via webhook retry) — demo pabrik hanyalah profil paling vivid dari engine ordered-timeline yang sama, jadi cerita CDP selamat di hadapan interviewer e-commerce.

## Arsitektur High-Level

1. **Ingest** (route /ingest eksisting): gateway POST telemetri yang ditandatangani **HMAC key per-gateway** (memperluas lookup `apps/api/src/lib/hmac.ts` dari secret per-channel ke row `GatewayCredential`, di-cache dengan pola TTL yang sama seperti rule-cache). Fingerprint = SHA-256(gatewayId + payload) via fingerprint.ts eksisting; `Queue.add` ke queue BullMQ baru `telemetry` dengan jobId=fingerprint (dedup seperti hari ini); HTTP 202.
2. **Queue** (packages/queue): **SATU queue baru `telemetry` dan SATU Worker baru — bukan delapan**. Partisi dibangun ulang in-process: worker berjalan `concurrency: 8` di belakang *keyed lane executor* (`hash(machineId) % LANES` promise chains), jadi job mesin-yang-sama ter-serialisasi secara konstruksi sementara mesin berbeda paralel — semuanya lewat satu blocking connection BullMQ. Ini langsung menutup jebakan idle-chatter Upstash (matematika di bagian Scalability).
3. **Worker** (apps/worker, `src/timeline/` baru di samping jalur event.processor.ts yang tak tersentuh), per event: (a) satu EVALSHA memajukan watermark mesin secara atomik di Redis (`wm:m:{machineId}` HSET gatewayId→max event-time; `wm:seen:{machineId}` gatewayId→wall-clock, untuk idle-source exclusion); (b) transaksi Prisma meng-CAS-append `MachineTimelineEntry` ke rantai hash, update row head/state `Machine` (version compare-and-swap), me-re-fold `DowntimeInterval` PROVISIONAL dari boundary FINAL terakhir, dan memfinalisasi interval yang sepenuhnya di bawah `watermark − latenessBound`; low watermark didenormalisasi ke row Machine di UPDATE yang sama sehingga **API tak pernah membaca Redis**. Event lebih tua dari bound masuk rantai sebagai `kind=LATE_ARRIVAL` (jalur telat teraudit) dan tak pernah menyentuh interval FINAL. Retry habis → DeadLetterEvent eksisting, requeue-able seperti hari ini.
4. **API** menambah `GET /oee/:machineId`, `GET /timeline/:machineId`, `GET /ledger/:machineId/verify` (jalan-kaki prevHash, kembalikan seq putus pertama) — semuanya read Postgres, nol Redis.
5. **Dashboard** menambah view timeline mesin: bar PROVISIONAL bergaris vs FINAL solid, garis watermark, gauge OEE, badge integritas rantai; poll API tiap 2 detik hanya saat terbuka.
6. **packages/types** mendapat EventSource `PLC_GATEWAY` plus `TelemetryJobData` (Zod v4, disiplin bentuk yang sama dengan EventJobData).

## Model Prisma

```prisma
enum MachineState {
  RUNNING
  IDLE
  DOWN
  MAINTENANCE
}

enum IntervalStatus {
  PROVISIONAL
  FINAL
}

model Machine {
  id         String       @id // e.g. "line2-filler-04"
  siteId     String // authz scope for /oee + /timeline
  name       String
  state      MachineState @default(IDLE)
  stateSince DateTime     @default(now())
  version    Int          @default(0) // OCC: CAS target — guards state AND chain head together
  headSeq    BigInt       @default(0) // last ledger seq; next entry must be headSeq+1
  headHash   String       @default("0000000000000000000000000000000000000000000000000000000000000000") // genesis
  lowWmMs    BigInt       @default(0) // denormalized watermark → dashboard reads Postgres, never Redis
  updatedAt  DateTime     @updatedAt

  @@map("machines")
  @@index([siteId])
}

model MachineTimelineEntry {
  id                String       @id @default(uuid())
  machineId         String
  seq               BigInt // LEDGER order (arrival). Hash chain follows seq, never occurredAt.
  occurredAt        DateTime // MACHINE time. The projection folds in this order.
  state             MachineState
  kind              String // STATE_REPORT | LATE_ARRIVAL (audited late lane)
  gatewayId         String
  sourceFingerprint String // idempotency: at-least-once replay of the same job is absorbed
  payload           Json
  prevHash          String // = hash of entry (machineId, seq-1)
  hash              String // SHA-256(prevHash || canonical entry body)

  // Chain-fork tripwire: two concurrent writers claiming the same predecessor
  // both compute seq = headSeq+1 — the unique index makes the loser fail loudly
  // even if the CAS layer were somehow bypassed.
  @@unique([machineId, seq])
  // At-least-once dedup at the ledger layer (mirrors events_fingerprint_unique).
  @@unique([machineId, sourceFingerprint])
  // Rebuild scans are always "window from last FINAL boundary, ordered by machine time":
  // composite btree makes them index-range scans, O(window) not O(history).
  @@index([machineId, occurredAt])
  @@map("machine_timeline")
}

model DowntimeInterval {
  id         String         @id @default(uuid())
  machineId  String
  state      MachineState // DOWN / IDLE / MAINTENANCE attribution
  startAt    DateTime
  endAt      DateTime? // null = open interval (always PROVISIONAL)
  status     IntervalStatus @default(PROVISIONAL)
  reasonCode String?
  version    Int            @default(0) // OCC for reason-code edits from the dashboard

  // A machine has exactly one interval starting at an instant; rebuilds upsert on it.
  @@unique([machineId, startAt])
  // OEE query shape: "FINAL intervals for machine X in range" + "all PROVISIONAL".
  @@index([machineId, status, startAt])
  @@map("downtime_intervals")
}

model GatewayCredential {
  gatewayId  String   @id
  machineIds String[] // gateways may serve multiple machines
  hmacSecret String // demo: at-rest in Neon; prod note: envelope-encrypt via KMS
  enabled    Boolean  @default(true)
  createdAt  DateTime @default(now())

  @@map("gateway_credentials")
  @@index([enabled])
}
```

## Kode Inti

```typescript
// apps/worker/src/timeline/apply-telemetry.ts
import { createHash } from "node:crypto";
import type { PrismaClient } from "@omnisync/db";
import type { Redis } from "ioredis";
import type { TelemetryJobData } from "@omnisync/types";
import type { ProcessorLogger } from "../processor/event.processor.js";
import { rebuildProjection } from "./rebuild-projection.js";
import { isUniqueViolation } from "../persistence/pg-errors.js";

// Flink watermark semantics, atomic in Redis — ONE EVALSHA per event, zero polling.
//   KEYS[1] wm:m:{machineId}    HSET gatewayId -> max event-time seen (monotonic)
//   KEYS[2] wm:seen:{machineId} HSET gatewayId -> wall-clock of last report
// Low watermark = min over NON-IDLE gateways (Flink's min-of-inputs + idle-source
// rule): without the idle exclusion, one dead gateway freezes finalization forever.
// Lua gives us the read-modify-write atomically; monotonic max means replayed or
// shuffled events can never regress the watermark.
const ADVANCE_WATERMARK = `
local hwm = tonumber(redis.call('HGET', KEYS[1], ARGV[1]) or '-1')
if tonumber(ARGV[2]) > hwm then redis.call('HSET', KEYS[1], ARGV[1], ARGV[2]) end
redis.call('HSET', KEYS[2], ARGV[1], ARGV[3])
local all = redis.call('HGETALL', KEYS[1])
local low = math.huge
for i = 1, #all, 2 do
  local seen = tonumber(redis.call('HGET', KEYS[2], all[i]) or '0')
  if tonumber(ARGV[3]) - seen <= tonumber(ARGV[4]) then      -- gateway not idle
    local v = tonumber(all[i + 1])
    if v < low then low = v end
  end
end
if low == math.huge then low = tonumber(ARGV[2]) end
return tostring(low)`;

export function buildTelemetryApplier(
  prisma: PrismaClient, redis: Redis, logger: ProcessorLogger,
  opts: { latenessBoundMs: number; idleGatewayMs: number },
) {
  return async function applyTelemetry(evt: TelemetryJobData): Promise<"applied" | "duplicate"> {
    const tMs = evt.occurredAt.getTime();
    const lowWm = Number(await redis.eval(ADVANCE_WATERMARK, 2,
      `wm:m:${evt.machineId}`, `wm:seen:${evt.machineId}`,
      evt.gatewayId, String(tMs), String(Date.now()), String(opts.idleGatewayMs)));
    const finalizeBefore = new Date(lowWm - opts.latenessBoundMs);
    // Beyond the lateness bound: append to the AUDITED late lane. FINAL history is immutable.
    const isLate = tMs < finalizeBefore.getTime();

    for (let attempt = 1; attempt <= 3; attempt++) {
      const m = await prisma.machine.findUniqueOrThrow({ where: { id: evt.machineId } });
      const seq = m.headSeq + 1n;
      // The chain hashes in ARRIVAL order (seq): late events APPEND to the ledger while
      // the downtime projection re-folds in occurredAt order. The ledger never rewrites —
      // that is why "retroactive rewrite" and "tamper-evident" can coexist.
      const hash = createHash("sha256").update(m.headHash)
        .update(`${evt.machineId}|${seq}|${tMs}|${evt.state}|${evt.gatewayId}|${evt.fingerprint}`)
        .digest("hex");
      try {
        const applied = await prisma.$transaction(async (tx) => {
          // CAS: version guards machine state AND chain head in one shot. updateMany with a
          // version predicate also takes the row lock, so the rebuild below runs under a
          // de-facto per-machine mutex. count === 0 → a concurrent writer won (e.g. a
          // dashboard DLQ requeue that bypassed the in-process partition lanes).
          const { count } = await tx.machine.updateMany({
            where: { id: m.id, version: m.version },
            data: {
              version: { increment: 1 }, headSeq: seq, headHash: hash, lowWmMs: BigInt(lowWm),
              ...(!isLate && evt.occurredAt >= m.stateSince
                ? { state: evt.state, stateSince: evt.occurredAt } : {}),
            },
          });
          if (count === 0) return false;
          await tx.machineTimelineEntry.create({ data: {
            machineId: evt.machineId, seq, occurredAt: evt.occurredAt, state: evt.state,
            kind: isLate ? "LATE_ARRIVAL" : "STATE_REPORT", gatewayId: evt.gatewayId,
            sourceFingerprint: evt.fingerprint, payload: evt.payload,
            prevHash: m.headHash, hash,
          }});
          if (!isLate) {
            // Time machine: drop PROVISIONAL intervals after the last FINAL boundary and
            // deterministically re-fold the window in (occurredAt, seq) order. The FINAL
            // boundary's end-state IS the snapshot — replay is O(lateness window), never
            // O(history), so no separate snapshot table is needed.
            await rebuildProjection(tx, evt.machineId);
            await tx.downtimeInterval.updateMany({
              where: { machineId: evt.machineId, status: "PROVISIONAL", endAt: { lte: finalizeBefore } },
              data: { status: "FINAL" }, // watermark proof: no in-bound event can land below this line
            });
          }
          return true;
        });
        if (applied) return "applied";
      } catch (err) {
        // At-least-once replay of the same job: conflict is success (same D-05 discipline).
        if (isUniqueViolation(err, "machine_timeline_machineId_sourceFingerprint_key")) return "duplicate";
        throw err;
      }
      logger.info({ machineId: evt.machineId, attempt }, "[timeline] CAS conflict — refetch and retry");
    }
    throw new Error(`[timeline] CAS exhausted for ${evt.machineId}`); // → full-jitter retry → DLQ
  };
}
```

**Penjelasan:** invariant yang dilindungi ada dua: (1) ledger adalah satu rantai hash tak terputus per mesin — prevHash tiap entri sama dengan hash pendahulunya dan seq naik tepat satu — dan (2) `DowntimeInterval` yang FINAL tak pernah bisa berubah lagi. Subtilitasnya: kedua invariant selamat dari konkurensi lewat satu mekanisme — version CAS pada row Machine menjaga state, headSeq, dan headHash sekaligus, dan karena updateMany dengan predikat version mengambil row lock lebih dulu, seluruh transaksi (append ledger + rebuild proyeksi + finalisasi) berjalan di bawah mutex de-facto per-mesin tanpa lock eksplisit atau isolasi Serializable. Subtilitas kedua adalah trik dua-urutan — hash dalam urutan kedatangan (seq) sambil fold dalam waktu-mesin (occurredAt) — yang membuat event telat bisa menulis ulang interval provisional tanpa pernah menulis ulang rantai. Terakhir, script Lua watermark membuat komputasi min-of-inputs atomik dan monotonik, dan idle-source exclusion-nya mencegah mode gagal Flink klasik: satu gateway diam membekukan finalisasi seluruh mesin.

## Race Conditions

- **Race 1 — lost update menjadi chain fork:** dua worker konkuren memproses telemetri mesin M: keduanya membaca {version: 7, headSeq: 41, headHash: H41}; worker A menulis DOWN sebagai seq 42, worker B menulis IDLE juga sebagai seq 42 dengan prevHash sama — **fork, yang lebih buruk dari lost state karena merusak properti tamper-evidence itu sendiri**. Pertahanan tiga lapis: (a) struktural — keyed lane executor in-process (hash(machineId) % 8) berarti job mesin-sama tak pernah jalan konkuren di jalur normal; (b) requeue DLQ dari dashboard sengaja mem-bypass lane (re-add via Queue.add dari proses API), jadi version CAS menangkapnya — yang kalah dapat count=0, refetch head baru, dan re-chain sebagai seq 43; (c) jika keduanya entah bagaimana lolos CAS lewat Prisma client terpisah, `@@unique([machineId, seq])` membuat INSERT kedua gagal berisik alih-alih fork senyap.
- **Race 2 — rewrite out-of-order atas sejarah terhitung:** Gateway B mem-flush DOWN telat 90 detik yang occurredAt-nya jatuh di dalam interval yang sudah dihitung: folding urutan-kedatangan akan memperpanjang interval yang salah atau menciptakan phantom. Resolusi: event append ke ledger di seq berikutnya, lalu proyeksi di-fold ulang deterministik dari boundary FINAL terakhir dalam urutan (occurredAt, seq) — tie-break seq membuat replay deterministik bahkan untuk timestamp identik. Watermark menjamin keamanan: interval difinalisasi hanya saat min(high watermark gateway non-idle) − latenessBound sudah melewati endAt-nya, jadi tak ada event telat in-bound yang bisa mendarat di dalamnya; event lebih telat dari bound masuk jalur LATE_ARRIVAL teraudit dan **terbukti** tak pernah memutasi row FINAL.
- **Race 3 — retry me-replay side effect:** BullMQ at-least-once: crash setelah commit tapi sebelum ack me-redeliver job. Append ledger adalah side effect-nya, dan `@@unique([machineId, sourceFingerprint])` menyerap replay — catch memetakan unique violation ke "duplicate" dan mengembalikan sukses, disiplin conflict-is-success yang sama dengan persistEvent. Replay EVALSHA watermark tidak berbahaya by construction: max monotonik berarti replay tak pernah memundurkan watermark.
- **Race 4 (favorit cross-examination) — gateway diam:** high watermark-nya beku, min-of-inputs tak pernah maju, semua interval PROVISIONAL selamanya. Ditangani dengan aturan idle-source Flink di dalam script Lua: gateway yang tak terlihat selama idleGatewayMs (wall-clock, default 5 menit) dikeluarkan dari min; saat reconnect dan flush, event buffer-nya masuk in-bound (rebuild) atau late-lane (teraudit) — tak pernah korupsi senyap.

## Cost Efficiency

Dua tuas terkuantifikasi. (a) **Atribusi micro-stoppage akurat:** logbook kertas kehilangan 30–50% micro-stoppage; memulihkan satu poin OEE di lini Rp30jt/jam pada OEE 65% ≈ Rp4–5jt/hari kapasitas ditemukan — **Rp120–150jt/bulan per lini**, dengan biaya software nol. (b) **Latensi deteksi:** fault merambat (misal jam macet tiap 20 menit) muncul pada delay watermark (~2 menit) alih-alih akhir shift (hingga 8 jam), jadi tereskalasi dalam shift yang sama; pada Rp500k/jam waktu lini hilang, menangkap satu drift 4 jam per minggu membayar sebulan gaji teknisi maintenance. Delta infrastruktur harfiah nol rupiah: watermark = field hash Redis, ledger + proyeksi = tabel Postgres, partisi = TypeScript in-process — kalimat interview jujurnya: *"I got Flink watermark semantics without Flink, on a free tier."* Tuas tamper-evidence bernilai defensif: dalam sengketa garansi soal apakah maintenance dilakukan sesuai jadwal, rantai hash yang bisa diverifikasi mengubah "kata kami lawan kata mereka" menjadi artefak yang bisa dicek.

## Scalability

Keberatan Upstash juri dijawab dengan arsitektur, bukan hand-waving: **BUKAN 8 queue dengan 8 blocking connection**. Ada SATU queue `telemetry`, SATU Worker BullMQ tambahan (di proses worker Render yang sama), concurrency 8, dengan urutan partisi dibangun ulang in-process oleh keyed lane executor. Matematika budget: satu worker BullMQ 5 idle dengan setelan ter-tune — drainDelay=120s (≈3 command per bangun → konservatif ~65k/bulan dengan churn marker) plus stalledInterval=300s (job telemetri selesai <1s, deteksi stall longgar aman: ~43k/bulan) ≈ **~110k/bulan idle untuk SATU worker ekstra**. Desain naif 8-worker berbiaya 8× (~880k/bulan) dan menjebol budget 500k dari idle chatter saja — persis jebakan yang proyek ini sudah dokumentasikan untuk tuning stalledInterval, kini dihindari by construction. Biaya trafik hanya ingest-driven: ~6–8 Redis command per event telemetri (Queue.add ≈ 4–5, internal EVALSHA ≈ 5–8 dihitung konservatif); burst demo harian 2 menit @50 event/s ≈ 6k event ≈ 60k command/bulan. **Total inkremental ≈ 170k/bulan** — pipeline events eksisting tetap lega di dalam 500k, dengan fallback Redis in-container terdokumentasi untuk run lokal/lebih berat. Postgres: satu INSERT ledger + satu UPDATE Machine per event (plus rebuild yang hanya menyentuh region PROVISIONAL O(lateness-window), tipikal 5–20 row); composite btree (machineId, occurredAt) menjaga scan rebuild sebagai index-range scan; 90 hari ledger skala demo ≈ puluhan MB vs 0,5GB Neon. Dashboard mem-poll API yang hanya membaca Postgres (watermark didenormalisasi ke row Machine di CAS UPDATE yang sama) — **nol read Redis dari UI**. Jalur pertumbuhan terdokumentasi, bukan improvisasi: lane adalah konstanta config (8→16 = perubahan in-process tanpa migrasi queue); jika instance worker kedua dibutuhkan (paid tier), layer CAS sudah membuat interleaving lintas-instance aman, dan upgrade terdokumentasinya adalah N queue nyata dengan routing hash(machineId) % N — fungsi consistent-hash yang sama, dipindah satu layer ke bawah.

## Security

**Authn:** HMAC-SHA256 key per-gateway (row GatewayCredential, TTL-cached seperti RoutingRule), diverifikasi atas raw body dengan verifySignature timing-safe eksisting — memperluas identitas dari per-channel ke per-device berarti key bocor mencabut satu gateway, bukan satu pabrik. **Rate limiting:** token bucket per gatewayId di Redis (satu script Lua kecil, atomic take-or-reject; ~2 command per request, terhitung di budget) sehingga gateway nakal tak bisa membuat queue kelaparan atau membakar budget Upstash. **Tamper-evidence:** `GET /ledger/:machineId/verify` berjalan prevHash→hash dari genesis (atau dari checkpoint terverifikasi terakhir, ter-cache) dan mengembalikan seq persis tempat rantai putus; karena edit reasonCode hidup di DowntimeInterval (proyeksi) sementara observasi mentah hidup di rantai immutable, operator bisa menganotasi downtime **tanpa bisa memalsukan apa yang mesin laporkan**. **Replay defense:** dedup jobId fingerprint plus `@@unique([machineId, sourceFingerprint])` berarti payload bertanda-tangan yang di-capture-dan-replay terserap, tidak dihitung dua kali. **Authz & sensitivitas data:** telemetri tanpa PII, tapi timeline state membuka volume produksi — endpoint /oee, /timeline, /ledger di-scope `Machine.siteId` terhadap bearer token terikat-site pemanggil; endpoint simulator demo di belakang guard /admin eksisting.

## Demo Story (~90 detik, ekstensi halaman /demo)

1. **0:00** — tekan "Factory mode": enam kartu mesin muncul; simulator (pola sama dengan load generator eksisting) men-stream telemetri bertanda-tangan untuk 6 mesin via 3 mock gateway lewat jalur /ingest asli. Tiap kartu: chip state live, gauge OEE, timeline horizontal — bar solid = interval FINAL, bar bergaris = PROVISIONAL, garis vertikal watermark merayap ke kanan.
2. **0:20** — tekan "Network chaos on Gateway B": simulator mem-buffer event Gateway B. Garis watermark Mesin 4 berhenti maju (aturan min-of-inputs, kasat mata), bar downtime berjalannya tetap bergaris, badge kecil "gateway silent 0:31" menghitung naik.
3. **0:50** — Gateway B mem-flush 90 detik event teracak sekaligus: recruiter melihat **bar bergaris pecah retroaktif menjadi dua interval akurat**, gauge OEE berdetak turun ke nilai terkoreksi, dan garis watermark melompat maju saat interval membeku jadi solid — correctness di bawah disorder, terjadi live, dalam satu pandangan.
4. **1:10** — finale: tekan "Tamper" (endpoint admin menjalankan raw UPDATE ke satu row machine_timeline, mem-bypass semua logika aplikasi); badge ledger membalik merah: **"hash chain broken at seq 118 — machine line2-filler-04"**, dengan link yang menyorot row persis yang dipalsukan. Total <90 detik, tanpa slide, tiap langkah memukul pipeline asli.

## Interview Talking Points

- *"I implemented Flink's watermark semantics — min-of-inputs low watermarks with idle-source exclusion — as one atomic Lua script over Redis hashes, advanced event-driven on ingest with zero polling, and I can show the command-budget math proving it fits Upstash's 500k/month free tier."*
- *"I rebuilt Kafka partition-ordering guarantees on BullMQ without the naive 8-queue design that would have burned ~880k idle Redis commands a month: one blocking connection, in-process consistent-hash lanes for structural ordering, and optimistic version CAS as the second defense layer for the paths that bypass ordering — like our dashboard's DLQ requeue."*
- *"The design separates two orders everyone conflates: the ledger hash-chains in arrival order and is append-only forever (tamper-evident), while downtime intervals are a deterministic fold in machine-time that late events may rewrite — but only in the PROVISIONAL region the watermark hasn't sealed."*
- *"It's not a manufacturing pivot — it's a channel-agnostic ordered-timeline engine inside a CDP. Swap the machine FSM for an order-lifecycle FSM and the identical code computes Shopee fulfillment SLAs under webhook disorder."*

---

# Runners-up (layak backlog)

## SLA Sentinel — Event-Time SLA Breach Detection (96 poin, kalah slot diversitas industri)

Mendeteksi **KETIADAAN** event dalam event-time (order paid tapi tidak shipped dalam SLA), dengan state machine breach PROVISIONAL/FINAL/RETRACTED dan race konvergensi timer-vs-event via CAS. Momen demo pembunuh: retraksi — "wall-clock bilang breach, watermark bilang tidak". Rasio feasibility-ke-depth terbaik di seluruh batch: satu ZSET timer wheel, satu sweeper 60 detik (~43k command/bulan, flat berapapun jumlah order), dua tabel. Catatan juri: klaim revenue "penalty tier 10–30% volume" paling hand-wavy; "reroute ke kurir backup" aspiratif — aksi riilnya alert-and-work-the-backlog; estimasi ~250k/bulan Upstash-nya optimis karena overhead per-iterasi sweeper BullMQ.

## RefundRadar — Out-of-Order Refund-Fraud Saga (95 poin)

One-liner interview terbaik di batch: **"the lost CAS becomes the fraud signal"** — pihak yang kalah CAS me-re-validasi terhadap DAG lifecycle order dan membuka FraudCase. Framing jujur "BullMQ Groups berbayar, jadi correctness hidup di Postgres OCC" persis defense tradeoff yang panel senior inginkan. Kelemahan: saga DAG order sudah banyak dibahas; race delivered-vs-refund yang jadi headline bersifat timing-dependent dan butuh forcing dari sisi demo; marketplace (bukan seller) yang mengadjudikasi refund — jadi mendeteksi & mendokumentasi (bukti delivery-scan untuk sanggahan dispute), bukan mencegah.

## RTO Sentinel — Cross-Marketplace COD Fraud Ledger (88 poin)

Pain paling viseral-Indonesia di seluruh batch (RTO COD 20–40%), dengan desain elegan: **leaf-anchored counters** yang mengubah merge identitas menjadi pure set-union — menghapus race migrasi-counter by design. Kelemahan fatal sebagai fitur standalone: dependensi tersembunyi ke seluruh layer identity-resolution GoldenGraph (tanpa itu, mekanisme headline-nya demo sebagai matching hash telepon trivial) — efektif dua proyek dalam satu. **Kandidat kuat sebagai fase LANJUTAN setelah GoldenGraph dibangun.**

## FlashGuard varian saga — Oversell-Proof Order Saga Orchestrator (88 poin)

Transactional outbox + version CAS + idempotency-keyed downstream calls, dirakit benar, dengan tiga race terspesifikasi presisi dan matematika Redis per-order yang jujur. Kalah karena paling playbook-standard: saga/outbox adalah pola "advanced" paling ter-tutorialisasi yang recruiter lihat; dua queue ekstra menambah overhead idle Upstash; build surface terbesar (compensation engine + mock warehouse & courier).

---

# Rekomendasi Urutan Build

| Urutan | Fitur | Alasan |
|--------|-------|--------|
| 1 | **FlashGuard** | Permukaan terkecil (2 tabel, 2 Lua script, 1 queue), demo paling tajam (naive-vs-escrow + kill-Redis), feasibility tertinggi menurut ketiga juri |
| 2 | **Downtime Time-Machine** | Membuka industri ketiga (manufaktur) + narasi "Flink tanpa Flink"; engine ordered-timeline reusable untuk SLA e-commerce (jembatan ke SLA Sentinel) |
| 3 | **GoldenGraph** | Paling dalam dan paling CDP-native, tapi scope risiko-correctness terbesar (concurrent DSU terkenal mudah salah secara halus) — kerjakan terakhir saat dua fitur lain sudah jadi bukti; membuka RTO Sentinel sebagai fase lanjutan |

Langkah GSD berikutnya bila ingin eksekusi: `/gsd:add-phase` (atau `/gsd:insert-phase`) untuk FlashGuard, lalu `/gsd:discuss-phase` → `/gsd:plan-phase` seperti biasa. Runner-up bisa dimasukkan parking lot via `/gsd:add-backlog`.

---

*Dokumen ini adalah hasil sesi brainstorming 2026-07-03 (workflow `wf_322a2301-f97`: 12 agent — 6 ideator, 3 juri, 3 desainer). Kode di dokumen ini adalah sketsa desain — belum dikompilasi/di-test — dan dimaksudkan sebagai titik awal plan fase, bukan implementasi final.*
