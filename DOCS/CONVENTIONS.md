# SanaaAI — CONVENTIONS.md

Purpose: this file is written for AI coding assistants (Claude Code, Codex, Copilot), not for humans deciding strategy. Read `ARCHITECTURE.md` for reasoning and trade-offs. Read this file for exact rules to follow while generating code. When in doubt, follow this file over inferring from context.

---

## 1. Repository structure (fixed — do not deviate)

Monorepo, single repo, npm/pnpm workspaces.

```
/apps
  /web          → Next.js frontend (TypeScript, React)
  /api          → NestJS backend API (TypeScript)
  /worker       → NestJS background worker process (TypeScript)
/packages
  /types        → Shared TypeScript types/interfaces — imported by web, api, worker
  /config       → Shared non-price constants (app name, verified image aspect ratios, upload allowlist)
  /db           → Prisma client and the wallet ledger — imported by api and worker
  /providers    → Payment, generation, and storage adapters — imported by api and worker
  /generation   → Generation job processor — imported by the worker and by tests
/DOCS
  ARCHITECTURE.md
  CONVENTIONS.md
  DATABASE.md
  API_SPEC.md
  SECURITY.md
```

`packages/db`, `packages/providers`, and `packages/generation` were added on 2026-10-12 so the API and the worker can share the ledger and the provider ports without importing each other. Credit prices are rows in `credit_packages` and `generation_configurations`, not constants in `packages/config`. Specs live in `DOCS/`, not `docs/`.

Rules:
- Never redefine a type that already exists in `/packages/types` locally inside `/apps/web` or `/apps/api`. Import it.
- Never put business logic (credit math, pricing) inline in a controller/route file. It belongs in a service. Prices are read from the database. `packages/config` does not hold credit prices.
- `/apps/worker` and `/apps/api` may both import from `/packages/types` and `/packages/config`, but never import from each other directly — they communicate only through the database and the BullMQ queue.

---

## 2. Core shared types (`/packages/types`)

These are canonical. Do not invent alternate shapes for these entities anywhere else in the codebase.

The executable copies live in `packages/types`. Shapes below match `DATABASE.md` and `API_SPEC.md`. `product_ad` is not a tool type until v1.1. Generation status uses `submitted` and `completed` (not `complete`). Ledger type includes `admin_adjustment`. The payments table is `payments`.

```typescript
export type ToolType = 'ai_image' | 'text_to_video' | 'image_to_video';
export type GenerationStatus =
  | 'pending'
  | 'submitted'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'needs_reconciliation';
export type PublicGenerationStatus = Exclude<GenerationStatus, 'needs_reconciliation'>;

export type WalletTransactionType =
  | 'hold'
  | 'settle'
  | 'release'
  | 'topup'
  | 'refund'
  | 'admin_adjustment';

export type PaymentStatus = 'pending' | 'confirmed' | 'failed';
export type ModerationStatus = 'private' | 'pending_review' | 'published' | 'rejected';
```

JSON field for a generation's cost is `costCredits`. A hold's `amountCredits` is negative and does not change posted balance. `settle` is negative and does. `release` is positive and does not. See `DATABASE.md` §2.3.

---

## 3. Hard rules (never violate these while generating code)

1. **Never write directly to a wallet balance field.** Every balance change is an insert into `WalletTransaction`. If a `wallet_balance` cached column exists for read performance, it is updated only inside the same DB transaction as the `WalletTransaction` insert — never on its own.
2. **Never deduct credits before a generation succeeds.** Use the hold → settle/release pattern: `hold` transaction when a generation starts, `settle` (negative, finalizing the hold) on success, `release` (positive, cancelling the hold) on failure. See `ARCHITECTURE.md` §3.1.
3. **Never credit a wallet from a client-facing request/response handler.** Wallet credits from payment only happen inside the Snippe webhook handler or the reconciliation job — never in the endpoint the frontend calls to "start" a payment.
4. **Every Snippe webhook handler call must check `snippeTransactionId` against the DB unique constraint before processing.** If it already exists, return success and do nothing further — this is the idempotency guarantee. Do not use an in-memory cache or a soft check for this; it must be a DB-level unique constraint.
5. **Never call Higgsfield or Snippe from `/apps/web`.** All third-party API calls happen in `/apps/api` or `/apps/worker`. `/apps/web` only ever talks to `/apps/api`.
6. **Never store Higgsfield or Snippe credentials in any file that isn't a server-only env var.** No credentials in `/apps/web`, no credentials committed to the repo, no credentials in `/packages/*`.
7. **Every new DB migration touching `wallet_transactions`, `payment_transactions`, or `generations` must be additive (new columns/tables), never destructive, without an explicit human sign-off.** These are financial and audit-critical tables.
8. **All monetary and credit amounts are integers, never floats.** TZS amounts are whole shillings, matching Snippe's integer `amount`. Do not multiply by 100.
9. **Styling is Tailwind CSS utility classes only, plus shadcn/ui components where a pre-built one fits (forms, dialogs, toasts).** Never introduce CSS-in-JS (styled-components, Emotion), a separate global stylesheet per component, or a competing component library (MUI, Ant Design, Chakra) without an explicit decision to change this.

---

## 4. Naming conventions

- Files: kebab-case (`wallet.service.ts`, `generation.controller.ts`) — standard NestJS convention.
- DB tables: snake_case, plural (`wallet_transactions`, `generations`, `payments`). The payments table is `payments`, not `payment_transactions`.
- DB columns: snake_case (`cost_credits`, `moderation_status`).
- TypeScript interfaces/types: PascalCase, camelCase fields (matches §2 above) — API layer is responsible for mapping snake_case DB rows to camelCase DTOs.

---

## 5. Required environment variables

```
DATABASE_URL=
REDIS_URL=
HIGGSFIELD_API_KEY_ID=
HIGGSFIELD_API_KEY_SECRET=
SNIPPE_API_KEY=
SNIPPE_WEBHOOK_SECRET=
STORAGE_ENDPOINT=
STORAGE_ACCESS_KEY=
STORAGE_SECRET_KEY=
STORAGE_BUCKET=
JWT_SECRET=
```

All of the above are server-side only (`/apps/api` and `/apps/worker`). None may appear in `/apps/web` env files or be prefixed `NEXT_PUBLIC_`.

---

## 6. Testing expectations

- Any code touching `WalletTransaction` inserts or the hold/settle/release flow requires a test that verifies balance correctness after success, failure, and partial-failure (timeout) scenarios.
- Any webhook handler requires a test for: valid signature + new transaction, valid signature + duplicate transaction (must be a no-op), invalid signature (must reject).

---

## 7. When this file and ARCHITECTURE.md seem to disagree

This file wins for implementation-level specifics (exact types, exact rules). `ARCHITECTURE.md` wins for reasoning about *why*, and for anything not covered here. If a real conflict appears (not just a gap), stop and flag it rather than guessing. Where this file's earlier type names disagreed with `DATABASE.md` or `API_SPEC.md`, the 2026-10-12 edit above follows the database and the API. `DATABASE.md` still wins for physical columns.

---

## 8. Change Log

- **2026-10-12:** Shared packages extended with `db`, `providers`, and `generation`. Stale types (`product_ad`, `complete`, missing `admin_adjustment`, `payment_transactions`) replaced with the database enums. TZS amounts clarified as whole shillings.
