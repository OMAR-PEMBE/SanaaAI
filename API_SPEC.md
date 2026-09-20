# SanaaAI — API_SPEC.md

Status: Implementation-ready draft. Grounded in `PRD.md` (functional requirements, business rules), `ARCHITECTURE.md` (NestJS backend, hold/settle/release flow, async job queue), and `DATABASE.md` (schema, enums, entities). Where a decision is not locked elsewhere, it is marked **TBD** — do not resolve a TBD by inventing behavior.

---

## 1. API Architecture & Conventions

- **Style:** REST over HTTPS, JSON request/response bodies. No GraphQL — not justified for this scope.
- **Base URL:** `https://api.sanaaai.com/v1` (domain illustrative — **TBD**). All routes below are relative to this base.
- **Versioning:** URL-path versioning (`/v1/...`). A breaking change ships as `/v2/...` rather than mutating `/v1` behavior. No version negotiation via headers for MVP.
- **Framework alignment:** routes are organized as NestJS controllers/modules per `ARCHITECTURE.md` — one module per bounded area (`auth`, `wallet`, `payments`, `generations`, `assets`, `explore`, `admin`).
- **Content type:** `application/json` for all requests/responses except file upload (see §9.3, `multipart/form-data`).
- **Timestamps:** ISO 8601, UTC, e.g. `"2026-09-20T10:15:00Z"`.
- **IDs:** UUIDs (strings), matching `DATABASE.md` primary keys. Never sequential/guessable.
- **Money/credits:** integers only, never floats — `costCredits: 15`, not `15.0`. TZS amounts are integers (no minor-unit subdivision in this market's practice — confirm decimal handling if Snippe returns fractional amounts: **TBD**).
- **Naming:** camelCase in JSON payloads (matches `CONVENTIONS.md` §2 shared types); snake_case stays internal to the database layer only — the API layer is the translation boundary.
- **Idempotency:** any endpoint that could plausibly be retried by a flaky mobile client (notably `POST /payments/topups`) should accept an optional `Idempotency-Key` header — **TBD** on exact mechanism, flagged as a recommended pattern, not yet locked.

---

## 2. Authentication & Authorization

### 2.1 Mechanism
- Email/password authentication (PRD §8). No social login in MVP (PRD §19.8, TBD).
- On successful login, the API issues a **JWT access token**. Token lifetime, refresh-token strategy, and storage mechanism (httpOnly cookie vs. bearer header): **TBD** — `ARCHITECTURE.md` names JWT sessions but does not lock these specifics.
- Authenticated requests send `Authorization: Bearer <token>`.

### 2.2 Roles
Two roles per `DATABASE.md` §5 `user_role` enum: `user`, `admin`.
- Standard endpoints: require a valid token, act on the authenticated user's own resources only.
- Admin endpoints (`/admin/*`): require a valid token **and** `role = 'admin'`, checked server-side on every request — never trust a client-supplied role claim without verifying against the current DB row (a demoted admin's existing token must not retain admin access — token validation should check current role, not just token validity: **implementation must re-verify role per request or use short-lived tokens; exact mechanism TBD**).

### 2.3 Public (unauthenticated) endpoints
Only: `POST /auth/register`, `POST /auth/login`, `POST /auth/password/forgot`, `POST /auth/password/reset`, `GET /explore`, `GET /explore/{id}`, and the Snippe webhook endpoint (authenticated by signature, not user session — see §10).

Everything else requires a valid user session at minimum.

---

## 3. Standard Response Structures

### 3.1 Success envelope
```json
{
  "data": { },
  "meta": { }
}
```
`meta` is omitted when not applicable (e.g. single-resource fetches); present for paginated list responses (see §6).

### 3.2 Error envelope
```json
{
  "error": {
    "code": "INSUFFICIENT_CREDITS",
    "message": "Your credit balance is too low for this generation.",
    "details": { }
  }
}
```
- `code`: a stable, machine-readable string (UPPER_SNAKE_CASE) — clients should branch on `code`, never on `message` text.
- `message`: human-readable, safe to display.
- `details`: optional, structured (e.g. field-level validation errors).

### 3.3 HTTP status code conventions
| Status | Meaning |
|---|---|
| 200 | Successful read or update |
| 201 | Resource created |
| 202 | Accepted for async processing (generation submitted) |
| 400 | Validation error / malformed request |
| 401 | Missing/invalid/expired authentication |
| 403 | Authenticated but not authorized (wrong owner, non-admin hitting admin route) |
| 404 | Resource not found, **or** resource exists but belongs to another user (never leak existence — see §11.5) |
| 409 | Conflict (e.g. duplicate webhook event already processed, insufficient balance treated as 409 not 400 — see §7.4) |
| 422 | Semantically invalid request (e.g. unsupported aspect ratio for the selected model) |
| 429 | Rate limited |
| 500 | Unexpected server error |
| 503 | Upstream provider (Higgsfield/Snippe) unavailable |

---

## 4. Error Codes (initial set — extend as needed, do not remove without a version bump)

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Request body failed schema validation |
| `INVALID_CREDENTIALS` | 401 | Login email/password mismatch |
| `TOKEN_EXPIRED` | 401 | Access token expired |
| `TOKEN_INVALID` | 401 | Malformed/invalid token |
| `WEBHOOK_SIGNATURE_INVALID` | 401 | Snippe webhook failed signature verification (§10.1) |
| `FORBIDDEN` | 403 | Authenticated but not permitted |
| `NOT_FOUND` | 404 | Resource not found or not owned by requester |
| `INSUFFICIENT_CREDITS` | 409 | Wallet balance too low to place the hold |
| `PAYMENT_ALREADY_COMPLETED` | 409 | Re-initiation attempted against a `payments` row already `confirmed` |
| `WEBHOOK_DUPLICATE` | 409 | Webhook event already processed (idempotency no-op, still returns 200 to the provider — see §10.3) |
| `GENERATION_NOT_COMPLETED` | 422 | Publish/unpublish attempted on a generation not in `completed` status |
| `UNSUPPORTED_CONFIGURATION` | 422 | e.g. requested aspect ratio/duration not supported by the active `generation_configurations` row |
| `UPLOAD_INVALID` | 422 | Upload fails MIME/type validation |
| `UPLOAD_TOO_LARGE` | 422 | Upload exceeds size limit (once set — see §16) |
| `RATE_LIMITED` | 429 | Too many requests |
| `PROVIDER_UNAVAILABLE` | 503 | Higgsfield or Snippe unreachable/erroring |

---

## 5. Rate Limiting

Per PRD §8's security baseline and `ARCHITECTURE.md` §5, generation and auth endpoints are rate-limited per user (or per IP for unauthenticated auth endpoints). Exact limits: **TBD**. Recommended starting points (flag for confirmation, not locked):
- `POST /auth/login`: e.g. 10/minute per IP.
- `POST /generations/*`: e.g. per-user limit to prevent runaway Higgsfield spend from a single compromised or scripted account.

Rate-limited responses return `429` with `code: "RATE_LIMITED"` and a `Retry-After` header.

---

## 6. Pagination, Filtering, Sorting

List endpoints (`GET /generations`, `GET /wallet/transactions`, `GET /explore`, `GET /admin/*` lists) use cursor-based pagination:

**Request query params:**
- `limit` (integer, default 20, max 100)
- `cursor` (opaque string, from previous response's `meta.nextCursor`)
- `sort` (e.g. `-createdAt` for newest first; default is always newest-first — no endpoint defaults to oldest-first)

**Response `meta`:**
```json
{
  "meta": {
    "nextCursor": "eyJpZCI6Ii4uLiJ9",
    "hasMore": true
  }
}
```

Filtering: each list endpoint documents its own supported filters below (e.g. `GET /generations?status=completed`). Full-text search is only specified for `GET /explore` (§9.7) — no other endpoint requires search for MVP.

Offset-based pagination (`page`/`perPage`) is not used — cursor pagination avoids skipped/duplicated rows under concurrent writes, which matters for financial list views like transaction history.

---

## 7. Endpoints — Auth

### 7.1 `POST /auth/register`
Creates a new user account (PRD §8).

**Auth:** none.

**Body:**
```json
{
  "fullName": "Omar Suleiman Pembe",
  "email": "user@example.com",
  "password": "••••••••"
}
```

**Validation:** `fullName` non-empty; `email` valid format, case-insensitive unique (`DATABASE.md` §2.1); `password` meets policy — **TBD** (PRD §19.9).

**Response `201`:**
```json
{
  "data": {
    "user": { "id": "uuid", "fullName": "...", "email": "...", "role": "user", "createdAt": "..." },
    "accessToken": "..."
  }
}
```
A `wallets` row is created for the user as part of this request, in the same transaction (per `DATABASE.md` §2.2 — every user has exactly one wallet).

**Errors:** `409` `code: "EMAIL_TAKEN"` if email already registered (add to §4's table when locked); `400 VALIDATION_ERROR`.

### 7.2 `POST /auth/login`
**Auth:** none. **Body:** `{ "email": "...", "password": "..." }`.
**Response `200`:** same shape as register's `data`.
**Errors:** `401 INVALID_CREDENTIALS`. Do not reveal whether the email exists (do not distinguish "no such user" from "wrong password" in the response).

### 7.3 `POST /auth/logout`
**Auth:** required. Invalidates the current session/token. Exact mechanism (token blocklist vs. short-lived tokens relying on natural expiry): **TBD**.
**Response:** `204`.

### 7.4 `POST /auth/password/forgot`
**Auth:** none. **Body:** `{ "email": "..." }`.
**Response `200`:** always generic success regardless of whether the email exists, to avoid account enumeration: `{ "data": { "message": "If that email exists, a reset link has been sent." } }`.

### 7.5 `POST /auth/password/reset`
**Auth:** none (uses a reset token from the emailed link). **Body:** `{ "token": "...", "newPassword": "..." }`.
**Response `200`:** success message. **Errors:** `400` invalid/expired token.

### 7.6 `GET /auth/me`
**Auth:** required. Returns the authenticated user's own profile.
**Response `200`:** `{ "data": { "id": "...", "fullName": "...", "email": "...", "role": "...", "createdAt": "..." } }`.

---

## 8. Endpoints — Wallet & Credits

All under `/wallet`, scoped to the authenticated user — there is no endpoint to view another user's wallet (admin views go through `/admin/*`, §12).

### 8.1 `GET /wallet`
**Auth:** required.
**Response `200`:**
```json
{
  "data": {
    "balanceCredits": 340,
    "heldCredits": 15
  }
}
```
`heldCredits` reflects `wallets.held_credits` (`DATABASE.md` §2.2) — credits reserved by in-flight generations, not yet available for a new hold.

### 8.2 `GET /wallet/transactions`
Full ledger history (PRD §12 — "full transaction history" visible to the user), paginated per §6.

**Query params:** `limit`, `cursor`, optional `type` filter (`hold`|`settle`|`release`|`topup`|`refund`|`admin_adjustment`, matching `DATABASE.md` §5 enum).

**Response `200`:**
```json
{
  "data": [
    {
      "id": "uuid",
      "type": "settle",
      "amountCredits": -15,
      "balanceAfter": 325,
      "referenceType": "generation",
      "referenceId": "uuid",
      "description": "Text to Video, 5s",
      "createdAt": "..."
    }
  ],
  "meta": { "nextCursor": "...", "hasMore": true }
}
```

### 8.3 `GET /wallet/packages`
Lists active top-up packages (`credit_packages` where `is_active = true`), for the top-up UI.

**Auth:** required (or public — **TBD**; PRD doesn't specify whether a visitor can see pricing before signup, only that payment happens after auth).

**Response `200`:**
```json
{
  "data": [
    { "id": "uuid", "amountTzs": 2000, "creditsGranted": 20 },
    { "id": "uuid", "amountTzs": 5000, "creditsGranted": 50 }
  ]
}
```

---

## 9. Endpoints — Payments (Snippe top-up)

### 9.1 `POST /payments/topups`
Initiates a top-up (PRD §14 flow step 1–2).

**Auth:** required.

**Body:**
```json
{
  "creditPackageId": "uuid",
  "mobileMoneyDetails": {
    "network": "TBD",
    "phoneNumber": "+255..."
  }
}
```
Exact `mobileMoneyDetails` shape depends on Snippe's actual required fields — **TBD**, placeholder shown. Networks offered must match the live Snippe merchant account (PRD §14.1 rule 8), not be hard-coded from early mockups.

**Server behavior:** creates a `payments` row (`status: 'pending'`), snapshots `amountTzs`/`creditsGranted` from the referenced `credit_packages` row (per `DATABASE.md` §2.5 — never re-read live later), calls Snippe to initiate the charge, stores the returned reference.

**Response `202`:**
```json
{
  "data": {
    "paymentId": "uuid",
    "status": "pending",
    "amountTzs": 5000,
    "creditsGranted": 50
  }
}
```
The wallet is **not** credited by this response — only by the verified webhook (§10). The client should poll `GET /payments/{id}` (§9.2) for status.

**Errors:** `404` invalid/inactive `creditPackageId`; `503 PROVIDER_UNAVAILABLE` if Snippe's initiation call fails.

### 9.2 `GET /payments/{id}`
Poll payment status. **Auth:** required, must own the payment (404 otherwise, per §11.5).

**Response `200`:**
```json
{
  "data": {
    "id": "uuid",
    "status": "pending",
    "amountTzs": 5000,
    "creditsGranted": 50,
    "confirmedAt": null,
    "createdAt": "..."
  }
}
```
`status` is one of `pending`/`confirmed`/`failed` (`DATABASE.md` §5 `payment_status`).

### 9.3 `GET /payments`
User's own top-up history, paginated per §6.

---

## 10. Webhooks — Snippe

### 10.1 `POST /webhooks/snippe`
Server-to-server callback from Snippe confirming a payment event (PRD §14, §14.1).

**Auth:** none via user session — authenticated by **Snippe signature verification** (exact header/algorithm per current Snippe docs — **TBD**, must be verified against live Snippe documentation at implementation time, not assumed here).

**Body:** raw Snippe payload — shape is provider-defined, **TBD** pending Snippe's actual webhook schema.

**Server behavior (locked flow, PRD §14.1):**
1. Verify signature. If invalid: log to `payment_events` with `signature_verified: false`, return `401`, take no further action — never touch wallet or `payments.status` off an unverified payload.
2. If valid: insert a `payment_events` row (raw payload, `signature_verified: true`).
3. Look up the `payments` row by Snippe's transaction/reference ID.
4. **Idempotency check:** if `payments.snippe_transaction_id` is already set and matches (i.e. this event was already processed), mark this `payment_events` row `processed: false` with no side effect, return `200` (Snippe should not retry on a `200`) — per `DATABASE.md` §2.5/§2.6, the unique constraint on `snippe_transaction_id` is the actual enforcement mechanism.
5. Otherwise: within a single DB transaction — update `payments.status` to `confirmed`, set `confirmed_at`, insert a `wallet_transactions` row (`type: 'topup'`, positive `amount_credits`), update `wallets.balance_credits`. Mark the `payment_events` row `processed: true`.
6. Return `200` to Snippe regardless of internal outcome (except signature failure, `401`) — a `4xx`/`5xx` to Snippe may trigger unwanted retries; internal failures should be logged and reconciled, not surfaced as an HTTP error to the provider, unless Snippe's own integration guide specifies otherwise (**TBD**, verify against Snippe docs).

**Response:** `200` (or `401` on signature failure). No response body contract with Snippe beyond what their integration requires — **TBD**.

### 10.2 Reconciliation job (not an HTTP endpoint — background process)
Per PRD §14 and `DATABASE.md` §9, a scheduled job polls Snippe's transaction-status endpoint for any `payments` row stuck in `pending` beyond a threshold. Exact cadence: **TBD** (`DATABASE.md` §8.3 flags this too). Not user-invokable.

### 10.3 Idempotency guarantee
This is the concrete enforcement of PRD §14.1 rule 4: the database-level unique constraint on `payments.snippe_transaction_id` means a duplicate webhook delivery cannot produce two `topup` ledger entries even under concurrent webhook delivery — the second insert attempt fails at the DB layer and is caught as a no-op, not as an application error.

---

## 11. Endpoints — Generations

### 11.1 `GET /generations/configurations`
Returns the currently active tool configurations (PRD §10, `DATABASE.md` §2.10) — what the frontend uses to render available tools, durations, aspect ratios, and prices. **Never hard-code these client-side.**

**Auth:** required (or public — **TBD**, same ambiguity as §8.3; PRD's Explore flow suggests a visitor might configure before being prompted to authenticate, per PRD §7).

**Response `200`:**
```json
{
  "data": [
    { "id": "uuid", "toolType": "ai_image", "durationSeconds": null, "costCredits": 2 },
    { "id": "uuid", "toolType": "text_to_video", "durationSeconds": 5, "costCredits": 15 },
    { "id": "uuid", "toolType": "text_to_video", "durationSeconds": 10, "costCredits": 30 },
    { "id": "uuid", "toolType": "image_to_video", "durationSeconds": 5, "costCredits": 15 },
    { "id": "uuid", "toolType": "image_to_video", "durationSeconds": 10, "costCredits": 30 }
  ]
}
```
Aspect ratios are not included here unless/until confirmed against the live Higgsfield endpoint (PRD §10.1/§10.2 — "only ratios the live endpoint actually supports"); this response should reflect verified provider capability, not an assumed list.

### 11.2 `POST /generations`
Submits a new generation request — the core product action (PRD §10, §13.1).

**Auth:** required.

**Body:**
```json
{
  "generationConfigurationId": "uuid",
  "sourceUploadId": null,
  "input": {
    "prompt": "A perfume bottle among white flowers, studio lighting",
    "aspectRatio": "9:16"
  }
}
```
- `sourceUploadId` required and non-null only for `image_to_video` (must reference an `uploads` row — `DATABASE.md` §2.11 — owned by the requester, uploaded via §11.6). Stored on `generations.source_upload_id`, not inside `input`.
- `prompt` required for `ai_image` and `text_to_video`; optional (motion guidance) for `image_to_video` per PRD §10.3.

**Server behavior (locked flow, PRD §13.1, `DATABASE.md` §6.2):**
1. Look up the referenced `generation_configurations` row; if inactive/missing → `422 UNSUPPORTED_CONFIGURATION`.
2. Compute authoritative `costCredits` from that row — never trust a client-supplied price.
3. Row-lock the user's wallet (`SELECT ... FOR UPDATE`), verify `balanceCredits - heldCredits >= costCredits`. If insufficient → `409 INSUFFICIENT_CREDITS`.
4. In the same transaction: insert `generations` (`status: 'pending'`), insert `wallet_transactions` (`type: 'hold'`, negative-facing reservation — see `DATABASE.md` §5), update `wallets.held_credits`.
5. Enqueue a background job (BullMQ, per `ARCHITECTURE.md` §2) to submit to Higgsfield. Update `generations.status` to `'submitted'`.
6. Return immediately — do not block the HTTP response on Higgsfield's response time.

**Response `202`:**
```json
{
  "data": {
    "id": "uuid",
    "status": "pending",
    "toolType": "text_to_video",
    "costCredits": 15,
    "createdAt": "..."
  }
}
```

**Errors:** `422 UNSUPPORTED_CONFIGURATION`; `409 INSUFFICIENT_CREDITS`; `400 VALIDATION_ERROR` (e.g. missing `sourceUploadId` for `image_to_video`, or referencing an upload not owned by the requester → treat as `404` per §11.5's ownership-leak rule, not `403`).

### 11.3 `GET /generations/{id}`
Poll a single generation's status — the frontend's primary mechanism per `ARCHITECTURE.md` §3.3 (short-interval polling over WebSockets, for reliability on patchy connections).

**Auth:** required, must own the generation (`404` otherwise — never `403`, per §11.5).

**Response `200`:**
```json
{
  "data": {
    "id": "uuid",
    "status": "processing",
    "toolType": "text_to_video",
    "costCredits": 15,
    "input": { "prompt": "...", "aspectRatio": "9:16" },
    "outputAsset": null,
    "createdAt": "...",
    "completedAt": null
  }
}
```
When `status: 'completed'`, `outputAsset` is populated:
```json
"outputAsset": { "id": "uuid", "url": "https://cdn.../asset.mp4", "mimeType": "video/mp4" }
```
`url` is a signed/CDN-served URL — never a raw storage key or direct Higgsfield URL (per PRD §15, assets are copied into application-controlled storage).

When `status: 'failed'`: response includes a user-safe failure indicator — do not surface `failure_reason`'s raw internal text if it may contain provider internals; exact user-facing failure messaging: **TBD**.

`status: 'needs_reconciliation'` (`DATABASE.md` §5) should not be shown verbatim to the user per PRD §16 — map it to a user-facing `"processing"` or `"pending"` state in the response until resolved; exact mapping: **TBD**, flagged so it isn't silently decided in frontend code alone.

### 11.4 `GET /generations`
User's generation history (PRD §16), paginated per §6.

**Query params:** `limit`, `cursor`, optional `status` filter, optional `toolType` filter.

**Response `200`:** array of the same shape as §11.3's `data`, under `data`, with `meta` pagination info.

### 11.5 Ownership enforcement (applies to §11.2–§11.4 and §9, §13)
Every generation/payment/asset lookup filters by the authenticated user's ID at the query level (`DATABASE.md` §6.5). A request for another user's resource returns `404 NOT_FOUND` — **never `403`** — so existence of another user's resource is never confirmed to an unauthorized requester.

### 11.6 `POST /uploads`
Uploads a source image for `image_to_video` (PRD §10.3). Backed by the `uploads` table (`DATABASE.md` §2.11) — kept separate from `assets`, which represents generated output only.

**Auth:** required. **Content-Type:** `multipart/form-data`.

**Body:** `file` (binary).

**Validation:** MIME type and size limits — **TBD** (PRD §19.12, `DATABASE.md` §14.3). Must reject anything outside the eventual allowlist.

**Response `201`:**
```json
{
  "data": { "id": "uuid", "mimeType": "image/jpeg", "url": "https://cdn.../uploads/...", "createdAt": "..." }
}
```
The returned `id` is passed as `sourceUploadId` in `POST /generations` (§11.2) for `image_to_video` requests. An upload not yet referenced by any generation is retained — no automated cleanup, per `DATABASE.md` §11's retention rule, until a retention policy is decided.

### 11.7 `GET /assets/{id}/download`
Returns a fresh signed/time-limited URL for a completed generation's output asset — needed because the inline `url` returned by §11.3 may have expired by the time a user revisits their history.

**Auth:** required, must own the asset (via its parent generation) — `404` otherwise, per §11.5.

**Response `200`:**
```json
{ "data": { "url": "https://cdn.../asset.mp4", "expiresAt": "..." } }
```
Signed URL lifetime: **TBD** (§16).

---

## 12. Endpoints — Explore

### 12.1 `GET /explore`
Public, paginated, published creations only (PRD §7).

**Auth:** none.

**Query params:** `limit`, `cursor`. Filtering by `toolType`: reasonable, not explicitly required by PRD — **TBD** whether to include at MVP; omit if not confirmed rather than adding speculative filters (`DATABASE.md` §12.2 guardrail).

**Response `200`:**
```json
{
  "data": [
    { "id": "uuid", "toolType": "ai_image", "url": "https://cdn.../...", "publishedAt": "..." }
  ],
  "meta": { "nextCursor": "...", "hasMore": true }
}
```
Query filters to `assets.moderation_status = 'published'` only — never `'private'`, `'pending_review'`, or `'rejected'` (per `DATABASE.md` §2.8, §13 Definition of Done).

### 12.2 `GET /explore/{id}`
Single published item detail, for the "view details → create something like this" flow (PRD §7).

**Auth:** none. **Response `200`:** single item, same shape as list entry, `404` if not found or not published (do not distinguish "doesn't exist" from "exists but private" — same §11.5 non-leak principle applied to a public endpoint protects the *owner's* privacy here).

### 12.3 `POST /generations/{id}/publish`
User explicitly publishes a completed, owned generation's asset to Explore (PRD §7).

**Auth:** required, must own the generation, generation must be `status: 'completed'`.

**Server behavior:** sets the linked `assets.moderation_status` to `'published'` (or `'pending_review'` if a moderation review step is active — PRD §7/§19.6 TBD) and `published_at`.

**Response `200`:** updated asset visibility state. **Errors:** `404` (not owned / not found); `422` if generation is not `completed`.

### 12.4 `POST /generations/{id}/unpublish`
Reverses the above — sets `moderation_status` back to `'private'`.

**Auth:** required, must own the generation. **Response `200`.**

---

## 13. Endpoints — Admin

All under `/admin`, require `role: 'admin'` (§2.2). Every mutating admin action produces an `admin_audit_logs` row (`DATABASE.md` §2.9) with a mandatory `reason` — the API must reject a request missing one.

### 13.1 `GET /admin/users`
Paginated user list. **Query params:** `limit`, `cursor`, optional `status`/`role` filter, optional search by email/name — exact search mechanism **TBD**.

### 13.2 `GET /admin/payments`
Paginated payment list, filterable by `status`.

### 13.3 `GET /admin/generations`
Paginated generation list, filterable by `status`/`toolType`, including failure detail (`failureReason`, `providerRequestId`) for support investigation (PRD §17).

### 13.4 `GET /admin/wallet-transactions`
Full ledger, filterable by `userId`, `type`.

### 13.5 `POST /admin/users/{id}/credit-adjustments`
Manual credit adjustment (PRD §17).

**Body:**
```json
{
  "amountCredits": 50,
  "reason": "Compensation for failed generation not auto-refunded, ticket #123"
}
```
**Validation:** `reason` non-empty (`DATABASE.md` §2.9 `CHECK`). `amountCredits` may be positive or negative, non-zero.

**Server behavior:** inserts `wallet_transactions` (`type: 'admin_adjustment'`) and an `admin_audit_logs` row in the same transaction.

**Response `201`.** **Errors:** `400` missing/empty reason.

### 13.6 `POST /admin/explore/{assetId}/hide`
Hides a published item (PRD §7, §17). Sets `moderation_status` to `'rejected'` (or a dedicated hidden state — **TBD**, `DATABASE.md`'s `moderation_status` enum currently has `'rejected'` which may need a distinct `'hidden'` value depending on whether "rejected at review" and "removed after publish" need to stay distinguishable — flagged as a possible schema follow-up, not resolved here). Requires `reason` in body. Produces an `admin_audit_logs` row (`action_type: 'content_hide'` or `'content_remove'`).

### 13.7 `POST /admin/users/{id}/suspend` / `POST /admin/users/{id}/reactivate`
Sets `users.status`. Requires `reason`. Exact effect of `'suspended'` status on an existing session/token: **TBD** (`DATABASE.md` §5 flags this same gap).

---

## 14. External API Integrations

### 14.1 Higgsfield (AI generation provider)
- Called only from the backend worker process (`ARCHITECTURE.md` §2), never from `/apps/web` or exposed to the client (PRD §11, `CONVENTIONS.md` §3.5).
- Credentials: server-side env vars only (`CONVENTIONS.md` §5).
- Exact endpoint URLs, request/response shapes, and polling-vs-webhook status mechanism for Higgsfield itself: **TBD** — must be verified against live Higgsfield API documentation at implementation time; this spec defines SanaaAI's own API surface, not Higgsfield's.
- **Specifically unresolved:** whether Higgsfield pushes job-completion status via its own webhook (in which case SanaaAI needs a `POST /webhooks/higgsfield` route, analogous to §10's Snippe webhook, authenticated by Higgsfield's own signature scheme) or whether the worker must poll a Higgsfield status endpoint instead. This changes real implementation shape (an inbound route vs. a polling loop in the worker) and must be confirmed against Higgsfield's docs before building §11.2's async job — do not assume one or the other.
- Failure handling: a Higgsfield error or timeout triggers the `release` flow (§11.2 step 4 in reverse) — see `DATABASE.md` §13.1.

### 14.2 Snippe (payments)
- See §10 for the inbound webhook. Outbound calls (initiating a charge, polling status for reconciliation) are made only from the backend, credentials server-side only.
- Exact endpoint shapes: **TBD**, verify against live Snippe documentation.

---

## 15. Security Summary (API-layer specifics — full spec belongs in SECURITY.md)

- No Higgsfield/Snippe credential, or any secret, ever appears in an API response body, error message, or log line (`CONVENTIONS.md` §3.6, PRD §20).
- Every authenticated endpoint validates the JWT and re-derives the user's current role/status from the database for authorization-sensitive checks — never trusts stale claims embedded in an old token for admin/suspension status.
- All mutating financial endpoints (`POST /payments/topups`, `POST /generations`, `POST /admin/*/credit-adjustments`) run their balance-affecting logic inside a single DB transaction with row-level locking, per `DATABASE.md` §6.2.
- CORS policy: **TBD** — restrict to the actual frontend origin(s) in production, not left open.
- Input validation on every endpoint via DTO/schema validation (NestJS `class-validator` or equivalent) — reject unknown/extra fields rather than silently ignoring them, to avoid mass-assignment-style bugs.

---

## 16. Explicitly Excluded APIs

Per PRD §6.3 — do not build endpoints for: subscriptions/recurring billing, followers/likes/comments/messaging, creator social profiles, algorithmic feed ranking, native push notifications, user-selectable AI provider choice, public customer API keys, an OAuth developer platform, or team/workspace management. If a future UI mockup or draft implies one of these, treat it as scope creep to flag, not a requirement to build.

---

## 17. API Testing Requirements

Automated integration tests must cover, at minimum:
- Registration, login, and authorization checks (own-resource access succeeds, cross-user access returns `404`).
- Payment initiation; invalid Snippe webhook signature is rejected; duplicate Snippe webhook event is a no-op; a successful payment credits the wallet exactly once.
- Insufficient-credit generation attempt is rejected before any hold is placed; concurrent generation submissions against a nearly-empty wallet cannot together overspend it.
- A generation debits (settles) exactly once on success and releases exactly once on technical failure; a provider timeout/retry does not double-charge.
- Asset/upload ownership is enforced (a user cannot fetch another user's asset, upload, or generation by ID).
- Publish/unpublish transitions correctly, and only for `completed` generations.
- Admin authorization is enforced, and every admin mutation produces an audit log row.

Higgsfield and Snippe must be mocked/faked in automated tests — tests must never depend on live, billable Higgsfield generation.

---

## 18. API Guardrails (for developers and AI coding agents)

1. This file is the primary API contract; `DATABASE.md` controls persistence/financial constraints, `ARCHITECTURE.md` controls technical structure, `PRD.md` controls product behavior — if any two appear to conflict, stop and flag it rather than guessing which wins.
2. Never trust a client-supplied price, balance, or payment-success claim — always recompute/reverify server-side (§11.2 step 2, §10).
3. Never expose a Higgsfield or Snippe credential, raw provider error, or stack trace in any response body.
4. Never mutate wallet balance outside the transactional hold/settle/release/topup logic in §8, §9, §11.2.
5. Enforce ownership server-side on every request — return `404`, never `403`, for another user's resource (§11.5).
6. Process every provider callback idempotently (§10.3).
7. Run AI generation asynchronously — never block an HTTP response on Higgsfield's response time (§11.2).
8. Do not add endpoints for anything listed in §16 without an explicit, approved scope change.
9. Mark unresolved integration details as TBD rather than guessing — update this document, don't silently decide during implementation.

---

## 19. API Definition of Done

The MVP API is complete when: authentication works securely end-to-end; a user can read their wallet, packages, and configurations; Snippe top-ups are initiated server-side and a verified webhook credits the wallet exactly once; generation pricing is entirely server-controlled; validated uploads work for `image_to_video`; all three MVP tools submit asynchronous jobs and debit at most once each; a technical failure releases the hold exactly once and a retry never double-charges; generation status, results, and history are owner-authorized only; completed content can be explicitly published/unpublished and Explore returns only published, completed content; admin operations are authorized and every mutation is audited; rate limiting and validation protect the abuse-sensitive endpoints (auth, generation submission); and every provider-specific TBD in §16 is confirmed against live Higgsfield/Snippe documentation before production launch.

---

## 20. Open Items — TBD Register (API-specific)

Carried forward / new items surfaced while specifying endpoints, consistent with `PRD.md` §19 and `DATABASE.md` §14:
1. Exact JWT lifetime, refresh strategy, and logout/invalidation mechanism (§2.1, §7.3).
2. Password policy specifics (§7.1).
3. Whether `GET /wallet/packages` and `GET /generations/configurations` are public or require auth (§8.3, §11.1).
4. Exact Snippe request/webhook payload shapes and signature verification method (§9.1, §10.1).
5. Reconciliation job cadence (§10.2).
6. User-facing mapping/messaging for `needs_reconciliation` and `failed` generation states (§11.3).
7. Upload MIME type and size limits (§11.6).
8. Signed asset download URL lifetime (§11.7).
9. Whether Higgsfield uses a webhook or requires polling for job status (§14.1) — determines whether a `POST /webhooks/higgsfield` route is needed.
10. Whether Explore supports a `toolType` filter at MVP (§12.1).
11. Whether "hide" and "reject-at-review" need distinct moderation states (§13.6).
12. Effect of user suspension on existing tokens (§13.7).
13. Exact rate limits per endpoint (§5).
14. CORS allowed origins (§15).
15. API domain/base URL (§1).
16. Idempotency-key mechanism for retry-prone client requests (§1).

Do not resolve any of the above by guessing during implementation — confirm and update this document first.

---

## 21. Change Log

- **Merged from a separately drafted ChatGPT `API_SPEC.md`:** a dedicated signed-download endpoint (§11.7), more specific error codes (`PAYMENT_ALREADY_COMPLETED`, `WEBHOOK_SIGNATURE_INVALID`, `GENERATION_NOT_COMPLETED`, `UPLOAD_INVALID`, `UPLOAD_TOO_LARGE`), an explicit flag on the unresolved Higgsfield webhook-vs-polling question (§14.1), and three new reference sections: Explicitly Excluded APIs (§16), API Testing Requirements (§17), API Guardrails (§18), and API Definition of Done (§19). That draft's Laravel session/CSRF authentication model, four-tool MVP scope, and Standard/Premium tiers were **not** adopted — all three conflict with decisions already locked in `ARCHITECTURE.md` and `PRD.md` (NestJS/JWT REST API, three-tool MVP, Standard-only video at launch).
