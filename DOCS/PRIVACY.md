# Privacy

What SanaaAI stores, and what it does not. The public page is `/privacy`. A production privacy contact is still open until the operating company and domain are chosen.

## Account

Name, email, password hash, role, status, and a session version. The password is hashed with bcrypt. The browser keeps the access token in local storage. It expires after 15 minutes. Logout and suspension increment the session version so the old token stops working.

## Wallet and payments

Credit balances and the ledger stay on the account. A top-up stores the package amount, credits, status, and the payment reference. The mobile-money phone number is sent to the payment provider and is not stored. Webhook payloads redact phone fields to the last two digits before they are saved.

## Creations

Prompts, uploads, and finished files belong to the account. The prompt and any uploaded image are sent to a third-party generation service. Customers are not shown that service's name. They are private until the owner shares a finished creation to Explore. Explore does not show the prompt. An admin can hide a shared creation; that sets it to rejected and writes an audit reason. Downloads go through a short-lived signed link on the API. The file store is not public.

## What is not in this product

No social graph, no subscription profile, no marketplace, and no analytics account. Provider names are not shown to customers. Server logs omit request bodies and secrets.
