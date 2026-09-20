# SanaaAI — ARCHITECTURE.md

Status: Draft v1 — based on locked PRD scope and locked pricing decisions.
Author role: Acting senior architect (per handoff instructions).

---

## 1. Design principles (why the choices below are what they are)

1. **Payment and credit integrity is the load-bearing wall.** Every architectural choice that touches money is made conservatively, not cleverly. A clever stack that risks double-crediting a wallet is worse than a boring one that never does.
2. **AI generation is I/O-bound and slow, not compute-bound.** SanaaAI never runs AI models itself — it calls Higgsfield and waits. That means the hard engineering problem is *async job orchestration and webhook reliability*, not GPUs or ML infra.
3. **Small team, thin video margins.** The stack must be cheap to run, cheap to scale down when idle, and boring enough that one or two engineers can operate it without a platform team.
4. **Tanzania-first, not Tanzania-only.** Assume patchy mobile connections, so the frontend must degrade gracefully on slow networks and long-running video jobs must survive a user closing their browser tab.

---

## 2. Recommended stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | **Next.js (React, TypeScript)** | SSR helps Explore/Discover be crawlable and fast on slow connections; one framework serves both marketing-style public pages and the authenticated app |
| Styling / UI components | **Tailwind CSS + shadcn/ui** | Utility classes are self-contained per component — the least error-prone styling approach for AI-assisted solo development, since there's no separate stylesheet file that can silently drift out of sync with the markup (same failure mode `CONVENTIONS.md` §7 flags for shared types). shadcn/ui gives accessible, pre-built forms/dialogs/toasts without a heavy opinionated component-library look |
| Backend API | **Node.js + NestJS (TypeScript)** | Shares types/DTOs with the frontend; NestJS's module structure keeps payment, wallet, and generation logic cleanly separated — important given how much of this app is "don't let these modules leak into each other" |
| Database | **PostgreSQL** | ACID transactions are non-negotiable for a credit ledger; relational integrity for wallet/transaction/generation history |
| Job queue | **Redis + BullMQ** | Video generation is a long-running async job (Higgsfield takes seconds to minutes); queue decouples "user clicked generate" from "video is ready," survives restarts, gives you retry/backoff for free |
| Object storage | **S3-compatible (Cloudflare R2 or DigitalOcean Spaces)** | Generated images/videos need durable storage with CDN delivery; R2 has no egress fees, which matters when every video view costs you money at AWS S3 rates |
| Background worker | **Separate NestJS worker process** | Listens to BullMQ queue: submits jobs to Higgsfield, polls/receives status, writes results, updates wallet on completion/failure — isolated from the request/response web process |
| Hosting | **Single managed platform to start (Railway or Render)**, migrate to raw VPS/Docker only once traffic justifies the ops overhead | Keeps a 1–2 person team from becoming a part-time DevOps team in month one |
| Auth | **Email/password + JWT sessions (Lucia or Auth.js)** | Social login explicitly deferred per PRD; keep it simple and self-hosted rather than depending on a third-party auth SaaS you'd need to pay for at scale |

**What I'm deliberately *not* recommending:** Python/FastAPI backend, microservices, Kubernetes, or a separate ML-serving layer — none of that work exists in this product, SanaaAI is a CRUD app with a payment ledger and a job queue wrapped around two external APIs. Also not recommending CSS-in-JS (styled-components/Emotion — runtime cost, worse AI-assistant reliability) or a heavy opinionated component kit (MUI/Ant Design — fights against a distinctive, non-templated look). Reaching for infrastructure or tooling this app doesn't need is the most common way small teams burn their runway before shipping.

---

## 3. Core system flow

### 3.1 Generation flow (the product's central loop)
1. User submits a generation request (image or video) via the frontend.
2. API validates the request, **checks and reserves credits in the same DB transaction** (status: `pending`, credits moved to a `held` state — not yet deducted, not yet available).
3. API enqueues a job in BullMQ and returns immediately with a `generation_id` — the frontend polls or subscribes (see 3.3) for status.
4. Worker picks up the job, calls Higgsfield with server-side credentials only.
5. On success: worker downloads the result, uploads to object storage, marks the generation `complete`, and **converts the held credit reservation into a final deduction** in one transaction.
6. On failure (Higgsfield error, timeout, content policy rejection): worker marks the generation `failed` and **releases the held credits back to the wallet** — the user is never charged for a failed generation.
7. On ambiguous outcomes (timeout with unknown Higgsfield-side status): job goes to a `needs_reconciliation` state rather than auto-refunding or auto-charging — a scheduled job reconciles these against Higgsfield's own request-status endpoint before resolving them either way.

**Why hold-then-settle, not deduct-then-refund:** deduct-then-refund means a failed generation briefly shows a user "insufficient balance" for something else, then refunds — bad UX and a race-condition surface. Hold-then-settle never overstates what a user can actually spend.

### 3.2 Payment (top-up) flow
1. User initiates a top-up; API creates a `pending` transaction record and calls Snippe to start a mobile money charge.
2. **Wallet is never credited from the client-facing request/response cycle.** It is credited only when Snippe's server-to-server webhook confirms payment.
3. Webhook handler verifies the Snippe signature, checks the transaction hasn't already been processed (idempotency key = Snippe's transaction ID, enforced by a unique DB constraint — not just an in-memory check), then credits the wallet in one transaction.
4. If the webhook never arrives (network issue, Snippe outage), a scheduled reconciliation job polls Snippe's transaction-status endpoint for any `pending` transaction older than a few minutes.

This mirrors the generation flow's philosophy: **the source of truth for anything involving money is always the provider's confirmed callback or polled status — never a client-side "it worked" signal.**

### 3.3 Status delivery to the frontend
Given patchy connectivity, **short-interval polling (every 2–3s) is more reliable here than WebSockets** — WebSocket connections drop silently on flaky mobile networks and are harder to reason about for a small team. Polling is boring, but it recovers automatically from a dropped connection with zero extra code. Revisit this only if polling load becomes a real cost at scale.

---

## 4. Data model (high level — full detail belongs in DATABASE.md)

Core entities: `User`, `Wallet`, `WalletTransaction` (immutable ledger, append-only), `Generation` (polymorphic: image or video, tool type, model used, input, status, cost-in-credits, output asset reference), `PaymentTransaction` (Snippe reference, status, amount), `Asset` (storage reference, generation link, visibility flag for Explore).

**Non-negotiable rule carried into DATABASE.md:** `WalletTransaction` is append-only. Balance is *never* a mutable field you write to directly — it's either stored as a running total updated only inside the same transaction as a new ledger row, or computed from the ledger. This is what makes the wallet auditable when (not if) a user disputes a charge.

---

## 5. Security posture (detail belongs in SECURITY.md, flagged here as architecture-level constraints)

- Higgsfield and Snippe credentials live only in the backend/worker environment — never shipped to the frontend, never callable directly from the browser (this is already stated in the PRD; the architecture enforces it by having no client-side code path that can reach either provider).
- Snippe webhook endpoint verifies signatures and rejects unsigned/malformed requests before any DB write.
- Rate limiting on generation endpoints, scoped per user — prevents a single account from exhausting Higgsfield spend or hammering the queue.
- Explore/Discover publishing requires an explicit user action (opt-in), and published assets should pass through a lightweight review state (auto-flag on report, manual review queue) rather than shipping full automated content moderation at launch — full moderation tooling is a v1.1+ scope item, but the schema should have a `moderation_status` field from day one so it's not a painful retrofit.

---

## 6. Open questions / TBDs this architecture depends on

These are flagged, not decided — they belong to you and the PRD, not to me:

1. **Storage provider final pick** (R2 vs Spaces vs other) — affects cost model, not the architecture shape.
2. **Exact retention policy for failed/private generations** — affects storage cost projections.
3. **Reconciliation job cadence** for stuck payments/generations — proposed a few minutes above as a starting point, needs a real SLA decision.
4. **Explore moderation review SLA** — how long can a published item sit before manual review without becoming a liability.

---

## 7. Language choice: TypeScript end-to-end (not Python)

Explicitly recorded here since it's a real decision, not a default:

SanaaAI doesn't run its own AI models — every generation is an HTTP call to Higgsfield, which does the actual inference. That means this backend is I/O-bound (API calls, database writes, webhooks), not a machine-learning workload — so Python's ML ecosystem (its usual advantage on "AI products") doesn't apply here. Technically, Python/FastAPI and Node/NestJS are close to equally capable for this app.

The deciding factor is the team: **solo builder, working with AI coding assistants (Claude Code, Codex, Copilot) instead of human code reviewers.** In that setup, the biggest risk isn't which language is faster to write — it's a silent mismatch between what the frontend sends and what the backend expects, going uncaught because there's no teammate to catch it in review. TypeScript end-to-end (Next.js + NestJS) turns that into a compile-time error instead of a production bug, because frontend and backend share the same type definitions instead of two languages independently re-implementing the same shapes.

**Practical consequence — shared types package:**
Define the core data shapes once, in a single shared location in the repo, and import them from both the frontend and the backend rather than redefining them per-side:

- `Generation` (id, tool type, model used, status, input, cost-in-credits, output asset reference)
- `WalletTransaction` (id, type: hold/settle/refund/topup, amount, balance-after, reference)
- `PaymentTransaction` (Snippe reference, status, amount, currency)
- `Asset` (storage reference, generation link, visibility/moderation status)

In a single repo (recommended for a solo project — don't split into multiple repos or a published npm package for this), this can be as simple as a `/shared` or `/packages/types` directory imported by both the `apps/web` (Next.js) and `apps/api` (NestJS) folders in a monorepo layout, or even just a `types/` folder at the root if you keep frontend and backend in one Next.js app with API routes early on and split out NestJS later.

**Why this matters more for you than for a team:** an AI coding assistant working file-by-file will happily invent a plausible-looking shape for `Generation` if it can't see the canonical one — and that invented shape may not match what actually exists elsewhere in the codebase. A single, explicit shared-types source gives Claude Code/Codex/Copilot one place to check instead of inferring from context, which reduces the single most common failure mode of AI-assisted solo development: two files that each look correct in isolation but don't actually agree with each other.

---

## 8. What I'd build first (build order recommendation)

1. Wallet + ledger schema and the hold/settle transaction logic — get the money-handling primitive right before any AI call exists.
2. Snippe webhook + reconciliation job — prove real money can move in and be trusted.
3. Soul 2 (AI Image) generation flow end-to-end — the cheapest, fastest path to a working demo loop.
4. Kling 2.5 Turbo video flow (Text-to-Video, then Image-to-Video as a variant) — reuses the same job/worker infrastructure built for images.
5. Explore/Discover (minimal, admin-seeded or manually reviewed) — lowest priority of the launch scope; the paid loop must work before public browsing matters.

This order means you have a working, real-money-moving product with one tool before video is even touched — the highest-risk, most novel part of the system (payment integrity) gets built and battle-tested first, not last.
