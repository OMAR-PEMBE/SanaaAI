# Incident response

Operational notes for a SanaaAI outage or a suspected credit, payment, or account incident. There is no paging vendor until a host and an alerting destination exist.

## What to look at

- API and worker logs. Security events are JSON lines with `"level":"security"`. They include webhook signature failures, login failures, payment amount mismatches, and rate-limit outages. Request bodies are not logged.
- `GET /health` on the API (port 4000) and the worker (port 4001). A degraded status means Postgres or Redis did not answer.
- Payments stuck in `pending`, and generations stuck in `needs_reconciliation`. The worker reconciles pending payments older than about 3 minutes and marks generations stuck in `submitted` or `processing` for 15 minutes as `needs_reconciliation`. That state keeps the credit hold. It does not refund itself.
- Wallet rows. `balance_credits` is the posted balance. `held_credits` is reserved. Spendable is the difference. Do not edit either column by hand. Add an admin adjustment with a reason, or let settle/release write the ledger.

## First steps

1. Stop new paid generation if the provider or the ledger looks wrong. Set generation configurations inactive. Do not point production at the fake provider.
2. Keep the API and worker running if the goal is to observe. Stop the worker only when a job is making the ledger worse.
3. Preserve logs and a database dump before changing data. See `DOCS/BACKUP_RESTORE.md`.
4. For a bad webhook, confirm `payment_events.signature_verified`. An invalid signature must not have changed a wallet.
5. For a generation that finished at the provider but stayed `needs_reconciliation`, an operator decides the outcome. Do not auto-release that hold.
6. Tell affected users the safe product copy already returned by the API. Do not paste provider errors or model names into a customer message.

## After the incident

Write down the time, the impact, the ledger rows involved, and the change that stopped it. Rotate `JWT_SECRET`, `SNIPPE_WEBHOOK_SECRET`, or provider keys if they may have leaked, and expect existing sessions to fail when the JWT secret changes.
