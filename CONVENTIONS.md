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
  /config       → Shared constants (credit pricing table, model IDs) — imported by api, worker
/docs
  ARCHITECTURE.md
  CONVENTIONS.md
  DATABASE.md
  API_SPEC.md
  SECURITY.md
```

Rules:
- Never redefine a type that already exists in `/packages/types` locally inside `/apps/web` or `/apps/api`. Import it.
- Never put business logic (credit math, pricing) inline in a controller/route file. It belongs in a service, and pricing constants belong in `/packages/config`.
- `/apps/worker` and `/apps/api` may both import from `/packages/types` and `/packages/config`, but never import from each other directly — they communicate only through the database and the BullMQ queue.

---

## 2. Core shared types (`/packages/types`)

These are canonical. Do not invent alternate shapes for these entities anywhere else in the codebase.

```typescript
// generation.ts
export type ToolType = 'ai_image' | 'text_to_video' | 'image_to_video' | 'product_ad';
export type GenerationStatus = 'pending' | 'processing' | 'complete' | 'failed' | 'needs_reconciliation';

export interface Generation {
  id: string; // UUID
  userId: string;
  toolType: ToolType;
  modelUsed: string; // e.g. "soul-2", "kling-2.5-turbo-standard"
  status: GenerationStatus;
  input: GenerationInput;
  costInCredits: number;
  outputAssetId: string | null;
  createdAt: string; // ISO 8601
  updatedAt: string;
}

export interface GenerationInput {
  prompt?: string;
  sourceImageAssetId?: string; // for image-to-video / product ad
  durationSeconds?: number; // for video tools
  aspectRatio?: string;
}

// wallet.ts
export type WalletTransactionType = 'hold' | 'settle' | 'release' | 'topup' | 'refund';

export interface WalletTransaction {
  id: string; // UUID
  userId: string;
  type: WalletTransactionType;
  amountCredits: number; // positive = credit added, negative = credit removed
  balanceAfter: number; // snapshot, computed at write time — never trust a cached balance over this
  referenceId: string; // generationId or paymentTransactionId this transaction relates to
  createdAt: string;
}

// payment.ts
export type PaymentStatus = 'pending' | 'confirmed' | 'failed';

export interface PaymentTransaction {
  id: string; // UUID
  userId: string;
  snippeTransactionId: string; // idempotency key — must be unique in DB
  status: PaymentStatus;
  amountTzs: number;
  creditsGranted: number;
  createdAt: string;
  confirmedAt: string | null;
}

// asset.ts
export type ModerationStatus = 'private' | 'pending_review' | 'published' | 'rejected';

export interface Asset {
  id: string; // UUID
  generationId: string;
  storageKey: string; // path/key in object storage
  moderationStatus: ModerationStatus;
  createdAt: string;
}
```

---

## 3. Hard rules (never violate these while generating code)

1. **Never write directly to a wallet balance field.** Every balance change is an insert into `WalletTransaction`. If a `wallet_balance` cached column exists for read performance, it is updated only inside the same DB transaction as the `WalletTransaction` insert — never on its own.
2. **Never deduct credits before a generation succeeds.** Use the hold → settle/release pattern: `hold` transaction when a generation starts, `settle` (negative, finalizing the hold) on success, `release` (positive, cancelling the hold) on failure. See `ARCHITECTURE.md` §3.1.
3. **Never credit a wallet from a client-facing request/response handler.** Wallet credits from payment only happen inside the Snippe webhook handler or the reconciliation job — never in the endpoint the frontend calls to "start" a payment.
4. **Every Snippe webhook handler call must check `snippeTransactionId` against the DB unique constraint before processing.** If it already exists, return success and do nothing further — this is the idempotency guarantee. Do not use an in-memory cache or a soft check for this; it must be a DB-level unique constraint.
5. **Never call Higgsfield or Snippe from `/apps/web`.** All third-party API calls happen in `/apps/api` or `/apps/worker`. `/apps/web` only ever talks to `/apps/api`.
6. **Never store Higgsfield or Snippe credentials in any file that isn't a server-only env var.** No credentials in `/apps/web`, no credentials committed to the repo, no credentials in `/packages/*`.
7. **Every new DB migration touching `wallet_transactions`, `payment_transactions`, or `generations` must be additive (new columns/tables), never destructive, without an explicit human sign-off.** These are financial and audit-critical tables.
8. **All monetary/credit amounts are integers (credits, or minor currency units for TZS), never floats.** No `number` fields representing money may use decimals.
9. **Styling is Tailwind CSS utility classes only, plus shadcn/ui components where a pre-built one fits (forms, dialogs, toasts).** Never introduce CSS-in-JS (styled-components, Emotion), a separate global stylesheet per component, or a competing component library (MUI, Ant Design, Chakra) without an explicit decision to change this.

---

## 4. Naming conventions

- Files: kebab-case (`wallet.service.ts`, `generation.controller.ts`) — standard NestJS convention.
- DB tables: snake_case, plural (`wallet_transactions`, `generations`, `payment_transactions`).
- DB columns: snake_case (`cost_in_credits`, `moderation_status`).
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

This file wins for implementation-level specifics (exact types, exact rules). `ARCHITECTURE.md` wins for reasoning about *why*, and for anything not covered here. If a real conflict appears (not just a gap), stop and flag it rather than guessing.
