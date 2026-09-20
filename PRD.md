# SanaaAI — Product Requirements Document (PRD.md)

Status: Revised — supersedes the earlier PRD referenced in the project handoff document, updated with decisions locked after that handoff (three-tool MVP, locked launch pricing, TypeScript stack direction). Where this PRD and the handoff document differ, this PRD is authoritative, per the handoff's own instruction to prefer the latest explicit decision.

Role of this document: formal, implementation-ready source of truth for building SanaaAI. Every requirement here is either locked (build it) or marked **TBD** (do not invent it — flag it when implementation reaches that point).

---

## 1. Product Summary

**SanaaAI is a Tanzania-focused, responsive web platform where creators and businesses discover AI-generated content, purchase credits in TZS via mobile money, and use simple workflows to generate images and short videos — without needing to understand the underlying AI models.**

Tagline: *Create. Promote. Grow.*

---

## 2. Problem

Tanzanian content creators and small/medium businesses want to use AI for images and video, but face:
- High international pricing, usually in USD.
- Fragmented AI tools requiring technical prompting/model knowledge.
- International payment friction and dependence on bank cards most users don't have.
- No localized, Tanzania-first AI content experience.

---

## 3. Goals

1. Let a non-technical user produce usable promotional content in minutes.
2. Accept payment in TZS via mobile money — no card required.
3. Keep AI infrastructure (models, providers, parameters) invisible to the user.
4. Validate real willingness to pay before expanding scope.
5. Protect unit economics and payment/wallet integrity from day one.

**Explicitly not a goal for MVP:** building a social network, a marketplace, or a comprehensive multi-provider AI aggregator. See §6.

### 3.1 Success Metrics

Final numeric targets are **TBD** (§19.18), but the system should capture at minimum, from day one, so early data exists once targets are set:
- Registered users; users who complete at least one top-up.
- Total top-up value (TZS); credits purchased vs. credits consumed.
- Generation counts by tool type; successful vs. failed generation rate.
- Average provider cost per generation vs. revenue per generation (feeds §18 unit economics).
- Published Explore creations; repeat purchasers.

---

## 4. Target Users

1. Tanzanian content creators.
2. Small and medium businesses (restaurants, fashion, electronics, real estate, events).
3. Businesses needing product/ad imagery.
4. Users creating content for TikTok/Reels/WhatsApp Status.
5. Anonymous visitors evaluating the product before registering.

---

## 5. Product Principle (non-negotiable)

**Users choose an outcome. The backend chooses the model/provider/configuration.**

The user-facing product exposes: AI Image, Text to Video, Image to Video, duration, aspect ratio, credit cost. It never exposes: Kling, Soul 2, inference parameters, or other provider/model internals. Provider/model routing is an internal implementation detail.

---

## 6. MVP Scope

### 6.1 In scope — creation tools
MVP ships **three** creation tools (revised down from four — see §6.3):

- **AI Image** — general-purpose text-to-image generation.
- **Text to Video** — short video generated from a text description.
- **Image to Video** — user uploads an image, receives a short animated video.

### 6.2 Deferred — not in MVP launch
- **Product Ad Creator** (upload product photo → professional ad image) — deferred to v1.1. Reason: distinct upload-handling and prompt-enhancement UX from AI Image, not required to validate the core payment/generation loop. This is a build-effort deferral, not a margin problem — see §17.

### 6.3 Explicitly excluded from MVP (do not build without explicit approval)
Followers, likes, comments, direct messaging, algorithmic social feed, creator monetization, marketplace, social scheduling, automatic posting, long-form video editor, full Canva-style editor, team workspaces, enterprise features, referral/affiliate systems, user-to-user credit transfers, cash withdrawal, native mobile apps, many AI providers, large model-selection screens, subscription/Free-Pro plans, "Edit/Enhance" of a completed generation.

### 6.4 Platform
Responsive web application only. Must work correctly on mobile browsers, tablets, laptops, and desktops. No native iOS/Android app.

---

## 7. Explore / Discover

**Purpose:** show value before registration, without becoming a social feed.

- Public page, no authentication required.
- Displays examples of AI Images, Text-to-Video, and Image-to-Video creations that users have explicitly published.
- Visitor flow: browse → select an inspiring creation → view details → "Create something like this" → configure generation → authentication/payment required only at the point of generating.
- **User creations are private by default.** A creation never appears in Explore automatically. Publishing requires an explicit user action ("Share to Explore? Public / Keep Private"). Users can unpublish.
- No followers, comments, messaging, creator-as-social-profile, or recommendation algorithm. Likes/comments appeared in early mockups but are **not** an approved requirement.
- Admin must be able to hide/remove any published item (see §14).
- Detailed content moderation workflow: **TBD** (see §19). At minimum, ship a `moderationStatus` field on published assets so this isn't a schema retrofit later.

---

## 8. Authentication

MVP authentication:
- Create account (full name, email, password).
- Login.
- Logout.
- Password recovery.

Not in MVP:
- Social login (appeared in mockups, never locked as a requirement) — **TBD**, do not implement without approval.
- Whether an anonymous visitor's in-progress generation configuration survives through signup — **TBD**.

Security baseline: secure password hashing, rate limiting on auth endpoints, secure password-reset flow, server-side authorization on every protected route. Exact password policy — **TBD**.

---

## 9. Dashboard

Authenticated home workspace. Prioritizes creation, not marketing content. Core elements:
- Credit balance.
- Top Up action.
- The three creation tools.
- Recent creations with status.
- Link to full generation history.
- Account/settings access.

---

## 10. Generation Tools — Functional Requirements

### 10.1 AI Image
- Input: text prompt.
- Output: one or more images (batch size per Higgsfield Soul 2 capability).
- User-facing options: aspect ratio (only ratios the live Soul 2 endpoint actually supports — do not hard-code assumed options).

### 10.2 Text to Video
- Input: text prompt.
- User-facing options: duration (5s or 10s), aspect ratio (1:1, 9:16, 16:9 — only if the live Kling 2.5 Turbo Standard endpoint supports each; do not expose an option the provider doesn't support).
- Underlying model: Kling 2.5 Turbo Standard (locked decision — see §11).

### 10.3 Image to Video
- Input: uploaded image + optional text prompt to guide motion.
- Same duration/aspect-ratio options as §10.2.
- Underlying model: Kling 2.5 Turbo Standard.

### 10.4 Shared requirements across all tools
- Before generating, the user must see: selected configuration (duration/aspect ratio where applicable), exact credit cost, current wallet balance.
- The **backend**, never the browser, computes and enforces the authoritative credit cost.
- Regeneration is a new, separately charged generation — never free.
- "Edit/Enhance" of a completed result is not an MVP feature.

---

## 11. AI Model Strategy (locked)

| Tool | Model | Status |
|---|---|---|
| AI Image | Soul 2 | Locked |
| Text to Video | Kling 2.5 Turbo Standard | Locked |
| Image to Video | Kling 2.5 Turbo Standard | Locked |
| Product Ad Creator | Marketing Studio Image | Locked for when this tool ships (v1.1) |

**Change from original handoff document:** the original handoff described a customer-facing Standard/Premium quality tier for video, with Premium using a higher-cost configuration. **This PRD locks MVP launch to Standard quality only, on Kling 2.5 Turbo, for both video tools.** Kling 3.0 (or another higher-cost model) is held in reserve as a possible **post-launch** Premium tier, added only once real usage data justifies it. Do not build a Premium tier at launch.

Rule carried forward from the original handoff: exact current Higgsfield endpoint IDs, pricing, and parameter mappings must be verified against live provider documentation during implementation — do not hard-code assumptions from this document or the handoff file.

**Architectural rule:** Higgsfield API credentials exist server-side only. The frontend never has direct access to them.

---

## 12. Credit-Based Business Model

- Business model is **visible, pay-as-you-go credits** — not a subscription. There is no Free/Pro plan. Do not implement fake subscription tiers; if earlier UI mockups reference "Plans & Pricing" or "Upgrade to Pro," replace with credit-pricing language in the actual build.
- Working assumption: **1 credit ≈ 100 TZS** of value. This is a configurable business rule, not a hard-coded constant — store it as data, not as a literal in code.
- User-visible wallet shows: current balance, per-generation cost before confirming, top-up options, full transaction history.

### 12.1 Top-up structure (initial working assumption — confirm before launch)
| TZS | Credits |
|---|---|
| 2,000 | 20 |
| 5,000 | 50 |
| 10,000 | 100 |
| 20,000 | 200 |
| 50,000 | 500 |

Bonus credits on top-up: intentionally postponed pending real usage data.

### 12.2 Locked MVP generation pricing
| Item | Credits | TZS equivalent |
|---|---|---|
| AI Image | 2 | 200 |
| Text/Image to Video, 5s | 15 | 1,500 |
| Text/Image to Video, 10s | 30 | 3,000 |

These prices were checked against real (non-promotional) Higgsfield rates at time of writing and yield roughly 64% gross margin on video, ~96% on images, before payment-processing and infrastructure costs. **Re-verify against live Higgsfield pricing before production launch** — do not price the business around a temporary provider discount. Product Ad Creator pricing (deferred tool): **TBD**, targeted 4–5 credits per the original discussion, to be confirmed on ship.

---

## 13. Credit Accounting Rules (non-negotiable)

The system must never implement only `users.balance = X` without a transaction ledger. Required components:
- Wallet (current balance).
- Append-only credit ledger — every balance change traceable to a specific event.
- Top-up transactions.
- Generation holds/debits.
- Refunds/restorations.
- Admin manual adjustments (must require a reason, logged to audit trail).

Each ledger entry must record, at minimum: transaction ID, user ID, type, credit amount and direction, related payment or generation ID where applicable, resulting balance (or an equivalent auditable mechanism), timestamp, a human-readable description/reference, and the actor/source of the change (user action, system process, or admin).

### 13.1 Generation credit lifecycle (locked flow)
1. User configures a generation.
2. Backend calculates the authoritative credit price.
3. Backend verifies sufficient balance.
4. Backend creates the generation record and **places a hold** on the required credits (not a final deduction).
5. Generation is submitted to Higgsfield.
6. Processing happens asynchronously.
7. On success: the hold is **settled** (converted to a final deduction).
8. On eligible technical failure (provider error, timeout): the hold is **released** back to the wallet — the user is not charged.
9. On ambiguous outcomes (e.g. timeout with unknown provider-side status): the generation moves to a reconciliation state rather than being auto-refunded or auto-charged, resolved once real status is confirmed.
10. Voluntary regeneration is always a new, separately charged generation.
11. Refund behavior specifically for **content-policy rejection** (as opposed to technical failure): **TBD** — do not silently decide this is refundable or non-refundable; flag it.

---

## 14. Payment Integration (Snippe)

Desired flow: user selects top-up → chooses amount → provides mobile money details → backend creates a Snippe payment → user authorizes → Snippe processes → Snippe webhook reaches backend → backend verifies webhook → payment marked successful → credits added.

### 14.1 Non-negotiable payment security rules
1. Never credit the wallet because the frontend claims payment succeeded.
2. Wallet credit happens only after verified, server-side payment confirmation (webhook or reconciliation poll).
3. Verify Snippe webhook authenticity per current Snippe documentation.
4. Webhook processing is idempotent — duplicate delivery of the same webhook must never create duplicate credits. Enforce with a database-level unique constraint on the Snippe transaction ID, not an in-memory check.
5. Store Snippe's provider payment/reference ID against the internal payment record.
6. Reconcile every webhook against an internal payment/top-up record before crediting.
7. Snippe API secrets remain server-side only.
8. Mobile money networks displayed to users must reflect what is actually available through the project's live Snippe merchant account — do not hard-code networks that appeared in early concept UI without confirming availability.

---

## 15. Asset Storage

- Completed generation outputs (images/videos) must be copied into application-controlled object storage. Do not rely indefinitely on temporary Higgsfield-hosted URLs.
- Storage provider: **TBD** (Cloudflare R2 and DigitalOcean Spaces both under consideration — see ARCHITECTURE.md for reasoning).
- Retention period for stored assets, especially failed/private generations: **TBD**.

---

## 16. Generation History

Users see their past creations with: thumbnail/preview, tool type, prompt summary, status, date/time, credits consumed, download action, and retry/regenerate where applicable.

Normalized statuses: `pending`, `submitted`, `processing`, `completed`, `failed` (plus an internal `needs_reconciliation` state not necessarily shown verbatim to the user).

**Access control rule:** a user must never be able to view another user's private generation by guessing or altering an ID/URL. Ownership must be enforced server-side on every read.

---

## 17. Admin Requirements

Admin must be able to:
- View users, payments, top-ups, credit ledger entries, generations, and failures.
- Investigate provider references/error details for a failed generation.
- Manually adjust a user's credits, with a mandatory reason recorded to an audit log.
- Manage generation pricing/configuration.
- View and moderate (hide/remove) public Explore content.

Do not build a custom admin analytics platform if existing admin/framework tooling can safely cover MVP needs.

---

## 18. Product Economics

Every enabled generation must have sustainable unit economics — the business is not trying to be "the cheapest," it's trying to be sustainably affordable. Track, per generation: customer credit charge → TZS revenue → provider AI cost → payment processing cost → infrastructure/storage cost → remaining gross margin.

Do not build pricing around temporary provider promotional discounts (see §12.2 caveat). Target gross margin: **TBD** — the ~64% video / ~96% image figures in §12.2 are current-best-estimate, not a confirmed target.

---

## 19. TBD Register

Do not silently invent decisions on any of the following. Flag them when implementation reaches that point:

1. Final Product Ad Creator credit cost (deferred tool).
2. Final Higgsfield endpoint IDs at time of implementation.
3. Exact video Premium-tier configuration, if/when built post-launch.
4. Exact live provider costs at time of implementation (re-verify §12.2 numbers).
5. Refund policy for content-policy rejections specifically.
6. Full Explore moderation workflow (beyond admin hide/remove).
7. Whether anonymous pre-signup generation configuration persists through registration.
8. Social login.
9. Password policy specifics.
10. Object storage provider (R2 vs Spaces vs other).
11. Asset retention period.
12. Upload limits (file size, dimensions, formats).
13. Detailed admin role/permission granularity.
14. Accessibility target (e.g. WCAG level).
15. Supported browser/version matrix.
16. Monitoring/observability provider.
17. Whether a staging environment is required before production.
18. Product success targets / KPIs.
19. Confirmed target gross margin.
20. Legal/privacy policy wording (required due to third-party AI processing of user inputs — see §20).
21. Final top-up bonus-credit structure.
22. Brand/name legal and trademark clearance for "SanaaAI."

---

## 20. Privacy & Security Summary

- Because external AI infrastructure (Higgsfield) processes user prompts/images, the platform must disclose this to users. Exact privacy policy wording: TBD (§19.20).
- Private generations must remain private within SanaaAI regardless of what the provider does with the request on its end.
- Never expose Snippe secrets, Higgsfield keys, storage secrets, or email credentials to the frontend or commit them to source control.
- Upload validation required: MIME type, size limit, ownership check, controlled storage path — exact limits TBD (§19.12).
- Full security requirements belong in `SECURITY.md`; this section states the constraints the architecture must satisfy, not the complete spec.

---

## 21. Responsive Requirements

The same web application must function correctly — not just render without breaking — on mobile browsers, tablets, laptops, and desktops. Desktop-first UI mockups exist as visual direction only; they are not an excuse to ship a non-functional mobile experience.

---

## 22. Logical Data Model (high level — physical schema belongs in DATABASE.md)

Core entities: `User`, `Wallet`, `CreditLedgerEntry` (append-only), `CreditPackage`, `Payment`, `PaymentEvent`, `Generation`, `GenerationConfiguration`, `Asset`, a visibility/publishing concept for Explore, `AdminAuditLog`.

---

## 23. User Journeys

### 23.1 New visitor → first paid generation
Open SanaaAI → Explore → browse creations → pick inspiration → configure a generation → prompted to create account/login → check credit balance → top up via Snippe if needed → payment confirmed via verified webhook → credits added → generate via Higgsfield → processing → completed → preview → download or regenerate → choose to keep private or publish to Explore → appears in generation history.

### 23.2 Returning user
Login → dashboard shows balance and recent creations → select a tool → configure → generate (using existing balance, or top up first if insufficient) → result → history updated.

---

## 24. Business Rules Summary

- Users choose outcomes; the platform chooses AI configuration.
- Credits are the only currency; no subscriptions at MVP.
- Nothing is generated without a confirmed, sufficient credit balance held server-side.
- Nothing is charged to a wallet without a completed (or at minimum submitted-and-later-confirmed) generation or a verified payment.
- Content is private until the user explicitly publishes it.
- Regeneration always costs credits again.
- The browser is never trusted as the source of truth for price, balance, or payment status.
- Disabling a generation tool/configuration prevents new jobs against it but must never destroy or hide historical generation records tied to it.
- A change in Higgsfield's provider cost never automatically changes what the customer is charged — customer pricing changes only via an explicit business/configuration update, never silently propagated from a provider price change.

---

## 25. Acceptance Criteria (MVP)

The MVP is complete when all of the following hold:

1. A visitor can browse Explore and view published creations without an account.
2. A new user can register, log in, recover a forgotten password, and log out.
3. An authenticated user can generate an AI Image, a Text-to-Video, and an Image-to-Video creation, each showing correct pre-generation cost and post-generation credit consumption.
4. A user can top up credits via Snippe, and the wallet is credited only after a verified webhook (or reconciliation) — never from client-side confirmation alone.
5. A failed technical generation restores the held credits automatically; a successful one finalizes the deduction; every balance change is traceable in the ledger.
6. A user can publish a private creation to Explore and later unpublish it.
7. A user cannot view or access another user's private generation via ID manipulation.
8. An admin can view users, payments, generations, and the credit ledger, and can manually adjust credits with a logged reason.
9. An admin can hide/remove a published Explore item.
10. The full experience (Explore, auth, dashboard, all three tools, wallet, history) works correctly on a representative mobile browser, not just desktop.
11. No Higgsfield or Snippe credential is reachable from client-side code at any point.

---

## 26. Definition of Done (per feature)

A feature is done when: it matches this PRD (or an explicitly approved change to it), it degrades gracefully on a slow/mobile connection, all money- or credit-affecting code paths are covered by the rules in §13/§14, and any TBD it touches has either been resolved with an explicit decision or is still correctly flagged rather than silently guessed.

---

## 27. Observability

The MVP must log and monitor, at minimum: authentication failures and rate-limit events, payment initiation errors, webhook verification failures, duplicate payment events, wallet transaction failures, Higgsfield request failures, generation failures, and background-job failures.

**Logs must never contain** passwords, API secrets, mobile-money PINs, or other credentials — this applies to every log line, including error/debug logs written during development. Monitoring vendor: **TBD** (§19).

---

## 28. Environment Requirements

At minimum: local/development and production environments, each with separate Snippe/Higgsfield credentials where the provider supports environment separation — never share live payment or generation credentials between a dev and production environment. Whether a dedicated staging environment is required before production: **TBD** (§19).

---

## 29. Change Log

- **Revised PRD (this document):** MVP trimmed from four tools to three (Product Ad Creator deferred to v1.1); video Premium tier deferred post-launch, MVP video locked to Kling 2.5 Turbo Standard only; launch credit pricing for AI Image and video confirmed against real (non-promotional) Higgsfield rates.
- **Original PRD** (referenced in project handoff, not reproduced here): four-tool MVP with Standard/Premium video tiers from launch.
- **Merged from a separately drafted ChatGPT PRD:** Success Metrics (§3.1), expanded ledger field requirements (§13), two additional business rules on configuration-disabling and provider-price decoupling (§24), Observability (§27), and Environment Requirements (§28). That draft's four-tool/Standard-Premium scope was intentionally not merged — it conflicts with the locked three-tool, Standard-only decision above.
