-- Add amendment_charges column to invoices table
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS amendment_charges NUMERIC(14,2) NOT NULL DEFAULT 0.00;

-- Add pkr_exchange_rate column to invoices table (needed for other_charges USD→PKR conversion)
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS pkr_exchange_rate NUMERIC(10,2) NOT NULL DEFAULT 280.00;

-- Add clearing_agent_id column to invoices table
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS clearing_agent_id UUID REFERENCES clearing_agents(id);
