# AGENTS.md

This file is read automatically by AI coding agents (Codex, Claude Code, and similar tools) at the start of a session in this repository. If you are an AI agent working in this repo, read this file first, every session, before writing or editing any code.

---

## What SanaaAI is

A Tanzania-first web platform where users generate AI images and short videos through simple, outcome-focused tools, paying via mobile money in a visible credit wallet. Full product detail: `docs/PRD.md`.

## Where to look before you write code

| Question | Document |
|---|---|
| What is this feature supposed to do? | `docs/PRD.md` |
| What's the system/tech stack and why? | `docs/ARCHITECTURE.md` |
| What TypeScript types, folder structure, and hard coding rules must I follow? | `docs/CONVENTIONS.md` — **read this before writing any code**, not just this file |
| What does the database schema actually look like? | `docs/DATABASE.md` |
| What's the exact API contract (endpoints, request/response shapes, error codes)? | `docs/API_SPEC.md` |
| What are the security rules? | `docs/SECURITY.md` |
| What should this screen/component do and show? | `docs/UI_SPEC.md` |
| What env vars exist and what do they mean? | `.env.example` |
| What order should I build things in, and how should I work in sessions? | `docs/MILESTONES.md` |

(Adjust the `docs/` prefix above to match wherever these files actually live once the repo is scaffolded — they were originally delivered flat and should be organized into a `docs/` folder at `M0`, per `MILESTONES.md`.)

If two of these documents genuinely disagree, **stop and flag it — do not silently pick one.** The precedence order, when a genuine conflict needs a tiebreaker while a human resolves it, is: `PRD.md` → `ARCHITECTURE.md` → `DATABASE.md` → `API_SPEC.md` → `SECURITY.md` → `UI_SPEC.md` → `MILESTONES.md` (execution order only, never overrides the others).

---

## Non-negotiable rules (the ones most likely to cause real damage if violated)

1. **Never write directly to a wallet balance.** Every credit change is an insert into `wallet_transactions`. Full pattern: `CONVENTIONS.md` §3, `DATABASE.md` §6.
2. **Never deduct credits before a generation succeeds.** Hold → settle (success) or release (failure) — never a bare debit.
3. **Never credit a wallet from a client-facing request handler.** Only the verified Snippe webhook or the reconciliation job may do this.
4. **Never trust a client-supplied price, balance, or payment-success claim.** Always recompute/reverify server-side.
5. **Never call Higgsfield or Snippe from the frontend.** Server-side (`apps/api`/`apps/worker`) only, credentials never reachable from `apps/web`.
6. **Never commit a secret, or log one.** No API key, password, or token in source control or in any log line.
7. **Never expose a raw provider error, stack trace, or internal model/provider name to the end user.** Map to friendly copy; SanaaAI's product principle is outcome-first, not model-first (`PRD.md` §5).
8. **Never build UI or endpoints for anything in `PRD.md` §6.3 / `UI_SPEC.md` §15's exclusion lists** (social features, subscriptions, marketplace, etc.) without an explicit, approved scope change.
9. **Never resolve a TBD by guessing.** Every document's TBD register exists so an unresolved decision gets flagged and confirmed, not silently invented. If your work depends on one, stop and ask rather than picking a plausible-looking default.
10. **Never treat client-side state as authoritative for anything financial or security-relevant.** See `UI_SPEC.md` §15b's State Ownership table for exactly what's server-authoritative vs. local UI state.

## Stack, in one line

Next.js + React + TypeScript (frontend, Tailwind CSS + shadcn/ui) / NestJS + TypeScript (API + worker) / PostgreSQL / Redis + BullMQ / S3-compatible object storage. No Python, no microservices, no Kubernetes, no CSS-in-JS. Full reasoning: `ARCHITECTURE.md` §1–2.

## Provider isolation pattern

Both external providers sit behind an application-level interface — never call Higgsfield or Snippe directly from a controller, route handler, or React component:

```
PaymentGateway (interface)  → SnippePaymentGateway (real) / FakePaymentGateway (tests, M4)
AiGenerationProvider (interface) → HiggsfieldGenerationProvider (real) / FakeGenerationProvider (tests, M5a)
```

This is what makes `MILESTONES.md`'s M5a/M5b split (fake provider first, real Higgsfield second) actually clean to implement — the wallet/queue/status logic is written once, against the interface, and never needs to change when the fake implementation is swapped for the real one.

## How to work in this repo, per session

1. Work one milestone (or one clearly-scoped sub-step of one) at a time, per `MILESTONES.md`. Do not attempt to build the whole system in one session or one prompt.
2. Read the specific spec sections relevant to the current task — not the entire document set every time.
3. Inspect existing code before modifying it; follow the patterns already established rather than introducing a new one.
4. Implement the smallest complete piece of the current task.
5. Add or update tests alongside the code, not after.
6. Run the linter/formatter/test suite and fix failures before considering the task done. **Never delete or weaken a test, or loosen a database constraint, to make a failing suite pass** — a red test or a rejected constraint is telling you something; fix the code, not the guard rail.
7. Report back using this shape:
   ```
   Implemented: ...
   Tests: ...
   Files changed: ...
   TBD / blocked: ...
   Next recommended step: ...
   ```
   Do not claim a task is complete if tests are failing.
8. **Stop before expanding scope.** Finishing a task is not an invitation to start the next one in the same turn unless asked. Keep changes scoped to the requested task — do not rewrite unrelated modules or rename broad parts of the project without being asked to.

Full detail on this workflow: `MILESTONES.md`'s "Working With an AI Coding Agent, Per Milestone" section.

## External provider documentation

When work touches Higgsfield or Snippe, verify against **current, official** documentation at the time of implementation — not an old blog post, a guessed request payload, or a possibly-outdated SDK example. If what you find live disagrees with what a spec document assumed, report the difference and get it resolved in the document before changing product behavior around it.

## What a good implementation looks like here

Secure, transactionally safe, idempotent where required, responsive on mobile, simple for the end user, consistent with the specs, easy to test, provider-isolated (§ above), and financially auditable. A feature that looks done in the UI but violates financial integrity, authorization, or provider isolation is not done — optimize for the smallest correct, tested, spec-compliant step, not for the most code written in one session.

## Commands

**TBD** — populate once the repo is scaffolded at `M0`: package manager, install command, dev server command(s) for each app, migration command, test command, lint/format command. An agent should not guess these; if this section is still empty, ask or inspect `package.json`/equivalent directly.

## When you find a real gap

Writing code sometimes surfaces a real gap in the docs (this happened once already — `image_to_video`'s source-image handling wasn't cleanly modeled until `database.md` and `API_SPEC.md` were updated together). When that happens: don't invent a workaround silently. Flag it, propose a resolution, update the relevant document(s) with a change-log entry explaining what changed and why, then implement against the corrected spec.

---

## Change Log

- **Merged from a separately drafted ChatGPT `AGENTS.md`:** the named provider-isolation interface pattern (`PaymentGateway`/`AiGenerationProvider`), a structured completion-report template, the "never delete/weaken a test or constraint to pass" rule, the external-documentation verification rule, and the "what a good implementation looks like" checklist. That draft's Laravel/PHP stack, four-tool scope, and explicit prohibition on JWT/React/Next.js were **not** adopted — all three directly contradict decisions already locked in `ARCHITECTURE.md`, `PRD.md`, and `SECURITY.md`.
