# SanaaAI — MILESTONES.md

Status: Implementation-ready. Sequenced directly from `ARCHITECTURE.md` §8's build order (wallet integrity first, video last) and broken into chunks sized for one focused build session each — with an AI coding assistant (Claude Code, Codex, Copilot) or without. Each milestone lists its own "done" check, separate from the full `*_DEFINITION_OF_DONE` sections in the other docs, which remain the authoritative bar for the *whole* MVP.

Do not skip ahead to a later milestone before the current one's done-check passes — the ordering exists specifically so the highest-risk part (money) is proven correct before the flashiest part (video) is touched, per `ARCHITECTURE.md` §1's design principles.

---

## M0 — Project Scaffold

- Monorepo structure per `CONVENTIONS.md` §1 (`apps/web`, `apps/api`, `apps/worker`, `packages/types`, `packages/config`).
- NestJS API and worker boot with a health-check route each; Next.js frontend boots with a placeholder page.
- Postgres and Redis running locally (Docker Compose recommended for local dev).
- `.env` files populated from `.env.example` for local dev (real values, not committed).
- Tailwind + shadcn/ui installed and configured in `apps/web`, per `ARCHITECTURE.md`'s styling decision.

**Done when:** all three apps run locally, connect to local Postgres/Redis, and a "hello world" round-trip works (frontend calls a stub API route and renders the response).

---

## M1 — Database Foundation

- All tables from `DATABASE.md` §2 created via migrations, with every FK, CHECK constraint, and enum in place.
- Seed data: initial `credit_packages` and `generation_configurations` rows (`DATABASE.md` §7.2) — seeded as `is_active = false` until Higgsfield pricing is verified live (per that section's explicit caution).
- At least one seeded `admin`-role user for local dev only (never in a production-reachable seed path — see `SECURITY.md` §11).

**Done when:** the ERD in `DATABASE.md` §4 matches the actual running schema, and `DATABASE.md` §9's constraint tests (negative balance rejected, empty admin reason rejected, duplicate `snippe_transaction_id` rejected) pass against the real database.

---

## M2 — Auth

- `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `POST /auth/password/forgot`, `POST /auth/password/reset`, `GET /auth/me` (`API_SPEC.md` §7).
- Password hashing per whatever `SECURITY.md` §2's TBD resolves to — **do not proceed with a guessed algorithm; confirm this decision before writing this milestone's code.**
- A `wallets` row created in the same transaction as user registration (`DATABASE.md` §2.2).
- `/register`, `/login`, `/forgot-password`, `/reset-password` screens (`UI_SPEC.md` §5), with generic non-enumerating error responses (`SECURITY.md` §2).

**Done when:** a user can register, log in, log out, recover a forgotten password, and every user has exactly one wallet with a zero balance. Account-enumeration test (§17 of `API_SPEC.md`) passes.

---

## M3 — Wallet & Ledger Core (the highest-risk milestone — take the most care here)

- `GET /wallet`, `GET /wallet/transactions` (`API_SPEC.md` §8).
- The hold/settle/release transaction pattern implemented as a reusable service, with row-level locking (`DATABASE.md` §6.2, `SECURITY.md` §5.1) — build and test this in isolation, with a synthetic/manual trigger, **before** wiring it to real generations in M5.
- `wallet_transactions` confirmed append-only at the DB permission level (`SECURITY.md` §5.2, `DATABASE.md` §12 guardrail 5).
- Concurrency test: fire concurrent hold requests against a low-balance wallet and confirm it cannot be overspent (`DATABASE.md` §9, `SECURITY.md` §5.1 — load-tested, not just unit-tested).
- `/wallet` screen showing balance and transaction history (`UI_SPEC.md` §10, minus the top-up flow itself — that's M4).

**Done when:** the concurrency test passes under real concurrent load, not just sequential calls, and a manual/test-only hold→settle and hold→release both correctly update balance and produce the expected ledger rows.

---

## M4 — Payments (Snippe)

- Confirm live Snippe webhook payload shape and signature verification method against real Snippe documentation — this resolves several `API_SPEC.md`/`SECURITY.md` TBDs and must happen before writing this milestone's code, not be guessed.
- `POST /payments/topups`, `GET /payments/{id}`, `GET /payments`, `POST /webhooks/snippe` (`API_SPEC.md` §9–10).
- Idempotency via the `snippe_transaction_id` unique constraint (already in place from M1) — test duplicate webhook delivery explicitly.
- Reconciliation job (`API_SPEC.md` §10.2) for stuck `pending` payments — cadence per whatever's decided.
- `/wallet` top-up flow completed (`UI_SPEC.md` §10), including payment-status polling.

**Done when:** a real (or Snippe sandbox, if one exists) top-up correctly credits the wallet only after a verified webhook — never from the client response — and a duplicate webhook delivery produces zero extra credits. `SECURITY.md` §14's payment-related checklist items pass.

---

## M5 — AI Image (first generation tool, cheapest and simplest)

**Build in two steps, not one — this is a deliberate methodology change, not just a task list:**

**M5a — Generation lifecycle with a fake provider.** Before touching real Higgsfield credentials, build the entire hold → enqueue → worker picks up job → (fake provider returns a canned success or failure after a short delay) → settle/release → result visible flow, using a mock/fake provider in place of Higgsfield. This proves the wallet, queue, and status-tracking logic is correct in isolation, without spending real provider money or being blocked on live Higgsfield API access while still figuring out the plumbing.
- `GET /generations/configurations`, `POST /generations`, `GET /generations/{id}`, `GET /generations` (`API_SPEC.md` §11.1–11.4), scoped to `ai_image` only.
- `/create/image` screen and the shared status/result view (`UI_SPEC.md` §7.2, §8), talking to the fake-provider-backed pipeline.
- **Done when:** a generation completes end-to-end against the fake provider — hold placed, job processed, hold settled — and a forced fake failure correctly releases the hold with zero charge. This validates M3's wallet logic under a second real workload, not just synthetic tests.

**M5b — Real Higgsfield integration.** Only after M5a passes:
- Confirm live Higgsfield Soul 2 endpoint, request/response shape, and actual current pricing.
- Replace the fake provider with the real Higgsfield client behind the same interface M5a already proved out.
- SSRF-safe output fetching (`SECURITY.md` §10a) implemented here.
- Object storage provider decision finalized and wired in (`PRD.md` §19.10 TBD, resolved here).
- **Done when:** a real AI Image generation completes end-to-end with a real Higgsfield call and real stored output, and a deliberately-forced real provider failure correctly releases the hold.

---

## M6 — Text to Video & Image to Video

- Confirm live Higgsfield Kling 2.5 Turbo Standard endpoint/pricing for both text-to-video and image-to-video modes.
- `POST /uploads` (`API_SPEC.md` §11.6) and the `uploads` table (`DATABASE.md` §2.11) for Image to Video's source image.
- Extend the M5 generation pipeline to `text_to_video` and `image_to_video` — this should mostly be configuration, not new architecture, since both share the Kling 2.5 Turbo adapter (per the locked model decision).
- `/create/text-to-video`, `/create/image-to-video` screens (`UI_SPEC.md` §7.3–7.4).
- `GET /assets/{id}/download` (`API_SPEC.md` §11.7) for revisiting completed results later.

**Done when:** both video tools complete end-to-end with correct credit pricing (15/30 credits per PRD §12.2), and the shared pipeline built in M5 required no significant rework to support them — if it did, that's worth noting as a signal the M5 abstraction was too narrow.

---

## M7 — Generation History & Asset Management

- `/generations` history screen with filters (`UI_SPEC.md` §9, `API_SPEC.md` §11.4).
- Ownership enforcement verified explicitly: attempt cross-user access to a generation/asset/upload by ID and confirm `404` (`API_SPEC.md` §11.5, `SECURITY.md` §6).

**Done when:** `API_SPEC.md` §17's ownership test passes for generations, assets, and uploads.

---

## M8 — Explore (Publish/Discover)

- `POST /generations/{id}/publish`, `POST /generations/{id}/unpublish` (`API_SPEC.md` §12.3–12.4).
- `GET /explore`, `GET /explore/{id}` (public, unauthenticated) (`API_SPEC.md` §12.1–12.2).
- `/` (Explore) and `/explore/[id]` screens (`UI_SPEC.md` §4).
- Confirm content defaults to private and only explicitly-published, `completed` generations ever appear publicly (`DATABASE.md` §13 Definition of Done item).

**Done when:** a published item is visible to a logged-out visitor, an unpublished/private item returns `404` to everyone but its owner, and Explore's empty/loading/error states (`UI_SPEC.md` §4) are implemented.

---

## M9 — Admin Panel

- `/admin/*` routes and screens (`API_SPEC.md` §13, `UI_SPEC.md` §12): users, payments, generations, wallet transactions, credit adjustment (mandatory reason enforced both client- and server-side), Explore moderation (hide).
- Role re-verification per request, not just per token (`API_SPEC.md` §2.2, `SECURITY.md` §2 — a demoted admin's existing token must lose access promptly).
- Admin bootstrap mechanism finally implemented per whatever `SECURITY.md` §11's TBD resolves to — **this is the last reasonable point to still be deferring that decision.**

**Done when:** every admin mutation produces an `admin_audit_logs` row with a reason, and a non-admin user hitting `/admin/*` gets `403`, not a partial/broken admin view.

---

## M10 — Security & Launch Hardening

This is `SECURITY.md` §14's checklist, executed as an actual milestone rather than left as a document:
- CORS restricted to real production origin(s).
- Security headers configured.
- Dependency vulnerability scanning enabled.
- Rate limiting thresholds finalized and applied to auth/generation/webhook endpoints.
- Logging/alerting for the security-relevant events in `SECURITY.md` §9 in place.
- Incident response plan written (not just referenced).
- Backup/restore procedure tested at least once (`SECURITY.md` §10, `DATABASE.md` §10).
- Privacy policy (third-party AI processing disclosure) published.
- A full pass through every TBD register across all seven documents — confirm each is either resolved or consciously deferred with a written reason, not silently forgotten.

**Done when:** `SECURITY.md` §14's full checklist is checked off, and `PRD.md` §25's Acceptance Criteria pass end-to-end for the whole product.

---

## What's Deliberately Not a Milestone

Per `PRD.md` §6.2, Product Ad Creator is v1.1 — it gets its own milestone only after M10 ships and real usage data justifies building it. Anything in `PRD.md` §6.3 / `UI_SPEC.md` §15's exclusion lists is not a future milestone by default either — it re-enters scope only via an explicit product decision, not because it was easy to add while "already in there."

---

## Working With an AI Coding Agent, Per Milestone

For each milestone (or sub-step like M5a/M5b), the working pattern with Claude Code/Codex/Copilot should be:

1. Point it at the relevant sections of the relevant spec document(s) — not the whole doc set at once.
2. Have it inspect existing code before modifying anything, so it builds on what's there rather than re-guessing patterns already established (`CONVENTIONS.md` exists exactly for this).
3. Identify what this milestone actually depends on that isn't built yet.
4. Implement the smallest complete piece of the milestone — not the whole milestone in one shot if it has multiple independent parts.
5. Add or update tests alongside the code, not after.
6. Run the linter/formatter/test suite and fix failures before moving on.
7. Report back: which files changed, and which TBDs (from any document) this work touched or still depends on.
8. **Stop before expanding scope.** Do not let "while I'm in here" turn one milestone's session into the next milestone's work.

**Do not hand an AI coding agent "build the whole SanaaAI system" as one prompt.** Give it one milestone, or one clearly-scoped sub-step of one, at a time — this list exists to make each of those sessions self-contained and reviewable.

---

## Specification Priority

When documents seem to disagree, this is the hierarchy — but a real conflict should be resolved (update the source document) rather than silently picked around:

```
PRD.md              → product requirements
ARCHITECTURE.md      → technical structure
DATABASE.md          → persistence/integrity
API_SPEC.md          → endpoint/interface contract
SECURITY.md          → security requirements
UI_SPEC.md            → interface behavior
MILESTONES.md          → execution order only — never overrides product/technical decisions above it
```

**Change control:** when a new decision gets made mid-build (like the Kling model/pricing calls made earlier in this project), update the affected document(s) first, then this file if the build order changes, then write code — never let the codebase become the only record of a changed decision.

---

## Explicit Launch-Gate Rule

**Do not open paid generation to real users before real Higgsfield unit economics have been verified against the account's actual live pricing.** M5b/M6 already require confirming live pricing before building — this restates it as a hard launch gate: even if the code is done, a launch on unverified provider costs risks the exact margin problem surfaced earlier in this project (the promo-vs-stable pricing check). Verify, don't assume, one more time at the actual moment of opening the product to real payers.

---

## Sequencing Notes

- Each milestone that touches a live provider (Higgsfield in M5/M6, Snippe in M4) starts with confirming real API behavior against current documentation — this is called out explicitly in each milestone because guessing provider specifics is the single most likely source of wasted rework in this plan.
- M3 (Wallet & Ledger Core) is the milestone most worth over-investing in relative to its apparent size — it's small in scope but everything downstream depends on it being correct under concurrency, not just correct in the happy path.
- If M6 requires meaningfully more new architecture than "swap the model config," that's a signal worth pausing on — it may mean M5's generation pipeline was built too AI-Image-specific and should be generalized before continuing, rather than duplicating logic across three tools.

---

## Change Log

- **Merged from a separately drafted ChatGPT `IMPLEMENTATION_PLAN.md`:** split M5 into M5a (generation lifecycle proven against a fake provider) and M5b (real Higgsfield integration) — a genuine methodology improvement, decoupling wallet/queue correctness from live-provider uncertainty. Also added the AI Agent Workflow, Specification Priority, and Explicit Launch-Gate Rule sections. That draft's Laravel/PHP/Livewire/Alpine stack and four-tool (Product Ad included) scope were **not** adopted — both conflict with decisions already locked in `ARCHITECTURE.md` and `PRD.md`.
