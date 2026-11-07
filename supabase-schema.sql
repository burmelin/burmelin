-- ============================================================
-- BURMELIN — Database schema and access rules
-- Supabase Dashboard → SQL Editor → New Query
-- ============================================================
--
-- This is the single source of truth for the database. It replaces
-- supabase-setup.sql, supabase-fix.sql, supabase-variants.sql and
-- supabase-lockdown.sql, which were removed: between them they set up,
-- tore down and re-set the same rules, and two of them would have
-- reopened a security hole if re-run.
--
-- Safe to run again at any time. Every statement is idempotent.

-- ── TABLES ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS products (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name        text NOT NULL,
  price       numeric NOT NULL DEFAULT 0,
  description text,
  cat         text,
  img         text,
  stock       integer DEFAULT 0,   -- legacy, no longer read by anything
  active      boolean DEFAULT true,
  code        text,
  colors      jsonb DEFAULT '[]',
  sizes       jsonb DEFAULT '[]',
  variants    jsonb DEFAULT '{}',  -- per colour+size availability, see below
  badge       text DEFAULT '',
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id      text,
  customer_name text DEFAULT '',
  phone         text DEFAULT '',
  address       text DEFAULT '',
  items         jsonb DEFAULT '[]',
  total         numeric DEFAULT 0,
  status        text DEFAULT 'Pending',  -- Pending, Awaiting payment, Payment failed,
                                         -- Processing, Shipped, Delivered, Cancelled
  date          text,
  created_at    timestamptz DEFAULT now()
);

-- Newsletter signups from the home page (written by subscribe.js).
CREATE TABLE IF NOT EXISTS subscribers (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email       text NOT NULL UNIQUE,
  source      text DEFAULT 'website',
  created_at  timestamptz DEFAULT now()
);

-- Columns added after the original tables were created.
ALTER TABLE products ADD COLUMN IF NOT EXISTS variants jsonb DEFAULT '{}'::jsonb;
ALTER TABLE orders   ADD COLUMN IF NOT EXISTS email    text  DEFAULT '';
UPDATE products SET variants = '{}'::jsonb WHERE variants IS NULL;

-- ── THE `variants` COLUMN ───────────────────────────────────
--
--   { "Navy": { "S": false, "L": false }, "Black": { "M": false } }
--
--   * A key that is MISSING means the variant is AVAILABLE.
--   * Only an explicit `false` marks a variant sold out.
--   * Products with no colours use "" as the colour key.
--   * Products with no sizes   use "" as the size key.
--
-- Because missing means available, adding a colour or size later starts it
-- on sale rather than silently hiding it. Written by the admin panel's
-- availability grid; read by the storefront and by create-checkout.

-- ── ACCESS RULES ────────────────────────────────────────────
--
-- Who reaches the database, and how:
--
--   get-products.js    anon key    SELECT active products   → policy below
--   create-checkout.js service key SELECT all products      → bypasses RLS
--   save-order.js      service key INSERT orders (WhatsApp) → bypasses RLS
--   create-checkout.js service key INSERT orders (Stripe)   → bypasses RLS
--   get-session.js     service key SELECT/UPDATE orders     → bypasses RLS
--   stripe-webhook.js  service key SELECT/UPDATE orders     → bypasses RLS
--   subscribe.js       service key INSERT subscribers       → bypasses RLS
--   admin-api.js       service key everything               → bypasses RLS
--
-- The service_role key (sb_secret_…) bypasses RLS entirely, so only the
-- anon path needs a policy. No page ships a database credential any more;
-- the browser talks to Netlify functions, which hold the keys.
--
-- ⚠️  Never disable RLS on these tables. The publishable key is designed to
--     be public — RLS is the only thing protecting customer data in
--     `orders`. Turning it off exposes every order to anyone.

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders   ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscribers ENABLE ROW LEVEL SECURITY;  -- no public policy: service key only

-- Drop any earlier policies, including the two permissive ones from the
-- original setup that granted FOR ALL USING (true).
DROP POLICY IF EXISTS "Public read active products" ON products;
DROP POLICY IF EXISTS "Admin full access products"  ON products;
DROP POLICY IF EXISTS "Public insert orders"        ON orders;
DROP POLICY IF EXISTS "Admin full access orders"    ON orders;

-- The storefront reads active products through get-products.js.
-- Hidden products stay invisible to the public.
CREATE POLICY "Public read active products"
  ON products FOR SELECT
  TO anon
  USING (active = true);

-- `orders` deliberately has NO anon policy. With RLS on and no policy, the
-- public key can do nothing to it at all.

-- ── VERIFY ──────────────────────────────────────────────────
-- Expect: both tables rowsecurity = true
SELECT tablename, rowsecurity
  FROM pg_tables
 WHERE schemaname = 'public' AND tablename IN ('products', 'orders', 'subscribers');

-- Expect: exactly one row — Public read active products, {anon}, SELECT
SELECT tablename, policyname, roles, cmd
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename IN ('products', 'orders', 'subscribers');
