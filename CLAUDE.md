# CLAUDE.md

## What this is
Burmelin's public website at burmelin.com: the shops' online presence, with online ordering and a newsletter.
- Pages: home (`index.html`), products, product, stores, about, privacy, terms, and success (after payment).
- The admin page (`admin.html`) is password-protected. The owner uses it.
- There is no blog. The three "Coming Soon" blog placeholder pages were removed (pull request #9). Don't add blog pages back until the owner approves real articles.
- Burmelin does **not** sell jeans or jackets right now. The Jeans and Jackets filter buttons and search hints on the site lead to empty lists; ask the owner before removing or reusing them.
- Customers pay through Stripe (live mode, real money) and can sign up for the newsletter.
- Stores page: four shops, all Burmelin's own. BURMELIN Asok, Bicasso 1 and Bicasso 2 are at Terminal 21 Asok Mall. Bicasso Nana is at Nana Square. The Bicasso shops keep that name for now.
- The Terminal 21 Rama 3 shop is permanently closed. Don't add it back. (The "Rama 3 Opens" line on the about page is company history, not a shop listing.)
- The owner is not a coder. Explain every change in plain, short words.

## How it works
- Hosted on **Netlify**. Pages are plain HTML files at the top of the repo, with no build step.
- Netlify publishes automatically when `main` changes.
- The repo is **public** on GitHub. Anyone can read every file and every old commit.
- Server code lives in `netlify/functions/`. Most pages call it at `/.netlify/functions/<name>`; `admin.html` uses the shorter `/api/<name>`, which `netlify.toml` redirects to the same place.
- Products, orders and subscribers are stored in **Supabase**. The tables are defined in `supabase-schema.sql`.
- `get-products.js` gives the pages the product list.
- **Stripe** takes payments: `create-checkout.js` starts one and saves the order, and `stripe-webhook.js` marks the order paid (or failed) and sends the emails. `get-session.js` shows the order on the success page.
- `save-order.js` records orders placed through WhatsApp, not Stripe.
- **Resend** sends emails: order emails from `stripe-webhook.js`, and from `subscribe.js` only as a backup (it emails the owner a new signup if the database can't save it).
- `admin.html` calls `admin-api.js`, which checks the admin password.
- `sitemap.js` builds the sitemap for search engines (served at `/sitemap.xml`).

## Rules
- **Never put a password, key or token in the code.** Secrets live only in **Netlify → Environment Variables**: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, RESEND_API_KEY, ADMIN_PASSWORD.
- **Everything in the repo root is public.** Server-only code goes in `netlify/functions/`, never in the root. If a non-web file must sit in the root, block it in `netlify.toml` the same way `supabase-schema.sql` is blocked.
- The Supabase **service** key is for server code only. Never use it in a page. The anon (public) key is the only Supabase key that may ever appear in a page; today no page needs one, because pages go through the functions.
- If a secret is ever found in the code or its history, replace it at the source, then delete the old one. Deleting the line is not enough.
- **Stripe is live.** Never test a checkout with a real card or a real order. Any change to checkout or payments needs the owner's OK first, and a plan for checking it safely. Prefer Stripe test-mode keys on a Netlify deploy preview over testing on the live site. That only works once test keys are set for the "Deploy Previews" context in Netlify; until then, previews use the live keys too.
- This repo has no automated tests. Check each change by opening the page on a phone.

## How to deploy a change
1. Make a branch, change the code, and open a pull request.
2. Open the Netlify preview link from the pull request on a phone.
3. Explain the change to the owner in plain words and wait for a clear "yes" in the chat.
4. Only then merge into `main`. Netlify publishes the site.
5. Check the live site, then say what went live.

## Working with the owner
- Explain every change in plain, short words: what it does and what to tap.
- Show a picture of any changed page when you can.
- Never merge without the owner's clear "yes" in the chat.
