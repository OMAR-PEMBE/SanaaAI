# SanaaAI — SECURITY.md

Status: Implementation-ready draft. Grounded in `PRD.md` §20 (Privacy & Security Summary), `ARCHITECTURE.md` §5 (Security posture), `DATABASE.md` §6 (Data Integrity & Security) and §12 (Guardrails), and `API_SPEC.md` §15 (Security Summary) and §18 (Guardrails) — this document consolidates and resolves the security-specific TBDs those files deferred here, and adds nothing that contradicts a decision already locked elsewhere. Where a decision is still genuinely open, it is marked **TBD**.

---

## 1. Threat Model Summary

What SanaaAI is actually protecting, in priority order:
1. **User wallets and the credit ledger** — the single highest-value target. A bug or exploit here is a direct financial loss, not just a data breach.
2. **Payment flow integrity** — Snippe webhook forgery or replay could fabricate credits without real money moving.
3. **Provider credentials** (Higgsfield, Snippe) — leakage means unbounded third-party billing exposure and reputational/contractual risk.
4. **User account access and private generations** — account takeover or cross-user data leakage.
5. **Public Explore content** — the platform's only unauthenticated public surface; lowest sensitivity but still a spam/abuse and reputational vector.

This document is organized around protecting these, roughly in this order.

### 1.1 Trust Boundaries

Treat as **untrusted** until validated/authorized: browser input, URL/route parameters, JSON request bodies, uploaded files, user prompts, any client-calculated credit cost, any client-reported payment status, a webhook request prior to signature verification, external provider responses and provider-hosted output URLs, client-supplied filenames, and any HTTP header not set by a trusted infrastructure boundary (e.g. a reverse proxy) — including admin-submitted input, which is still subject to server-side validation and authorization, not merely trusted because the caller is an admin.

Treat as **trusted only after verification**: an authenticated session with its role re-checked against the current DB row, an authorized (ownership-checked) database resource, a signature-verified Snippe callback, a signature-verified Higgsfield callback (if Higgsfield uses one — §14.1's open question), server-side-computed generation pricing/configuration, the server-computed wallet balance, and objects already copied into application-controlled storage.

### 1.2 Named Threats This Document Defends Against

Account takeover; credential brute force; session/token theft; XSS; SQL injection; broken object-level authorization (IDOR) — a user substituting another user's ID into a request path; privilege escalation (a demoted/suspended user retaining access via a stale token); malicious file uploads; path traversal via a crafted filename or storage key; duplicate or forged payment callbacks; wallet race conditions; double-spending of credits; duplicate generation refunds; client-side price manipulation; provider credential leakage; unauthorized access to another user's media; sensitive data leaking through logs or error responses; abuse/flooding of generation or payment endpoints; unsafe/unaudited admin actions; unpatched dependency vulnerabilities; and a misconfigured production environment (debug mode left on, secrets left in a public repo, storage left public). Do not add controls for threats outside this list "for completeness" — see §12.

---

## 2. Authentication Security

- **Password storage:** hashed with a modern adaptive algorithm — bcrypt or argon2, cost factor to be tuned per production hardware. Never store or log plaintext passwords. Exact algorithm/cost parameter: **TBD**, but must be one of these two families — no MD5/SHA1/plain SHA256.
- **Password policy:** minimum length and complexity rule — **TBD** (carried from `PRD.md` §19.9, `API_SPEC.md` §20.2). Recommend, pending confirmation: minimum 8 characters, no arbitrary complexity rules that push users toward predictable patterns (per current password-security best practice, complexity rules are less effective than length + breach-list checking).
- **JWT tokens** (per `ARCHITECTURE.md`, `API_SPEC.md` §2.1):
  - Signed with a strong secret/key, stored only in server-side env vars, rotated on a schedule — **TBD** rotation cadence.
  - Short access-token lifetime recommended (e.g. 15–60 minutes) paired with a refresh mechanism, rather than a single long-lived token — exact lifetimes: **TBD**, flagged from `API_SPEC.md` §20.1.
  - Every request to a role-gated route (`/admin/*`) must re-verify the user's **current** role from the database, not trust a role claim embedded in a token issued before a demotion/suspension (`API_SPEC.md` §2.2) — this is a hard rule, not a preference: a stale token must never retain elevated access after an admin action revokes it.
- **Login rate limiting:** per-IP and/or per-account limiting on `POST /auth/login` and `POST /auth/password/forgot` to slow credential-stuffing and enumeration attempts. Exact thresholds: **TBD** (`API_SPEC.md` §5).
- **Account enumeration:** login failures and password-reset requests must return identical responses whether or not the email exists (`API_SPEC.md` §7.2, §7.4) — already locked, restated here as a security-critical rule, not just a UX one.
- **Session/token invalidation on logout and suspension:** exact mechanism TBD (`API_SPEC.md` §7.3, §13.7) — but whatever mechanism is chosen must make a suspended user's existing token stop working within a bounded, short time window, not rely solely on natural token expiry if that lifetime is long.

---

## 3. Secrets & Credential Management

Non-negotiable, restated and consolidated from `CONVENTIONS.md` §3.5–3.6, `PRD.md` §11/§14.1/§20, and `API_SPEC.md` §15:

1. **Higgsfield and Snippe credentials exist only as server-side environment variables**, readable only by the `apps/api` and `apps/worker` processes. Never in `apps/web`, never in a `NEXT_PUBLIC_`-prefixed variable, never committed to source control, never returned in any API response or error message.
2. **No secret is ever logged.** This applies to application logs, error/exception logs, and any third-party log aggregation service — including logs written during local development. A logging middleware or interceptor should redact known secret field names (`password`, `apiKey`, `secret`, `token`, webhook signatures) as a defense-in-depth measure, not rely solely on developer discipline.
3. **`.env` files are never committed.** `.env.example` (already planned per the original project handoff's documentation sequence) lists variable names only, with placeholder/empty values.
4. **Separate credentials per environment** (`API_SPEC.md`/`ARCHITECTURE.md`) — dev, staging (if built — TBD), and production never share a live Higgsfield or Snippe credential. A bug in a dev environment must not be able to spend production AI-generation budget or touch real mobile money.
5. **Secret rotation procedure:** documented but not yet specified — **TBD**. At minimum, rotating a leaked secret must be possible without a full redeploy cycle blocking on code changes (i.e., secrets belong in env/secret-manager config, never hard-coded, which the architecture already ensures).
6. **Secrets manager:** whether a dedicated secrets manager (e.g. the hosting platform's built-in env var storage, or a dedicated service) is used vs. plain platform env vars: **TBD**, follows from the hosting platform decision in `ARCHITECTURE.md` (Railway/Render).

---

## 4. Payment & Webhook Security

Consolidating and elevating `PRD.md` §14.1, `DATABASE.md` §2.5–2.6, and `API_SPEC.md` §10 to explicit security requirements — these are restated here because they are security controls, not just business logic:

1. **Signature verification is mandatory and non-bypassable.** Every request to `POST /webhooks/snippe` must have its signature verified before any database write beyond an unverified `payment_events` audit row. An invalid signature results in `401`, full stop — no fallback processing path.
2. **Webhook idempotency is enforced at the database level** (`payments.snippe_transaction_id` unique constraint), not merely in application logic — this protects against both malicious replay and benign provider retries.
3. **Webhook payloads are logged in full for audit** (`payment_events.raw_payload`) but must be sanitized of any secret material before storage (e.g. if Snippe ever includes a shared secret in the payload itself rather than only in a signature header — verify against live Snippe docs, **TBD**).
4. **The webhook endpoint must not be listed in `robots.txt` disallow-only assumptions or "security through obscurity"** — it must be secure by signature verification alone, since its URL may be discoverable.
5. **Webhook endpoint should have its own rate limit distinct from user-facing endpoints**, generous enough for legitimate Snippe retry behavior but bounded enough to blunt an abuse attempt against the unauthenticated route. Exact threshold: **TBD**.
6. **Never trust client-reported payment success.** Restated from `PRD.md` §14.1 rule 1 as a security rule: a compromised or modified frontend client claiming "payment succeeded" must have zero ability to credit a wallet — the entire trust boundary for money is the verified webhook plus the reconciliation job (`API_SPEC.md` §10.2), nothing else.

---

## 5. Wallet & Credit Integrity (security framing)

Restating `DATABASE.md` §6 as explicit security controls, since a wallet exploit is this system's highest-severity vulnerability class:

1. **Row-level locking is a security control, not just a correctness one.** Without `SELECT ... FOR UPDATE` on the wallet row during any hold/settle/topup operation, a race condition becomes a real exploit path — a user (or a script) firing concurrent generation requests could spend the same credits twice before either transaction commits. This must be load-tested, not just unit-tested, before launch.
2. **`wallet_transactions` must be genuinely append-only at the database permission level**, not just by application convention. Recommend revoking `UPDATE`/`DELETE` grants on this table for the application's runtime database role (`DATABASE.md` §6.3 flagged this as a recommendation; this document upgrades it to a required control) — this limits the blast radius of a SQL-injection or application-logic bug from being able to rewrite ledger history even if it somehow gained query access.
3. **Admin credit adjustments require both a mandatory reason and (recommended) a secondary confirmation step** for large adjustments — exact threshold for "large": **TBD**. At minimum, every admin adjustment is logged to `admin_audit_logs` with the acting admin's identity, per `DATABASE.md` §2.9 (already locked).
4. **Monitor for anomalous credit velocity** — e.g. an account rapidly cycling through top-up → generation → publish at a rate inconsistent with organic use — as a fraud/abuse signal. Exact detection thresholds/automation: **TBD**, flagged as a recommended post-launch hardening item, not a launch blocker.

---

## 6. Data Protection & Privacy

- **Ownership enforcement is the primary access control mechanism** for user data (`API_SPEC.md` §11.5) — every query for a `generations`, `assets`, `uploads`, or `payments` row filters by the authenticated user's ID server-side. This must be enforced at the query/repository layer consistently, not re-implemented ad hoc per controller — recommend a shared repository pattern or query-builder helper that makes "forgot the ownership filter" structurally difficult, not just a code-review checklist item.
- **UUID primary keys** (`DATABASE.md` §1) prevent ID enumeration from trivially discovering the existence of other users' records, but are not a substitute for ownership checks — both controls apply together.
- **Third-party AI processing disclosure:** because Higgsfield processes user prompts/images, this must be disclosed in a privacy policy (`PRD.md` §19.20/§20 — wording TBD) before launch. This is a legal/trust requirement, not a technical one, but the engineering implication is real: **private generations must remain private within SanaaAI's own systems regardless of what Higgsfield does with the request on its end** — SanaaAI has no control over Higgsfield's internal data handling and must not overstate privacy guarantees in its own UI copy beyond what it actually controls.
- **Upload validation** (`API_SPEC.md` §11.6, `PRD.md` §20): MIME type allowlist (not just file extension, which is trivially spoofable), size limit, and re-validation of actual file content server-side (not trusting the client-reported MIME type alone — e.g. confirm an "image" actually decodes as one) before it's ever sent to Higgsfield or stored. Exact allowlist/limits: **TBD**.
- **Storage keys are always server-generated** (random/UUID-based), never derived from a user-supplied filename — this prevents path traversal and avoids leaking any information through the storage path itself. The original filename, if kept at all, is metadata only, never used to construct a filesystem or object-storage path.
- **Object storage is private by default.** User uploads and generated outputs are not publicly readable by a guessable URL — access goes through the application's own authorization check (§6, `API_SPEC.md` §11.7's signed-download pattern), and Explore's public assets are exposed through a deliberate, separate public-delivery mechanism, never by making the entire storage bucket/container public to simplify serving Explore images.
- **Storage credentials are least-privilege**, scoped to only the bucket/prefix and actions (read/write) the application actually needs — not a full-account storage credential.
- **Malware/content scanning** for uploaded files beyond MIME/decode validation: **TBD** — not an invented MVP requirement, but worth revisiting if abuse patterns emerge post-launch.
- **No sensitive data in URLs.** Signed asset download URLs (`API_SPEC.md` §11.7) should be time-limited tokens, not permanent guessable links — lifetime **TBD**.
- **Storage keys are always server-generated (e.g. a UUID-based path), never derived from a user-supplied filename** — a client-controlled filename in a storage path is both a path-traversal risk and a collision/overwrite risk. This applies to both `assets` and `uploads` (`DATABASE.md` §2.8, §2.11).
- **Uploaded and generated files are never stored in a publicly-served directory** and object storage is not made bucket-public purely to simplify serving downloads — delivery goes through the signed-URL mechanism (§11.7) or an authenticated proxy, not a public bucket URL.
- **CSRF protection is conditional on the token-storage decision still open in `API_SPEC.md` §2.1.** If the JWT is stored in an httpOnly cookie, standard CSRF protections (SameSite cookie attribute at minimum, a CSRF token for state-changing requests if `SameSite` alone isn't judged sufficient) are required, since the browser will attach the cookie automatically to cross-site requests. If the token is instead sent via an `Authorization` header from client-side storage, CSRF risk is substantially reduced (a malicious site can't set that header on the victim's behalf) but the storage mechanism then carries its own XSS-exposure trade-off. **This is a real, unresolved design choice, not a formality — resolve it before building auth, not after.**

---

## 7. Input Validation & Injection Prevention

- **Every endpoint validates its input against a defined schema** (`API_SPEC.md` §15 — NestJS `class-validator` or equivalent), rejecting unknown/extra fields rather than silently ignoring them.
- **Parameterized queries / ORM usage only** — no raw string-concatenated SQL anywhere in the codebase. This is the primary defense against SQL injection and is non-negotiable given how directly database access maps to financial state in this system.
- **JSONB fields** (`generations.input`, `payments.snippe_reference`, `payment_events.raw_payload`, `admin_audit_logs.metadata`) must still have their expected shape validated at the application layer before being trusted for any downstream logic — a JSONB column is schema-flexible in the database, not schema-optional in the application.
- **File upload content validation** (§6) doubles as injection/malware prevention — an uploaded "image" that is actually a script or malformed file must be rejected before it reaches storage or Higgsfield.
- **Output encoding:** any user-supplied text (prompts, full names) that is ever rendered back in a web UI context must be properly escaped to prevent stored XSS — applies to Explore descriptions/prompts if ever displayed, and to admin views of user data.

---

## 8. Infrastructure & Transport Security

- **HTTPS/TLS enforced everywhere** — no plaintext HTTP for any production traffic, including the webhook endpoint.
- **CORS restricted to the actual frontend origin(s) in production** (`API_SPEC.md` §15, §20.12 — currently TBD) — must not be left as a wildcard `*` once a production origin is known.
- **Security headers:** standard hardening headers (Content-Security-Policy, X-Content-Type-Options, X-Frame-Options or frame-ancestors CSP, Strict-Transport-Security) should be set on all responses — exact CSP policy depends on final frontend asset hosting, **TBD**.
- **Dependency management:** automated vulnerability scanning (e.g. `npm audit` / Dependabot or equivalent) on the repository, with a policy for how quickly a critical dependency vulnerability must be patched — exact SLA: **TBD**.
- **Database access:** the application's runtime database credential should follow least-privilege (per §5.2's recommendation to restrict `wallet_transactions` write access) rather than using a single superuser/owner role for all application queries.

---

## 9. Monitoring, Logging & Incident Response

Consolidating `PRD.md` §27 (Observability) into concrete security requirements:

- **Security-relevant events that must be logged:** authentication failures, rate-limit triggers, webhook signature failures, duplicate webhook events, wallet transaction failures, admin actions (redundant with `admin_audit_logs` but should also flow to general application logs/monitoring for real-time alerting), and any 5xx from a provider integration.
- **The background worker process (BullMQ, per `ARCHITECTURE.md`) must itself be supervised and its failures observable** — a silently-crashed worker means generations stay stuck in `submitted`/`processing` indefinitely with no user-visible error and no held credits ever released. Failed jobs must be visible (dashboard, logs, or alert), not just silently retried into a dead-letter state nobody looks at.
- **Alerting:** at minimum, repeated webhook signature failures (possible forgery attempt), any wallet-balance constraint violation (a `CHECK (balance_credits >= 0)` failure should never happen in correct operation — if it does, it indicates a real bug or exploit and should page someone, not just log quietly), and a worker process that stops processing jobs should trigger active alerting, not passive log storage. Alerting mechanism/provider: **TBD**.
- **Incident response plan:** a documented procedure for what happens if Higgsfield/Snippe credentials are suspected compromised (rotate immediately, audit recent activity), or if a wallet-integrity bug is discovered in production (freeze the affected operation, preserve `payment_events`/ledger records exactly as they are, reconcile affected payments/generations against verified provider records, and — critically — **fix any discovered discrepancy with a new compensating `wallet_transactions` entry, never by editing or deleting existing ledger rows**, per §5.2's append-only rule) — this plan does not yet exist and should be written before launch, not improvised during an actual incident. Formal legal-notification procedures beyond the technical response: **TBD**, flagged as a pre-launch requirement, not optional hardening.
- **No PII/secrets in error tracking tools** (e.g. Sentry or equivalent, if adopted — provider TBD per `PRD.md` §19.16) — scrub request bodies before they reach any third-party error-tracking service.

---

## 10. Third-Party Provider Risk (Higgsfield, Snippe)

- **Vendor dependency risk:** SanaaAI's entire generation and payment functionality depends on two external providers. Document (not necessarily solve for MVP) what happens on extended provider outage — does the product degrade gracefully (e.g. top-ups still work, generation queues and retries once Higgsfield recovers) or fail hard? **TBD**, but the `needs_reconciliation` generation state and the payment reconciliation job (already locked in `DATABASE.md`/`API_SPEC.md`) are the existing mechanisms for handling this, not a new one.
- **Provider credential scope:** request the minimum API permission scope Higgsfield/Snippe offer, if they support scoped keys, rather than a full-access key, to limit damage from a leaked credential. **TBD**, depends on what each provider actually offers.
- **Provider SLA/support contact:** documented escalation path for a payment or generation outage affecting real users — **TBD**, operational rather than technical, but worth having before launch.

---

## 10a. Provider Output Handling & SSRF Protection

A real gap not previously covered: the worker fetches Higgsfield's generation output from a provider-supplied URL and copies it into SanaaAI's own storage (`PRD.md` §15, `ARCHITECTURE.md` §3.1 step 5). An unguarded fetch of an externally-supplied URL is a server-side request forgery (SSRF) risk — if a response were ever manipulated or a provider compromised, that fetch could be redirected toward internal infrastructure.

Required controls:
1. Only fetch URLs returned directly by the verified Higgsfield API response for the specific generation being processed — never accept or fetch an arbitrary URL supplied by a user or any other untrusted source.
2. Require HTTPS for the fetch.
3. Block redirects to localhost, link-local addresses, private network ranges, and cloud metadata endpoints (e.g. `169.254.169.254`) if the HTTP client follows redirects at all — prefer disabling redirect-following for this fetch entirely unless Higgsfield's integration requires it.
4. Apply a download timeout and a maximum size limit before writing to storage.
5. Validate the fetched content's actual type (e.g. confirm it decodes as the expected image/video format) before treating it as a trusted asset — the same content-validation principle as user uploads (§6), applied to provider output.
6. If Higgsfield's SDK/client offers a safe direct-download mechanism rather than a raw URL fetch, prefer it over hand-rolled HTTP fetching.

---

## 11. Admin Security

- **Admin role assignment (bootstrap):** how the very first admin account is created in production without a committed default password (`DATABASE.md` §7.2, `API_SPEC.md`'s equivalent gap) — **TBD**, must not be a hard-coded seed credential in a production migration.
- **Admin actions are fully audited** (`admin_audit_logs`, already locked) — this document adds: admin panel access itself (not just mutating actions) should ideally be logged or at minimum rate-limited/monitored, since it's a high-value target distinct from the regular user-facing surface.
- **Consider a stricter session policy for admin accounts** (shorter token lifetime, mandatory re-authentication for sensitive actions like large credit adjustments) — **TBD**, recommended hardening, not yet locked as a requirement.

---

## 12. Explicitly Out of Scope for MVP Security

Consistent with the product scope exclusions elsewhere — do not over-build security infrastructure for features that don't exist:

**12.1 No feature, no security burden**
- No OAuth/social login to secure (PRD §19.8 — build this only if/when that feature ships).
- No public developer API/API keys to secure (`API_SPEC.md` §16 — excluded).
- No multi-tenant/team workspace permission model (excluded from MVP scope).

**12.2 Not justified by current scale or threat model — do not add for the appearance of sophistication**
Kubernetes or a service mesh; a custom identity provider; custom encryption or cryptography (use established libraries/algorithms only); a blockchain-based credit ledger (the append-only Postgres ledger already satisfies the auditability need — `PRD.md`/`DATABASE.md`); a separate "security microservice"; an enterprise SIEM; a mandatory WAF or CDN unless real observed abuse or the final hosting choice specifically justifies one; a complex RBAC system beyond the two roles (`user`, `admin`) that actually exist; CAPTCHA without an observed or specifically anticipated abuse pattern; and client-side provider API keys of any kind (already prohibited elsewhere in this document, restated here as a "don't reach for this" item, not just a "don't do this" one).

**Note:** an earlier draft of a document like this also listed "no JWT for first-party sessions" here — that does not apply to SanaaAI, since `ARCHITECTURE.md` and `API_SPEC.md` already lock JWT as the actual authentication mechanism. Excluded here deliberately, not by oversight.

This section exists so a future security review doesn't flag "missing" controls for things that were never supposed to exist at this stage.

---

## 13. Security Guardrails (for developers and AI coding agents)

1. Never hard-code a secret, API key, or credential anywhere in source code — env vars only, server-side only.
2. Never log a password, token, API key, or full payment/webhook payload without redaction.
3. Never trust a client-supplied price, balance, payment-status, or role claim — always re-derive server-side.
4. Never write raw SQL string concatenation — parameterized queries/ORM only.
5. Never skip the ownership filter on a query for user-owned data, even for an admin-adjacent internal tool — admin access goes through `/admin/*` routes with their own explicit authorization check, not through bypassing the normal ownership filter.
6. Never process a webhook before verifying its signature.
7. Never allow a `wallet_transactions` row to be updated or deleted.
8. Never assume a file's MIME type from its extension or client-reported header alone.
9. Never derive a storage key/path from a user-supplied filename — always server-generated.
10. Never leave the background job worker unsupervised — a failed/crashed worker must be visible, not silent.
11. Flag a genuinely new security-relevant decision as TBD in this document rather than resolving it silently in code.

---

## 14. Security Definition of Done (MVP launch gate)

Treat this as a pre-launch checklist, not a nice-to-have:
- [ ] Password hashing algorithm and policy finalized and implemented (§2).
- [ ] JWT lifetime/refresh/invalidation mechanism finalized and implemented (§2).
- [ ] All secrets confirmed absent from source control (repo history included) and from logs (§3).
- [ ] Separate Higgsfield/Snippe credentials confirmed for dev vs. production (§3).
- [ ] Snippe webhook signature verification implemented and tested against both valid and forged payloads (§4).
- [ ] Token-storage mechanism decided (httpOnly cookie vs. header) and matching CSRF posture implemented accordingly (§6).
- [ ] Wallet concurrency (row-locking) load-tested under concurrent requests, not just unit-tested (§5).
- [ ] `wallet_transactions` table confirmed append-only at the database permission level (§5).
- [ ] Upload validation (MIME allowlist + size limit + content re-validation) implemented, with server-generated storage keys (§6).
- [ ] Object storage confirmed not publicly bucket-accessible; downloads go through signed URLs (§6).
- [ ] Background worker process supervised, with failed jobs visible/alertable (§9).
- [ ] CORS restricted to real production origin(s) (§8).
- [ ] Security headers configured (§8).
- [ ] Dependency vulnerability scanning enabled on the repository (§8).
- [ ] Security-relevant event logging and at least basic alerting in place (§9).
- [ ] Incident response plan for credential compromise and wallet-integrity bugs documented (§9).
- [ ] Admin bootstrap procedure that avoids a hard-coded production credential (§11).
- [ ] Privacy policy disclosing third-party AI processing published (§6 — coordinate with legal/product, not purely engineering).
- [ ] No item in §15's TBD register remains unresolved without an explicit, documented decision.

---

## 15. Open Items — TBD Register (Security-specific)

Consolidated from every section above, so nothing is silently decided during implementation:
1. Password hashing algorithm/cost factor and password policy (§2).
2. JWT lifetime, refresh strategy, rotation cadence (§2, §3).
3. Login/password-reset rate-limit thresholds (§2).
4. Session/token invalidation mechanism on logout and suspension (§2).
5. Secrets manager choice, tied to hosting platform decision (§3).
6. Sanitization confirmation for Snippe webhook payload storage (§4).
7. Webhook endpoint rate-limit threshold (§4).
8. Large-admin-adjustment secondary confirmation threshold (§5).
9. Credit-velocity fraud/abuse detection thresholds (§5) — post-launch hardening, not a launch blocker.
10. Upload MIME allowlist and size limits (§6) — already tracked in `API_SPEC.md`/`DATABASE.md`, restated here as a security item.
11. Signed asset URL lifetime (§6) — already tracked in `API_SPEC.md`, restated here.
12. Content-Security-Policy specifics, dependent on final frontend hosting (§8).
13. Dependency vulnerability patch SLA (§8).
14. Alerting provider/mechanism (§9).
15. Incident response plan — must be written, not just referenced, before launch (§9).
16. Error-tracking tool choice and PII scrubbing configuration (§9).
17. Provider outage graceful-degradation behavior beyond existing reconciliation mechanisms (§10).
18. Higgsfield/Snippe scoped-credential availability (§10).
19. Provider SLA/escalation contacts (§10).
20. Admin bootstrap method for production (§11).
21. Stricter admin session policy specifics (§11).

---

## 16. Change Log

- **Merged from a separately drafted ChatGPT `SECURITY.md`:** SSRF protection for fetching Higgsfield output (§10a — a genuine gap, not previously covered), concrete storage/upload hardening (server-generated storage keys, private-by-default object storage, least-privilege storage credentials, file-content decode validation), and an "Explicitly Out of Scope" list (§12.2) against over-building security infrastructure (no Kubernetes, custom crypto, blockchain ledger, enterprise SIEM, or CAPTCHA without observed need). That draft's Laravel session/CSRF authentication model was **not** adopted — it directly conflicted with the JWT-based auth already locked in `ARCHITECTURE.md` and `API_SPEC.md`, including that draft explicitly listing "JWT for first-party sessions" as unnecessary, which this document does not agree with (see §12.2's note). The still-open token-storage question (httpOnly cookie vs. header) this conflict surfaced is tracked honestly in §6 and the TBD register above, not resolved by default.
