-- ================================================================
-- Trade International Logistics — Full Database Schema
-- Paste this entire file into the Supabase SQL Editor and run it.
-- Safe to run on a fresh project; uses IF NOT EXISTS / ON CONFLICT.
-- ================================================================

-- ----------------------------------------------------------------
-- 1. Sequence for invoice numbers
-- ----------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1 INCREMENT 1;

-- ----------------------------------------------------------------
-- 2. Tables (dependency order)
-- ----------------------------------------------------------------

-- 2.1 profiles
CREATE TABLE IF NOT EXISTS profiles (
  id          UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   TEXT        NOT NULL,
  role        TEXT        NOT NULL DEFAULT 'Data Entry'
                          CHECK (role IN ('Admin','Manager','Data Entry','Report Viewer','Invoice Agent')),
  email       TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Helper function: get current user's role (must be AFTER profiles table)
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 2.2 company_settings (singleton row; id must = 1)
CREATE TABLE IF NOT EXISTS company_settings (
  id                      INTEGER      PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  company_name            TEXT         NOT NULL DEFAULT 'Trade International Logistics',
  company_address         TEXT         DEFAULT 'Room No. 4, 1st Floor, Khair Mohammad Plaza, Opp. State Bank of Pakistan, 8-A Saddar Road, Peshawar Cantt, Pakistan',
  contact_person          TEXT         DEFAULT 'Haider Ali',
  phone                   TEXT         DEFAULT '03028582323',
  email                   TEXT         DEFAULT 'halitrade0688@gmail.com',
  iata_code               TEXT         DEFAULT '27-3 0688/0005',
  vat_registration        TEXT         DEFAULT '3044153-6',
  bank_1_iban             TEXT         DEFAULT 'PK49SIND0008016416561000',
  bank_1_name             TEXT         DEFAULT 'Sindh Bank',
  bank_1_account_name     TEXT         DEFAULT 'Trade Intl',
  bank_2_iban             TEXT         DEFAULT 'PK80BAHL0471098101649301',
  bank_2_name             TEXT         DEFAULT 'Bank Al Habib',
  bank_2_account_name     TEXT         DEFAULT 'Haider Ali',
  logo_url                TEXT,
  idc_tax_rate            NUMERIC(5,2)  NOT NULL DEFAULT 0.00,
  invoice_overdue_days    INTEGER       NOT NULL DEFAULT 30,
  cass_wht_rate           NUMERIC(5,2)  NOT NULL DEFAULT 12.00,
  default_form_e_rate_min NUMERIC(10,2)          DEFAULT 13.00,
  default_form_e_rate_max NUMERIC(10,2)          DEFAULT 18.00,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 2.3 clients
CREATE TABLE IF NOT EXISTS clients (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT         NOT NULL,
  contact_person    TEXT,
  phone             TEXT,
  city              TEXT,
  address           TEXT,
  credit_terms_days INTEGER      NOT NULL DEFAULT 30,
  notes             TEXT,
  is_active         BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 2.4 airlines
CREATE TABLE IF NOT EXISTS airlines (
  id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name                      TEXT          NOT NULL,
  iata_prefix               TEXT          NOT NULL UNIQUE,
  cass_commission_pct       NUMERIC(5,2)  NOT NULL DEFAULT 5.00,
  other_charges_standard    NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  other_charges_self_upload NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  bta_rate_per_awb          NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  default_cass_rate_notes   TEXT,
  is_active                 BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- 2.5 form_e_suppliers
CREATE TABLE IF NOT EXISTS form_e_suppliers (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT          NOT NULL,
  contact_person   TEXT,
  phone            TEXT,
  default_pkr_rate NUMERIC(10,2) NOT NULL DEFAULT 13.00,
  payment_terms    TEXT,
  notes            TEXT,
  is_active        BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- 2.6 clearing_agents  (is_in_house=TRUE for PEW record)
CREATE TABLE IF NOT EXISTS clearing_agents (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT          NOT NULL,
  city                TEXT          NOT NULL,
  origin_code         TEXT          NOT NULL,
  per_shipment_charge NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  contact             TEXT,
  notes               TEXT,
  is_in_house         BOOLEAN       NOT NULL DEFAULT FALSE,
  is_active           BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- 2.7 shipments  (GENERATED columns for computed totals)
CREATE TABLE IF NOT EXISTS shipments (
  id                 UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  flight_date        DATE           NOT NULL,
  awb_number         TEXT           NOT NULL,
  airline_id         UUID           NOT NULL REFERENCES airlines(id),
  client_id          UUID           NOT NULL REFERENCES clients(id),
  origin             TEXT           NOT NULL,
  destination        TEXT           NOT NULL,
  pieces             INTEGER        NOT NULL DEFAULT 1,
  chargeable_weight  NUMERIC(10,3)  NOT NULL DEFAULT 0.000,
  net_rate           NUMERIC(10,2)  NOT NULL DEFAULT 0.00,
  clearing_charges   NUMERIC(14,2)  NOT NULL DEFAULT 0.00,
  idc_tax            NUMERIC(14,2)  NOT NULL DEFAULT 0.00,
  other_charges      NUMERIC(14,2)  NOT NULL DEFAULT 0.00,
  awb_self_uploaded  BOOLEAN        NOT NULL DEFAULT FALSE,
  form_e_usd_value   NUMERIC(14,2)           DEFAULT 0.00,
  form_e_pkr_rate    NUMERIC(10,2)           DEFAULT 0.00,
  form_e_supplier_id UUID                    REFERENCES form_e_suppliers(id),
  amendment_charges  NUMERIC(14,2)  NOT NULL DEFAULT 0.00,
  cass_airline_rate  NUMERIC(10,2)  NOT NULL DEFAULT 0.00,
  clearing_agent_id  UUID                    REFERENCES clearing_agents(id),
  status             TEXT           NOT NULL DEFAULT 'Planned'
                                   CHECK (status IN ('Planned','Booked','AWB Issued','Departed')),
  notes              TEXT,

  -- Computed totals (GENERATED ALWAYS — never stale)
  freight_amount     NUMERIC(14,2) GENERATED ALWAYS AS (
                       ROUND(chargeable_weight * net_rate, 2)
                     ) STORED,

  form_e_amount_pkr  NUMERIC(14,2) GENERATED ALWAYS AS (
                       ROUND(COALESCE(form_e_usd_value, 0) * COALESCE(form_e_pkr_rate, 0), 2)
                     ) STORED,

  total_receivable   NUMERIC(14,2) GENERATED ALWAYS AS (
                       ROUND(chargeable_weight * net_rate, 2)
                       + clearing_charges
                       + idc_tax
                       + other_charges
                       + ROUND(COALESCE(form_e_usd_value, 0) * COALESCE(form_e_pkr_rate, 0), 2)
                       + amendment_charges
                     ) STORED,

  cass_freight_total NUMERIC(14,2) GENERATED ALWAYS AS (
                       ROUND(chargeable_weight * cass_airline_rate, 2)
                     ) STORED,

  created_by  UUID         REFERENCES profiles(id),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 2.8 invoices  (auto-incrementing 8-digit invoice number)
CREATE TABLE IF NOT EXISTS invoices (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_seq             INTEGER       NOT NULL DEFAULT NEXTVAL('invoice_number_seq'),
  invoice_number          TEXT          NOT NULL GENERATED ALWAYS AS (
                                          LPAD(invoice_seq::TEXT, 8, '0')
                                        ) STORED,
  shipment_id             UUID                    REFERENCES shipments(id),
  client_id               UUID          NOT NULL  REFERENCES clients(id),
  invoice_date            DATE          NOT NULL,
  status                  TEXT          NOT NULL DEFAULT 'Draft'
                                        CHECK (status IN ('Draft','Sent','Partially Paid','Paid')),
  awb_number              TEXT          NOT NULL,
  origin                  TEXT          NOT NULL,
  destination             TEXT          NOT NULL,
  pieces                  INTEGER,
  chargeable_weight       NUMERIC(10,3),
  net_rate                NUMERIC(10,2),
  freight_amount          NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  clearing_charges        NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  form_e_usd_value        NUMERIC(14,2)           DEFAULT 0.00,
  form_e_pkr_rate         NUMERIC(10,2)           DEFAULT 0.00,
  form_e_amount           NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  other_charges           NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  adjustment_ref_invoice_no TEXT,
  adjustment_amount       NUMERIC(14,2)           DEFAULT 0.00,
  total_amount            NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  notes                   TEXT,
  UNIQUE (invoice_seq),
  UNIQUE (invoice_number),
  created_by  UUID         REFERENCES profiles(id),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 2.9 client_opening_balances
CREATE TABLE IF NOT EXISTS client_opening_balances (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID          NOT NULL UNIQUE REFERENCES clients(id),
  balance_date DATE          NOT NULL,
  amount       NUMERIC(14,2) NOT NULL,
  notes        TEXT,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- 2.10 client_payments  (running balance computed on read via window function)
CREATE TABLE IF NOT EXISTS client_payments (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      UUID          NOT NULL REFERENCES clients(id),
  payment_date   DATE          NOT NULL,
  amount         NUMERIC(14,2) NOT NULL,
  payment_method TEXT          NOT NULL
                               CHECK (payment_method IN
                                 ('Bank Transfer','RAAST','Cheque','Cash','Foreign Remittance')),
  bank_account   TEXT,
  transaction_id TEXT,
  description    TEXT,
  notes          TEXT,
  created_by  UUID         REFERENCES profiles(id),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 2.11 cass_periods
CREATE TABLE IF NOT EXISTS cass_periods (
  id           UUID   PRIMARY KEY DEFAULT gen_random_uuid(),
  airline_id   UUID   NOT NULL REFERENCES airlines(id),
  period_start DATE   NOT NULL,
  period_end   DATE   NOT NULL,
  status       TEXT   NOT NULL DEFAULT 'Pending'
                      CHECK (status IN ('Pending','Billed','Paid')),
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (airline_id, period_start, period_end)
);

-- 2.12 cass_payments
CREATE TABLE IF NOT EXISTS cass_payments (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  cass_period_id UUID          NOT NULL REFERENCES cass_periods(id),
  airline_id     UUID          NOT NULL REFERENCES airlines(id),
  payment_date   DATE          NOT NULL,
  amount         NUMERIC(14,2) NOT NULL,
  bank_account   TEXT,
  transaction_id TEXT,
  notes          TEXT,
  created_by  UUID         REFERENCES profiles(id),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 2.13 cass_adjustments
CREATE TABLE IF NOT EXISTS cass_adjustments (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  cass_period_id UUID          NOT NULL REFERENCES cass_periods(id),
  description    TEXT          NOT NULL,
  amount         NUMERIC(14,2) NOT NULL,
  created_by  UUID         REFERENCES profiles(id),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 2.14 form_e_payments
CREATE TABLE IF NOT EXISTS form_e_payments (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id    UUID          NOT NULL REFERENCES form_e_suppliers(id),
  payment_date   DATE          NOT NULL,
  amount         NUMERIC(14,2) NOT NULL,
  period_start   DATE,
  period_end     DATE,
  bank_account   TEXT,
  transaction_id TEXT,
  notes          TEXT,
  created_by  UUID         REFERENCES profiles(id),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 2.15 clearing_agent_payments
CREATE TABLE IF NOT EXISTS clearing_agent_payments (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id       UUID          NOT NULL REFERENCES clearing_agents(id),
  payment_date   DATE          NOT NULL,
  amount         NUMERIC(14,2) NOT NULL,
  period_start   DATE,
  period_end     DATE,
  bank_account   TEXT,
  transaction_id TEXT,
  notes          TEXT,
  created_by  UUID         REFERENCES profiles(id),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 2.16 expenses
CREATE TABLE IF NOT EXISTS expenses (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_date   DATE          NOT NULL,
  category       TEXT          NOT NULL
                               CHECK (category IN (
                                 'Airline Payments (CASS)',
                                 'Form E Supplier Payments',
                                 'Clearing Agent Payments',
                                 'Salaries',
                                 'Rent',
                                 'Utilities',
                                 'Office / Stationery',
                                 'IATA / CASS Fees',
                                 'Bank Charges',
                                 'Miscellaneous'
                               )),
  payee          TEXT,
  amount         NUMERIC(14,2) NOT NULL,
  payment_method TEXT          NOT NULL
                               CHECK (payment_method IN ('Cash','Bank Transfer','Cheque','RAAST')),
  bank_account   TEXT,
  transaction_id TEXT,
  description    TEXT,
  receipt_number TEXT,
  created_by  UUID         REFERENCES profiles(id),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 2.17 manual_income
CREATE TABLE IF NOT EXISTS manual_income (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  income_date    DATE          NOT NULL,
  source         TEXT          NOT NULL,
  description    TEXT,
  amount         NUMERIC(14,2) NOT NULL,
  bank_account   TEXT,
  transaction_id TEXT,
  created_by  UUID         REFERENCES profiles(id),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------
-- 3. Indexes
-- ----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_shipments_flight_date  ON shipments(flight_date);
CREATE INDEX IF NOT EXISTS idx_shipments_client_id    ON shipments(client_id);
CREATE INDEX IF NOT EXISTS idx_shipments_airline_id   ON shipments(airline_id);
CREATE INDEX IF NOT EXISTS idx_shipments_status       ON shipments(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shipments_awb_number ON shipments(awb_number);
CREATE INDEX IF NOT EXISTS idx_shipments_origin       ON shipments(origin);
CREATE INDEX IF NOT EXISTS idx_invoices_client_id     ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_date  ON invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_invoices_status        ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_shipment_id   ON invoices(shipment_id);
CREATE INDEX IF NOT EXISTS idx_client_payments_client   ON client_payments(client_id);
CREATE INDEX IF NOT EXISTS idx_client_payments_date     ON client_payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_form_e_payments_supplier ON form_e_payments(supplier_id);
CREATE INDEX IF NOT EXISTS idx_clearing_pmts_agent      ON clearing_agent_payments(agent_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date            ON expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_expenses_category        ON expenses(category);

-- ----------------------------------------------------------------
-- 4. Auth trigger — auto-create profile row on signup
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'Data Entry')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ----------------------------------------------------------------
-- 5. Row-Level Security
-- Enable on all tables; broad authenticated policy for Phase 2.
-- Role-scoped policies are added in Phase 11.
-- ----------------------------------------------------------------
ALTER TABLE profiles                ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_settings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE airlines                ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_e_suppliers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE clearing_agents         ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipments               ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices                ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_opening_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_payments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE cass_periods            ENABLE ROW LEVEL SECURITY;
ALTER TABLE cass_payments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE cass_adjustments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_e_payments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE clearing_agent_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses                ENABLE ROW LEVEL SECURITY;
ALTER TABLE manual_income           ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_agents            ENABLE ROW LEVEL SECURITY;

-- profiles: users can read/update their own; admins see all
DROP POLICY IF EXISTS "own profile select" ON profiles;
CREATE POLICY "own profile select" ON profiles
  FOR SELECT TO authenticated USING (id = auth.uid());

DROP POLICY IF EXISTS "own profile update" ON profiles;
CREATE POLICY "own profile update" ON profiles
  FOR UPDATE TO authenticated USING (id = auth.uid());

DROP POLICY IF EXISTS "admin profiles" ON profiles;
CREATE POLICY "admin profiles" ON profiles
  FOR ALL TO authenticated
  USING (public.get_my_role() = 'Admin')
  WITH CHECK (public.get_my_role() = 'Admin');

-- All other tables: full access for authenticated users (Phase 2 temp policy)
DO $$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY[
    'company_settings','clients','airlines','form_e_suppliers','clearing_agents',
    'shipments','invoices','client_opening_balances','client_payments',
    'cass_periods','cass_payments','cass_adjustments','form_e_payments',
    'clearing_agent_payments','expenses','manual_income','sales_agents'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS "authenticated_access" ON %I;
       CREATE POLICY "authenticated_access" ON %I
         FOR ALL TO authenticated USING (true) WITH CHECK (true);',
      tbl, tbl
    );
  END LOOP;
END $$;

-- ----------------------------------------------------------------
-- 6. Seed data
-- ----------------------------------------------------------------

-- Singleton company settings row
INSERT INTO company_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ================================================================
-- SETUP INSTRUCTIONS
-- After running this SQL:
-- 1. Go to Supabase Dashboard → Authentication → Users
-- 2. Click "Add user" and create:
--      Father (Admin):  email + password of your choice
--      Haider (Manager): halitrade0688@gmail.com + password
-- 3. Go to Table Editor → profiles
-- 4. Edit Father's profile: set role = 'Admin', full_name = 'Father'
-- 5. Edit Haider's profile: set role = 'Manager', full_name = 'Haider Ali'
-- Sample party & shipment data is seeded in Phase 3.
-- ================================================================

-- ================================================================
-- MIGRATION: USD Rate Fields (run separately in Supabase SQL Editor
-- if the main schema was already applied)
-- ================================================================

-- Airlines: USD commission per kg + AWB airline upload charges
ALTER TABLE airlines
  ADD COLUMN IF NOT EXISTS cass_commission_usd_per_kg NUMERIC(10,4) NOT NULL DEFAULT 0.0000,
  ADD COLUMN IF NOT EXISTS awb_airline_upload_charges NUMERIC(10,4) NOT NULL DEFAULT 0.0000;

-- Shipments: per-shipment USD→PKR exchange rate
-- Default 1.0 so existing PKR-denominated rows stay unchanged
ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS pkr_exchange_rate NUMERIC(10,4) NOT NULL DEFAULT 1.0000;

-- Recreate computed columns to incorporate PKR conversion
-- (Existing rows keep pkr_exchange_rate = 1 → calculations unchanged)
ALTER TABLE shipments DROP COLUMN IF EXISTS freight_amount;
ALTER TABLE shipments ADD COLUMN freight_amount NUMERIC(14,2) GENERATED ALWAYS AS (
  ROUND(chargeable_weight * net_rate, 2)
) STORED;

ALTER TABLE shipments DROP COLUMN IF EXISTS cass_freight_total;
ALTER TABLE shipments ADD COLUMN cass_freight_total NUMERIC(14,2) GENERATED ALWAYS AS (
  ROUND(chargeable_weight * cass_airline_rate * pkr_exchange_rate, 2)
) STORED;

ALTER TABLE shipments DROP COLUMN IF EXISTS total_receivable;
ALTER TABLE shipments ADD COLUMN total_receivable NUMERIC(14,2) GENERATED ALWAYS AS (
  ROUND(chargeable_weight * net_rate, 2)
  + clearing_charges
  + idc_tax
  + other_charges
  + ROUND(COALESCE(form_e_usd_value, 0) * COALESCE(form_e_pkr_rate, 0), 2)
  + amendment_charges
) STORED;

-- ── Sales Agents ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sales_agents (
  id                    UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  name                  TEXT          NOT NULL,
  commission_pkr_per_kg NUMERIC(10,2) NOT NULL DEFAULT 0,
  contact               TEXT,
  notes                 TEXT,
  is_active             BOOLEAN       NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ   DEFAULT now(),
  updated_at            TIMESTAMPTZ   DEFAULT now()
);

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS sales_agent_id UUID REFERENCES sales_agents(id);

CREATE INDEX IF NOT EXISTS idx_shipments_sales_agent_id ON shipments(sales_agent_id);

-- ── Amendment Charges on Invoices ─────────────────────────────────────────────

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS amendment_charges NUMERIC(14,2) NOT NULL DEFAULT 0.00;

-- ── Per-Shipment Sales Agent Commission ──────────────────────────────────────
-- Commission varies per shipment so it's stored on the shipment, not the agent.

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS sales_agent_commission_per_kg NUMERIC(10,2) NOT NULL DEFAULT 0.00;

-- Rebuild total_receivable to include the sales agent commission
ALTER TABLE shipments DROP COLUMN IF EXISTS total_receivable;
ALTER TABLE shipments ADD COLUMN total_receivable NUMERIC(14,2) GENERATED ALWAYS AS (
  ROUND(chargeable_weight * net_rate, 2)
  + clearing_charges
  + idc_tax
  + other_charges
  + ROUND(COALESCE(form_e_usd_value, 0) * COALESCE(form_e_pkr_rate, 0), 2)
  + amendment_charges
  + ROUND(chargeable_weight * sales_agent_commission_per_kg, 2)
) STORED;

-- ── Sales Agent Payments ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sales_agent_payments (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id       UUID          NOT NULL REFERENCES sales_agents(id),
  payment_date   DATE          NOT NULL,
  amount         NUMERIC(14,2) NOT NULL,
  period_start   DATE,
  period_end     DATE,
  bank_account   TEXT,
  transaction_id TEXT,
  notes          TEXT,
  created_by     UUID          REFERENCES profiles(id),
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_agent_pmts_agent ON sales_agent_payments(agent_id);

ALTER TABLE sales_agent_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_access" ON sales_agent_payments;
CREATE POLICY "authenticated_access" ON sales_agent_payments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

