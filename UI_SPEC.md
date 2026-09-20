# SanaaAI — UI_SPEC.md

Status: Implementation-ready draft. Grounded in `PRD.md` (functional requirements, user journeys §23, product principle §5, responsive requirement §21), `ARCHITECTURE.md` (Next.js frontend, polling-based status updates), and `API_SPEC.md` (exact endpoints/response shapes this UI consumes). This document specifies structure, states, and behavior — not final visual design (colors, typography, spacing tokens belong to a separate design-system pass, flagged as **TBD** throughout). Where PRD/API_SPEC left a UI-relevant decision open, it stays **TBD** here too.

---

## 1. UI Principles

1. **Outcome-first, not model-first** (`PRD.md` §5). The UI never shows "Soul 2" or "Kling 2.5 Turbo." It shows "AI Image," "Text to Video," "Image to Video," with duration/aspect-ratio and price — the only vocabulary a user needs.
2. **Price is always visible before commitment.** Every generation screen shows exact credit cost and current wallet balance before the user confirms (`PRD.md` §10.4) — never a surprise deduction.
3. **Async by default.** Generation takes real time; the UI must never block on it. A submitted generation is immediately acknowledged, then tracked via status polling (`ARCHITECTURE.md` §3.3), with the user free to navigate away and return.
4. **Private by default, public by explicit choice** (`PRD.md` §7). Nothing a user creates is ever shown to anyone else unless they take a deliberate publish action — the UI must make this state (private/published) visible at a glance on every piece of content.
5. **Works on a slow phone connection, not just a demo laptop** (`PRD.md` §21). Every screen needs a defined loading, empty, and error state — none of these are optional polish.

---

## 1a. Design Tokens

Use centralized design tokens (Tailwind theme config) rather than scattered arbitrary values throughout components. Required semantic categories — exact values (colors, radii, shadows, font family) are a visual-design decision, **TBD**, separate from this document:

```
background, surface, surface-muted
text-primary, text-secondary, text-muted
border, focus
primary, primary-hover, accent
success, warning, danger
```

Radius: consistent semantic levels (`small`/`medium`/`large`/`full`) rather than one-off pixel values per component. Shadows: subtle, used only for hierarchy — avoid heavy floating-card effects throughout. Typography: one primary sans-serif family (TBD), with a defined hierarchy (display/hero, page title, section heading, card heading, body, small body, caption, button label) — strong contrast between headings and body, no tiny text, numeric credit balances easy to scan at a glance.

---

## 2. Information Architecture

```
/                         → Explore (public landing)
/explore/[id]             → Explore item detail (public)
/register, /login          → Auth
/forgot-password, /reset-password
/dashboard                → Authenticated home
/create/image              → AI Image tool
/create/text-to-video       → Text to Video tool
/create/image-to-video      → Image to Video tool
/generations                → Generation history
/generations/[id]           → Single generation detail
/wallet                     → Balance, top-up, transaction history
/account                    → Profile/settings
/admin/*                    → Admin panel (role-gated)
```

Product Ad Creator has no route — it is deferred (`PRD.md` §6.2) and must not appear in navigation, marketing copy, or a disabled/greyed-out placeholder that implies "coming soon" without confirmation that's the intended messaging. **TBD:** whether a "more tools coming" teaser is desired at all.

---

## 3. Global Layout & Navigation

### 3.1 Unauthenticated header
Logo/wordmark, primary nav to Explore, Login and Register actions. No wallet/credit UI (nothing to show).

### 3.2 Authenticated header
Logo, nav to Dashboard/Explore/History, **persistent credit balance indicator** (always visible, not buried in a menu — per Principle 2), Top Up action, account menu (Account, Logout).

### 3.3 Mobile navigation
Per `PRD.md` §21, the same functionality must work on mobile — not a reduced feature set. Recommend a bottom tab bar or collapsible header nav on small viewports (Dashboard/Create, History, Wallet, Account) rather than hiding primary actions behind a hamburger-only menu, since credit balance and "create" are the two highest-frequency actions. Exact mobile nav pattern: **TBD**, flagged for the design pass, but the constraint (balance and create-action reachable in one tap on mobile) is locked.

---

## 4. Screen: Explore (`/`, public)

**Purpose:** PRD §7 — show value before signup.

**Layout:** grid/masonry of published creations (image thumbnails, video with a play/hover-preview affordance). Each card: preview media, tool-type badge, "Create something like this" action.

**Data source:** `GET /explore` (`API_SPEC.md` §12.1), cursor-paginated — implement as infinite scroll or a "Load more" action; infinite scroll fits a mobile-first browsing pattern better. **TBD:** final choice.

**States:**
- **Loading (initial):** skeleton grid, not a blank screen or spinner-only — per Principle 5, a slow connection should show visible progress, not a stall.
- **Loading (pagination):** inline spinner/skeleton at grid bottom, existing content stays visible.
- **Empty:** (no published content yet — realistic at launch) a message plus a prompt to sign up and create the first piece, not a broken-looking blank grid.
- **Error:** retry action; never a silent failure on the platform's primary public-facing page.

**Interaction:** clicking a card → `/explore/[id]`. Clicking "Create something like this" while unauthenticated → routes toward registration, then (per `PRD.md` §19.7, still TBD) either preserves the intended tool/configuration through signup or drops the user at the dashboard to reconfigure — **explicitly flagged as unresolved, do not silently assume one behavior.**

## 4.1 Screen: Explore Item Detail (`/explore/[id]`, public)

Full-size media, tool type, "Create something like this" CTA leading into the matching `/create/*` route pre-selected to that tool. `GET /explore/{id}` (`API_SPEC.md` §12.2). `404` state (item unpublished/removed since the link was shared) must show a graceful "no longer available" message, not a generic error page.

---

## 5. Screens: Authentication

### 5.1 Register (`/register`)
Fields: full name, email, password (per `PRD.md` §8, `API_SPEC.md` §7.1). Inline validation on blur; submit disabled until client-side checks pass (still fully re-validated server-side — client validation is UX only, never the security boundary, per `SECURITY.md` §7). On success: authenticated, redirected to `/dashboard`.

**Password policy display:** exact rules **TBD** (`SECURITY.md` §15.1) — the UI must render whatever the finalized policy is; do not hard-code a guessed rule set into the UI now.

**Error states:** field-level errors (invalid email format) rendered inline; account-already-exists is a server error surfaced generically per `SECURITY.md`'s enumeration-prevention rule — do not say "email already registered" if that contradicts the finalized policy (`API_SPEC.md` currently marks this as a TBD-named error code; UI copy must match whatever's decided).

### 5.2 Login (`/login`)
Email, password. Generic error message on failure ("Invalid email or password") — never distinguishes which field was wrong (`SECURITY.md` §2). Link to `/forgot-password`.

### 5.3 Forgot / Reset Password
Forgot: single email field, always-generic success message regardless of whether the account exists (`API_SPEC.md` §7.4). Reset: new password field(s), token from emailed link consumed via URL param.

---

## 6. Screen: Dashboard (`/dashboard`, authenticated)

Per `PRD.md` §9. Layout:
- Credit balance (prominent).
- Top Up action.
- Three tool entry points (AI Image, Text to Video, Image to Video) as the dominant visual focus — this is the primary action surface of the product, not a secondary widget among many.
- Recent creations (last few, with status) — links to full `/generations`.
- No dashboard "widgets" beyond these per PRD §6.3's exclusions (no feed, no social activity, no analytics dashboard for a regular user).

---

## 7. Screens: Generation Tools (`/create/*`)

### 7.1 Shared structure across all three tools
Every tool screen shares this shape (differing only in inputs, per §7.2–7.4):
1. **Configuration panel:** tool-specific inputs (§7.2–7.4).
2. **Live price display:** cost in credits, sourced from `GET /generations/configurations` (`API_SPEC.md` §11.1) — never a hard-coded number in frontend code, since price is entirely server-controlled (`PRD.md` §12.2, `DATABASE.md` §2.10).
3. **Wallet balance check:** if balance < cost, the generate action is disabled/replaced with a Top Up prompt rather than allowing a doomed submission that the server will reject with `409 INSUFFICIENT_CREDITS`.
4. **Generate action** → `POST /generations` (`API_SPEC.md` §11.2).
5. **Post-submit:** immediately transitions to a status view (§8) — the user is never left staring at a spinner with no feedback for the full duration of an async job.

### 7.2 AI Image (`/create/image`)
Input: prompt (text area). Options: aspect ratio, limited to whatever `GET /generations/configurations` actually returns as supported (`PRD.md` §10.1 — never hard-code an assumed ratio list). No source image, no duration control.

### 7.3 Text to Video (`/create/text-to-video`)
Input: prompt. Options: duration (5s/10s — the only two locked options, `PRD.md` §12.2), aspect ratio (server-driven list, same caveat as §7.2).

### 7.4 Image to Video (`/create/image-to-video`)
Input: image upload (drag-and-drop + file picker), optional motion-guidance prompt. Upload flow: `POST /uploads` (`API_SPEC.md` §11.6) fires on file selection, before the generation is submitted — the UI shows an upload-in-progress state, then a preview thumbnail once the upload completes, and the returned `id` is attached as `sourceUploadId` on the eventual `POST /generations` call.

**Upload UI requirements:**
- Client-side pre-check of file type/size for fast feedback, but this is UX convenience only — the server re-validates regardless (`SECURITY.md` §6).
- Exact accepted formats/size limit shown to the user: **TBD**, pending `API_SPEC.md` §20.7's open MIME/size decision — the UI copy must reflect whatever is finalized, not a guess.
- Upload failure (wrong type, too large, network error) shown inline, with a retry action, not a full-page error.

---

## 8. Generation Status & Result

Applies after submission from any `/create/*` screen, and when revisiting `/generations/[id]`.

**Polling behavior** (`ARCHITECTURE.md` §3.3): the frontend polls `GET /generations/{id}` every 2–3 seconds while status is `pending`/`submitted`/`processing`. Polling stops once a terminal state is reached (`completed`/`failed`) or the user navigates away.

**States shown to the user:**
| API status | User-facing state | UI treatment |
|---|---|---|
| `pending` / `submitted` | "Starting…" | Indeterminate progress indicator |
| `processing` | "Creating your [image/video]…" | Indeterminate progress indicator; for video, consider a rough expected-time hint — **TBD**, only if Higgsfield exposes any timing signal |
| `completed` | Result shown | Preview (image or video player), Download, Publish/Keep Private toggle, Regenerate |
| `failed` | Friendly failure message | "Something went wrong — your credits have been returned." plus a Try Again action. Exact user-facing copy for `failure_reason`: **TBD** (`API_SPEC.md` §11.3, §20.6) — never surface a raw provider error string to the user |
| `needs_reconciliation` (internal) | Same as `processing` | Per `API_SPEC.md` §11.3, this internal state maps to a still-processing appearance — never shown verbatim; exact mapping TBD but must not read as an error to the user while unresolved |

**Regeneration:** a distinct action that submits a new `POST /generations` with the same or edited configuration — the UI must make clear this is a new, separately charged action (`PRD.md` §10.4), e.g. showing the price again before confirming, not implying a free retry.

**Leaving and returning:** since generation is async, a user can navigate away after submitting and find the result later in `/generations` — the UI should not require the user to stay on the submission screen.

---

## 9. Screen: Generation History (`/generations`)

Per `PRD.md` §16. List/grid of the user's own generations: thumbnail/preview, tool type, status, date, credits consumed, private/published indicator. Filters: status, tool type (`API_SPEC.md` §11.4). Cursor-paginated (`API_SPEC.md` §6).

Clicking an item → `/generations/[id]`, same detail/result view as §8's completed state, plus:
- **Publish / Unpublish toggle** (`API_SPEC.md` §12.3–12.4) — only enabled for `completed` generations.
- **Download** action, using a freshly-fetched signed URL (`GET /assets/{id}/download`, `API_SPEC.md` §11.7) rather than relying on a URL that might have expired since the generation completed.
- **Access control note for implementers:** this route must 404 (not 403) for a generation the visitor doesn't own, consistent with `API_SPEC.md` §11.5 — the frontend should treat a 404 response here as "not found," and never attempt to distinguish "doesn't exist" from "exists but isn't yours" in the UI.

---

## 10. Screen: Wallet (`/wallet`)

Per `PRD.md` §12. Sections:
- **Current balance** (`GET /wallet`, `API_SPEC.md` §8.1) — also shows `heldCredits` if the design wants to surface "in-flight" reservations distinctly from spendable balance; **TBD** whether to expose `heldCredits` in the UI at all, or just show `balanceCredits - heldCredits` as a single "available" number. Recommend showing a single "available" figure for simplicity, with held/pending amounts visible only in transaction history detail — flagged as a recommendation, not locked.
- **Top Up:** package selection (`GET /wallet/packages`, `API_SPEC.md` §8.3) → mobile money details form → Snippe payment flow (`POST /payments/topups`, `API_SPEC.md` §9.1). Exact Snippe-side UI (redirect vs. in-app prompt for a mobile money PIN, etc.) depends on Snippe's actual integration pattern: **TBD**, verify against live Snippe integration docs before building this screen.
- **Payment status:** after initiating a top-up, the UI polls `GET /payments/{id}` (`API_SPEC.md` §9.2) similarly to generation status — pending → confirmed/failed. The wallet balance shown elsewhere in the UI must refresh once a top-up confirms, not require a manual page reload.
- **Transaction history:** `GET /wallet/transactions` (`API_SPEC.md` §8.2), paginated, filterable by type. Each row: type, amount (signed, colored to distinguish credit vs. debit), description, date, resulting balance.

---

## 11. Screen: Account (`/account`)

Minimal for MVP: view profile (name, email), change password. No additional profile fields beyond what §7.1 of `API_SPEC.md` defines — do not add settings/fields the PRD doesn't specify (e.g. no notification preferences, no bio, no avatar — none of these are in scope).

---

## 12. Admin Panel (`/admin/*`)

Per `PRD.md` §17, role-gated (`role: 'admin'`). Not a public-facing design priority — functional over polished, consistent with `DATABASE.md`/`API_SPEC.md`'s instruction not to over-build. Minimum screens:
- **Users:** list (`GET /admin/users`), detail view showing wallet/generation/payment summary for support investigation.
- **Payments:** list (`GET /admin/payments`), filterable by status.
- **Generations:** list (`GET /admin/generations`), filterable by status/tool, with failure detail visible for support.
- **Wallet transactions:** full ledger view (`GET /admin/wallet-transactions`), filterable by user.
- **Credit adjustment:** form requiring an amount and a **mandatory, non-empty reason** (`API_SPEC.md` §13.5) — submit button disabled until a reason is entered, mirroring the server-side requirement in the UI itself.
- **Explore moderation:** ability to hide a published item (`API_SPEC.md` §13.6), with a required reason.

**Do not build:** a general-purpose admin dashboard with analytics/charts beyond what's needed for the above — that's explicitly out of scope (`PRD.md` §17, `ARCHITECTURE.md`).

---

## 12a. Content & Copy Guidelines

All customer-facing copy describes outcomes, never infrastructure — a direct consequence of Principle 1 (§1).

**Prefer:** "Create an image," "Top up credits," "Creating your video…," "Payment pending," "Share to Explore."
**Avoid:** "Invoke model," "Execute inference," "API request pending," "Provider job," "Inference credits" — or any language that leaks Higgsfield/Snippe/provider internals into the user-facing product.

Representative copy for common states (exact final wording is a copywriting pass, **TBD** — these establish the register, not the locked text):
- Upload prompt: "Upload a product image" / "Accepted formats and size will be shown once finalized."
- Processing: "Creating your content… You can leave this page and check History later."
- Insufficient credits: "Not enough credits — you need 15 credits to create this."
- Private: "Private — only you can access this creation."
- Published: "Public on Explore — people can discover this creation."

---

## 13. Shared UI Patterns

### 13.1 Loading states
Every data-fetching view needs an explicit loading state (skeleton preferred over spinner-only for content-heavy views like Explore/History; spinner acceptable for short-lived actions like form submission).

### 13.2 Empty states
Every list view needs a defined empty state with a clear next action (e.g. empty generation history → "Create your first image" linking to `/create/image`), not just blank space.

### 13.3 Error states
Every screen that calls an API needs a defined error state distinct from "loading forever." Network/server errors get a retry action. Validation errors render inline at the field level, using the error `code`/`details` from the API's error envelope (`API_SPEC.md` §3.2) — the frontend should map known `code` values to friendly copy, and have a generic fallback message for any code it doesn't specifically handle, so a new backend error code doesn't render as a blank or broken message.

### 13.4 Confirmation for costly actions
Any action that spends credits (`Generate`, `Regenerate`) should show the exact cost before the action fires — this can be inline (price always visible on the button/panel, per Principle 2) rather than requiring a separate confirmation dialog, unless usability testing suggests otherwise. **TBD:** whether a dialog is needed in addition to inline price display, or if inline is sufficient.

### 13.5 Toasts / inline feedback
Non-blocking success feedback (e.g. "Published to Explore") vs. blocking states (a failed payment needing the user's attention) should be visually distinct — exact toast/notification system: **TBD**, a design-system-level decision.

---

## 14. Responsive & Accessibility Requirements

- Every screen in this document must function correctly (not just render without visually breaking) on a representative mobile browser — this is an acceptance criterion in `PRD.md` §25.10, not optional polish.
- Video preview/playback must work within typical mobile browser constraints (no autoplay-with-sound assumptions; respect standard mobile autoplay restrictions).
- Upload flow (§7.4) must work with a phone's camera/gallery picker, not only a desktop file-browser dialog.
- Accessibility target (WCAG level or equivalent): **TBD** (`PRD.md` §19.14) — not decided here; implement with reasonable baseline practice (semantic HTML, alt text on images, keyboard-navigable forms) regardless, since that's good practice independent of a formally chosen target.
- Supported browser/version matrix: **TBD** (`PRD.md` §19.15).

**Responsive acceptance criteria** — each required customer screen must be manually verified at representative widths (small mobile, large mobile, tablet, laptop, desktop) against:
- No clipped primary controls.
- No accidental horizontal scrolling.
- Forms remain usable; media does not distort.
- Navigation remains accessible (not hidden behind an undiscoverable gesture).
- Tables adapt (no fixed-width table forcing horizontal scroll on mobile); modals fit within the viewport.
- Credit cost is visible before any paid action, at every breakpoint (Principle 2 must hold at every screen size, not just desktop).
- Touch controls (buttons, upload picker, toggles) are usable — adequately sized tap targets, not designed mouse-first and shrunk down.

---

## 15. What This UI Explicitly Does Not Include

Consistent with `PRD.md` §6.3 — do not design or build UI for: followers/likes/comments/DMs, a social feed or algorithmic ranking, a marketplace or creator monetization UI, a full image/video editor beyond what each tool's own configuration panel offers, team/workspace switching, subscription/plan-tier selection UI (there is no Plans page — only credit packages), referral/affiliate UI, or a "browse by AI model" selector of any kind (violates Principle 1). Also do not display: fabricated social-proof numbers ("10,000+ creators," "99.9% uptime," or any traction claim without verified real data behind it), a blog, or unverified/unconfirmed mobile-money network logos on the top-up screen (§10) — only networks actually live on the Snippe merchant account. Bonus top-up credits are **TBD** (`PRD.md` §12.1) — do not design a bonus-credit UI element until that's decided. If an earlier mockup referenced in the original project handoff shows any of these, it does not reflect current locked scope.

---

## 15a. UI Testing Requirements

Automated/browser tests should cover, where practical: registration/login flow; dashboard access after auth; insufficient-credit generation attempt correctly blocked/messaged; successful generation submission through to completed result; a failed generation correctly showing credits were returned; upload validation (reject wrong type/oversized file); top-up initiation through pending→confirmed payment display; publish/unpublish toggling; cross-user resource access correctly blocked (404, not a data leak); admin credit adjustment with mandatory reason enforced client-side; and critical navigation at a representative mobile width.

Visual regression / pixel-perfect screenshot testing is optional, **TBD** — and should never be the *primary* correctness mechanism for this UI; functional/flow correctness (the list above) matters far more than pixel exactness for an MVP.

---

## 15b. State Ownership

What's authoritative where — the UI must never treat client-side state as authoritative for anything financial or security-relevant:

| State | Authority |
|---|---|
| Logged-in user / session | Server (JWT validated per request) |
| Wallet balance | Server / database |
| Credit price | Server generation configuration (`GET /generations/configurations`) |
| Payment status | Server, after Snippe webhook verification |
| Generation status | Server / provider-normalized state |
| Content visibility (private/published) | Server / database |
| Temporary form input (unsaved draft text) | Client (React component state) |
| Modal/dropdown open state, active tab | Client (React component state) |

Nothing in the right-hand "Client" rows is ever trusted server-side, and nothing in the "Server" rows is ever computed or assumed client-side beyond what's needed for immediate UI feedback pending the real server response (§7.1's client-side pre-check is UX only, never authoritative — restated from `SECURITY.md` §7).

---

## 16. UI Guardrails (for developers and AI coding agents)

1. Never hard-code credit prices, model names, or aspect-ratio options in frontend code — always fetch from `GET /generations/configurations`.
2. Never allow a generate/top-up action to submit without the current server-computed price/balance having been fetched and displayed first.
3. Never show a raw API error code, stack trace, or provider error string to the user — map every error to friendly copy, with a generic fallback for unmapped codes.
4. Never distinguish "doesn't exist" from "not yours" in any UI copy for a 404 response — treat both identically.
5. Never build UI for anything listed in §15 without an explicit, approved scope change.
6. Never assume a signed asset URL is still valid after any meaningful time has passed — refetch via §9's download endpoint rather than caching a URL indefinitely.
7. Never let the credit-balance indicator in the global header go stale after a top-up or generation — refresh it on every wallet-affecting action, not just on page load.
8. Flag a genuinely new UI-relevant decision as TBD in this document rather than guessing a design-system detail (colors, exact copy, exact spacing) that hasn't been decided.

---

## 17. UI Definition of Done

The MVP UI is complete when: a visitor can browse Explore and view an item without an account; registration, login, and password recovery work with correct inline and server-driven error states; all three tools show live server-driven pricing and correctly disable submission on insufficient balance; a submitted generation is tracked asynchronously with correct loading/completed/failed states and never blocks the UI; a completed generation can be downloaded, published, and unpublished; the wallet screen supports top-up initiation, payment-status polling, and full transaction history; generation and payment history are correctly scoped to the authenticated user with no cross-user data ever visible; the admin panel supports the minimum operations in §12 with mandatory-reason enforcement mirrored client-side; every screen has defined loading/empty/error states; and the full experience — not a reduced version — works on a representative mobile browser.

---

## 18. Open Items — TBD Register (UI-specific)

Consolidated from every section above:
1. Whether pre-signup tool configuration persists through registration (§4).
2. Exact mobile navigation pattern (§3.3).
3. Explore pagination pattern — infinite scroll vs. load-more (§4).
4. Whether a "more tools coming" teaser is shown for deferred Product Ad Creator (§2).
5. Password policy copy, to match `SECURITY.md`'s still-open decision (§5.1).
6. Registration duplicate-email error messaging, to match the still-open account-enumeration-safe error code (§5.1).
7. Whether video generation shows any expected-time hint (§8).
8. Exact user-facing failure messaging for failed generations (§8).
9. Exact `needs_reconciliation` user-facing treatment (§8).
10. Whether `heldCredits` is surfaced directly in the wallet UI or only as a derived "available" figure (§10).
11. Exact Snippe-side payment UI pattern (redirect vs. in-app PIN prompt) (§10).
12. Upload accepted formats/size limit copy, pending `API_SPEC.md`/`SECURITY.md`'s still-open MIME/size decision (§7.4).
13. Whether a confirmation dialog is needed for costly actions beyond inline price display (§13.4).
14. Toast/notification system choice (§13.5).
15. Accessibility target and supported browser matrix (§14).
16. Visual design system (colors, typography, spacing) — entirely out of this document's scope, needed before implementation begins.

---

## 19. Change Log

- **Merged from a separately drafted ChatGPT `UI_SPEC.md`:** Design Tokens (§1a), Content & Copy Guidelines (§12a), additional exclusion-list items (fake social proof, blog, unverified mobile-money logos — §15), a concrete Responsive Acceptance Criteria checklist (§14), UI Testing Requirements (§15a), and a State Ownership reference table (§15b, adapted to React/Next.js client state rather than that draft's Livewire/Alpine terms). That draft's Laravel Blade/Livewire/Alpine.js framework, four-tool MVP scope, and Standard/Premium tiers were **not** adopted — all three conflict with decisions already locked (`ARCHITECTURE.md`'s Next.js/React stack, `PRD.md`'s three-tool MVP and Standard-only launch). Notably, that draft independently arrived at Tailwind CSS for styling, which matches the Tailwind + shadcn/ui decision already made for this project.
