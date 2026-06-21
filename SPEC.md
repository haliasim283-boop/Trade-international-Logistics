# SPEC — Trade International Logistics: Accounting & Operations Software

> **What this file is:** the complete **functional specification** (the WHAT) for the application.
> The build stack, hard rules, and phased working method (the HOW) are defined separately in the
> Claude Code kickoff prompt. Where this spec and the kickoff prompt overlap (stack, money handling,
> roles), they agree — follow both.

---

## WHAT YOU ARE BUILDING

A **complete, production-quality logistics accounting and operations management web application** for
**Trade International Logistics / Trade International Clearing Agency**, an IATA-registered air cargo
freight forwarder based in Peshawar, Pakistan.

It is a **full-featured React application** (React + Vite + Tailwind CSS) with all data persisted in
**Supabase (PostgreSQL)**. The app must be fully functional end-to-end — no placeholder screens, no
"coming soon" sections. Every module must work.

---

## COMPANY PROFILE

| Field | Value |
|-------|-------|
| Company Name | Trade International Logistics / Trade International Clearing Agency |
| Address | Room No. 4, 1st Floor, Khair Mohammad Plaza, Opp. State Bank of Pakistan, 8-A Saddar Road, Peshawar Cantt, Pakistan |
| IATA Numeric Code | 27-3 0688/0005 |
| VAT Registration | 3044153-6 |
| Contact Person | Haider Ali |
| Phone | 03028582323 |
| Email | halitrade0688@gmail.com |
| Sindh Bank IBAN | PK49SIND0008016416561000 |
| Bank Al Habib IBAN | PK80BAHL0471098101649301 |
| Other Banks Used | HMB, HBL, BOK, Askari, Meezan, Soneri |

---

## BUSINESS OVERVIEW

The company is an IATA-registered air cargo freight forwarder. They:
- Book and process export air cargo shipments for exporter clients
- Handle customs clearing **in-house for Peshawar (PEW)** sector
- **Outsource clearing** to agents in other cities (ISB, MUX, LHE, etc.)
- Provide **Form E** documents to exporters for foreign exchange declaration (sourced from supplier partners), charging clients per USD value at a PKR rate
- Settle airline payments fortnightly via **IATA CASS** (Cargo Accounts Settlement System)
- Issue invoices to clients, maintain party ledgers, generate fortnightly airline sales reports, Form E supplier payable reports, and clearing agent payable reports

### Core Billing Cycle
- CASS runs **fortnightly**: Period 1 = 1st–15th of month, Period 2 = 16th–end of month
- One fortnight is the **billing/accounting period**
- The **following fortnight** is available for payment preparation
- Payment is made to CASS at end of the second fortnight

---

## APPLICATION STRUCTURE

A sidebar-navigated single-page application with these 13 modules:

```
Sidebar Navigation:
├── 📊 Dashboard
├── ✈️  Master Shipment Log
├── 👥 Party Management
├── 🧾 Invoices
├── 📋 Party Ledgers / Statements
├── 📑 Airline Sales Reports (CASS)
├── 📝 Form E Reports & Payables
├── 🚚 Clearing Agent Reports & Payables
├── 💸 Expenses
├── 💰 Income
├── 📈 Profit & Loss
├── ⚙️  Settings / Configuration
└── 👤 User Management
```

---

## MODULE 1: MASTER SHIPMENT LOG (Operations Core)

This is the **central operational record** updated daily as shipments are planned, booked, AWB numbers
assigned, and shipments depart. All other financial modules pull data from this log.

### Shipment Record Fields

| Field | Type | Notes |
|-------|------|-------|
| Date | Date | Flight/booking date |
| AWB Number | Text | Format: XXX-XXXX-XXXX (e.g., 176-1421-4841). Airline prefix is first 3 digits |
| Airline | Dropdown | From Party Management — airlines list |
| Client / Party | Dropdown | From Party Management — clients list |
| Origin (ORG) | Text | 3-letter IATA airport/city code (PEW, ISB, MUX, KHI, LHE, etc.) |
| Destination (DST) | Text | 3-letter IATA code (DXB, SHJ, DOH, BAH, MCT, JFK, etc.) |
| Pieces (PCS) | Number | Number of packages |
| Chargeable Weight (KGS) | Decimal | Chargeable weight in kilograms |
| Net Rate (PKR/kg) | Decimal | Rate charged to client per kg |
| Clearing Charges (PKR) | Decimal | Fixed per-shipment charge. For PEW origin: in-house rate. For other origins: outsourced agent's rate |
| ISC Tax (PKR) | Decimal | Only applies when ORG = PEW (in-house clearing). Calculated as % of clearing charges |
| Other Charges (PKR) | Decimal | Airline surcharges + AWB fee passed to client. Reduced amount if AWB was self-uploaded on airline's website |
| AWB Self-Uploaded | Checkbox | If checked, apply reduced Other Charges rate |
| Form E — USD Value | Decimal | Declared USD value on the Form E document |
| Form E — PKR Rate | Decimal | Rate used to convert USD to PKR (typically 13–18 PKR per USD, set per transaction) |
| Amendment Charges (PKR) | Decimal | Applied if shipment details are amended after initial booking |
| CASS Airline Rate (PKR/kg) | Decimal | The actual rate paid to airline via CASS (may differ from client Net Rate) |
| Clearing Agent | Dropdown | Which clearing agent handled this (auto-populated based on ORG city — PEW = in-house, others = outsourced agents) |
| Status | Dropdown | Planned → Booked → AWB Issued → Departed |
| Invoice No. | Auto/Link | Links to generated invoice |
| Notes | Text | Any additional remarks |

### Calculated Fields (auto, read-only)

| Field | Formula |
|-------|---------|
| Freight Amount | Chargeable Weight × Net Rate |
| Form E Amount (PKR) | Form E USD Value × Form E PKR Rate |
| Total Receivable (PKR) | Freight + Clearing Charges + ISC Tax + Other Charges + Form E Amount + Amendment Charges |
| CASS Freight Total | Chargeable Weight × CASS Airline Rate |

### Features
- Add / Edit / Delete shipments
- Filter by: Date range, Airline, Client, Origin, Destination, Status, Fortnight period
- Bulk status update (e.g., select multiple → mark as Departed)
- Search by AWB number or client name
- Color-coded rows by status (Planned=grey, Booked=yellow, AWB Issued=blue, Departed=green)
- Export filtered view to Excel (CSV)
- Summary totals at bottom of filtered view: total weight, total receivable, shipment count
- Data from this log **auto-feeds**: Party Ledgers, Airline Sales Reports, Clearing Agent Reports, Form E Reports

---

## MODULE 2: PARTY MANAGEMENT

Manage all entities the company deals with. Four sub-sections:

### 2A — Clients (Exporters)
Fields: Client Name, Contact Person, Phone, City, Address, Credit Terms (days), Notes
Actions: Add / Edit / Delete / View Ledger (links to Module 4)

### 2B — Airlines
Fields: Airline Name, IATA Prefix (3-digit numeric, e.g., 214 for PIA, 176 for Emirates, 157 for Qatar), CASS Commission % (e.g., 5%), Other Charges Rate per AWB (standard), Other Charges Rate per AWB (if self-uploaded), BTA Rate (PKR per AWB for additional IATA charges), Default CASS Rate Notes
Actions: Add / Edit / Delete / View Sales Report (links to Module 5)

### 2C — Form E Suppliers
Fields: Supplier Name, Contact Person, Phone, Default PKR Rate per USD (e.g., 13.00–18.00), Payment Terms, Notes
Actions: Add / Edit / Delete / View Payables Report (links to Module 6)

### 2D — Clearing Agents (Other Cities)
Fields: Agent Name, City, Origin Code (e.g., ISB, MUX, LHE), Per-Shipment Fixed Charge (PKR), Contact, Notes
Actions: Add / Edit / Delete / View Payables Report (links to Module 7)

---

## MODULE 3: INVOICES

Generate, view, print, and track invoices to clients.

### Invoice Format (must match exactly)

**Header Section (dark navy background):**
- Left: "TRADE INTERNATIONAL CLEARING AGENCY" (large bold white text) + address below in smaller white text
- Right: "INVOICE NO. [XXXXXXXX]" (auto-incremented, 8-digit padded)
- Below header: "BILL FOR [AWB Number]" (large, prominent)
- Date: full date (e.g., Thursday, 11 June 2026)

**Bill To / For Section:**
- Left — BILL TO: Client name, city
- Right — For: Origin (full city name + code) TO Destination (full city name + code) + country

**Line Items Table:**

| Item Description | Weight | Rate | Amount |
|-----------------|--------|------|--------|
| FREIGHT | KGS [weight] | PKR [rate] | PKR [amount] |
| CUSTOMS CLEARANCE CHARGES | | | PKR [amount] |
| FORM E PAYMENT | $[USD value] | PKR [rate] | PKR [amount] |
| AIRLINE OTHER CHARGES + AWB FEE | | | PKR [amount] |
| ADJUSTMENT BALANCE INV NO [ref_no] | | | PKR [adj_amount] *(only if there is an adjustment)* |
| **BALANCE** | | | **PKR [total]** |

The BALANCE row must have a dark navy background with white bold text for the label, and bold amount.

**Footer:**
- "Make all checks payable to Company Name"
- Bank 1: PK49SIND0008016416561000 | SINDH BANK | TRADE INTL
- Bank 2: PK80BAHL0471098101649301 | BANK AL HABIB | HAIDER ALI
- "If you have any questions concerning this invoice, use the following contact information:"
- HAIDER ALI, 03028582323, halitrade0688@gmail.com
- "Thank you for your business!"

### Invoice Features
- Auto-generate from any shipment in Master Log (pre-fills all fields)
- Manual override of any field before saving
- Adjustment line: link to previous invoice number + amount (positive or negative)
- Invoice status: Draft → Sent → Partially Paid → Paid
- Print to PDF (browser print dialog — layout must be clean on A4)
- Duplicate invoice
- View all invoices with filter: client, date range, status, airline
- Overdue highlighting (invoice date + 30 days by default, configurable)

---

## MODULE 4: PARTY LEDGERS / ACCOUNT STATEMENTS

Per-client running ledger. This is the **financial statement** shared with clients.

### Statement Header
- Company name + address (top)
- "AC STATEMENT FOR [CLIENT NAME] / [CONTACT PERSON], [CITY], PAKISTAN"
- Summary bar (top right): **Total Receivable | Total Received | Balance**

### Statement Table Columns
`DATE | AWB NO. | ORG | DST | PCS | WGHT | NET RATE | CLEARING CHRGS | OTHER CHRGS | FORM E | RECEIVABLE | RECEIVED | BALANCE`

### Two Row Types

**Shipment Row (white/light background):**
All shipment columns filled, RECEIVABLE shows total amount for that shipment, RECEIVED is blank, BALANCE = previous balance + RECEIVABLE.

**Payment Row (blue/highlighted background):**
DATE filled, columns AWB–FORM E blank, a description text spanning across (e.g., "AMOUNT RECEIVED MEEZAN BANK TO TRADE SINDH BANK ACC TRX ID 115354"), RECEIVABLE blank, RECEIVED = payment amount, BALANCE = previous balance − RECEIVED.

### Features
- Auto-populated from Master Shipment Log (shipment rows) and payment records
- Add payment directly from ledger view (modal: date, amount, bank, TRX ID, method: Bank Transfer / RAAST / Cheque / Cash / Foreign Remittance)
- Filter by date range
- Running balance always current
- Outstanding balance highlighted in red if > 0
- Overdue flag if balance unpaid beyond configured days
- Print/PDF the statement in the exact table format shown
- Export to Excel

---

## MODULE 5: AIRLINE SALES REPORTS (CASS)

Fortnightly reports per airline, matching the CASS billing structure.

### Fortnight Periods
System automatically identifies fortnights. User selects: Airline + Billing Period (dropdown of all fortnights).

### Per-AWB Section

Columns matching CASS format:
`SERIAL NO. | AWB NO. | ORG | DST | WEIGHT | PREPAID WEIGHT CHARGES | COMMISSION | OTHER CHARGES DUE AGENT | OTHER CHARGES DUE AIRLINE | INCENTIVE | TAX WITHHELD | SPIN | NET AMOUNT`

Calculations per AWB:
- **Prepaid Weight Charges** = Weight × CASS Airline Rate
- **Commission** = Prepaid Weight Charges × Commission % (from Airline configuration)
- **Other Charges Due Agent** = fuel surcharges/handling fees due back to agent (entered per AWB or pulled from Other Charges field)
- **Tax Withheld** = 12% of (Net Amount Before Tax) — WHT
- **SPIN** = sequential shipment index
- **Net Amount** = Prepaid Weight Charges − Commission − Other Charges Due Agent + Tax Withheld (net payable to airline per AWB)

### Recapitulation Section
- Total Commissionable Sales (sum of all Prepaid Weight Charges)
- Total Commission Due Agent
- Total Other Charges Due Agent
- Tax Withheld Due Airline (12%)
- **BTA / Additional Adjustments** = BTA Rate per AWB × Number of AWBs (configured per airline — e.g., PKR 1,800 per AWB for IATA insurance)
- **Net Due Export** = Total Sales − Commission − Other Charges Due Agent + Tax Withheld
- **Net Due DIP** = BTA total
- **Grand Total Payable** = Net Due Export + Net Due DIP

### Payment Tracking
- Mark period as: Pending → Billed → Paid
- Record payment: date, bank, amount, reference

### Features
- Auto-populated from Master Shipment Log filtered by airline prefix + date range
- Manually add adjustments or corrections
- Print/PDF in CASS report format
- View payment history per airline
- Compare two periods side-by-side

---

## MODULE 6: FORM E SUPPLIER REPORTS & PAYABLES

For each Form E supplier, show what is owed for a given period.

### Report Table
`DATE | AWB NO. | CLIENT | USD VALUE | PKR RATE | FORM E AMOUNT (PKR)`

### Summary
- Total USD Value
- Total PKR Payable
- Amount Paid
- Balance Due

### Features
- Auto-populated from Master Shipment Log (Form E fields) filtered by period
- Record payments made to supplier
- Filter by supplier, date range
- Print/export

---

## MODULE 7: CLEARING AGENT REPORTS & PAYABLES

For each outsourced clearing agent (per city), show what is owed.

### Report Table
`DATE | AWB NO. | CLIENT | ORIGIN | PIECES | WEIGHT | CLEARING CHARGE (PKR)`

### Summary
- Total Shipments
- Total Clearing Charges Payable
- Amount Paid
- Balance Due

### Features
- Auto-populated from Master Shipment Log (where ORG city matches agent's city, excluding PEW in-house)
- Record payments made to agent
- Filter by agent, date range
- Print/export

---

## MODULE 8: EXPENSES

Track all outgoing payments and costs.

### Expense Categories
- Airline Payments (CASS)
- Form E Supplier Payments
- Clearing Agent Payments
- Salaries
- Rent
- Utilities
- Office / Stationery
- IATA / CASS Fees
- Bank Charges
- Miscellaneous

### Expense Record Fields
`Date | Category | Payee | Amount (PKR) | Payment Method (Cash / Bank Transfer / Cheque / RAAST) | Bank Account (which bank) | TRX ID / Cheque No. | Description | Receipt No.`

### Features
- Add / Edit / Delete expenses
- Filter by category, date range, payee, bank
- Monthly summary by category
- Cash vs. bank breakdown
- Export to Excel

---

## MODULE 9: INCOME

Track all incoming payments.

### Income Sources (auto-populated)
- Client Invoice Payments (from Party Ledger payment records)
- Commission Earned from Airlines (from CASS reports)
- Other Charges Recovered

### Manual Income Entry (for non-invoice income)
`Date | Source | Description | Amount (PKR) | Bank / Cash | TRX ID`

### Features
- Combined view: auto + manual income
- Filter by source, date range, bank
- Monthly totals

---

## MODULE 10: PROFIT & LOSS REPORT

Selectable time period: Fortnightly, Monthly, Custom Range.

### P&L Structure

**INCOME**
- Total Client Receipts
- Commission Earned (from Airlines)
- Other Income
- **Total Income**

**EXPENSES**
- CASS Payments (breakdown by airline)
- Form E Supplier Payments
- Clearing Agent Payments
- Salaries
- Rent
- Utilities
- Other Office Expenses
- **Total Expenses**

**NET PROFIT / (LOSS)**
- Gross Profit (Total Income − Direct Costs: CASS + Form E + Clearing)
- Operating Profit (Gross Profit − Operating Expenses)

### Features
- Period comparison: current vs. previous period
- Printable P&L report
- Export to Excel

---

## MODULE 11: DASHBOARD

The home screen. Shows:

**Top KPI Cards (row of 4):**
1. Total Outstanding Receivables (all clients combined)
2. Total Payable to Airlines (current fortnight CASS)
3. Total Payable to Form E Suppliers (current period)
4. Total Payable to Clearing Agents (current period)

**Middle Section:**
- Active Shipments breakdown by status (Planned / Booked / AWB Issued / Departed) — shown as count tiles
- Current month net P&L (simple Income vs. Expense bar or number)

**Bottom Section:**
- Recent 10 shipments (from Master Log)
- Overdue client balances (clients with balance > 0 and days > threshold)
- Upcoming CASS payment (days until next CASS due date + amount)
- Quick action buttons: + New Shipment | + Record Payment | + New Invoice

---

## MODULE 12: SETTINGS / CONFIGURATION

### Company Settings
- Edit company name, address, contact info, bank accounts
- Upload company logo (used in invoice header) — stored in Supabase Storage

### System Configuration
- ISC Tax Rate % (for PEW in-house clearing)
- Default invoice overdue days
- Default Form E PKR rate range
- CASS WHT rate (currently 12% — should be editable)
- BTA rate per AWB (per airline, already in Airline config)

### Data Management

#### Import from Excel / CSV (Old Data Migration)
The system must fully support migrating all existing historical data. Three separate import flows are required:

**1. Bulk Shipment Import**
- Upload a CSV or Excel file containing historical shipment records
- After upload, show a **field mapping screen** where the user matches their existing column names to the system's fields (e.g., their column "AWB" maps to AWB Number, "WT" maps to Chargeable Weight, etc.)
- Preview the first 5 rows before confirming import
- On import, all shipments auto-populate their respective party ledger receivable rows and airline sales report data

**2. Client Opening Balance Entry**
- For clients who already have an outstanding balance before the system start date, allow entering an **opening balance per client**
- Input: Client name, Opening Balance (PKR), As-of Date (the cutoff date from which the new system takes over)
- This opening balance appears as the first row in the client's ledger (labelled "OPENING BALANCE — brought forward from [date]") and the running balance starts from it
- This way the user does not need to re-enter every historical transaction — just the carried-forward balance

**3. Historical Payment Records Import**
- Upload a CSV containing historical payments already received from clients
- Required columns: Date, Client Name, Amount (PKR), Bank/Account, Transaction ID (optional), Notes (optional)
- After field mapping and preview, these import as payment rows into the correct client ledgers
- Useful for importing months of payment history without manual entry

**Other Data Management**
- **Export all data**: Full data export as JSON backup (downloadable file)
- **Restore from backup**: Import a previously exported JSON backup to restore all data
- **Clear all data**: With a two-step confirmation prompt (type "DELETE" to confirm) to prevent accidental deletion

---

## MODULE 13: USER MANAGEMENT & ACCESS CONTROL

Multi-user login system built on **Supabase Auth**. Each user has a profile row carrying their role.
Permissions are enforced with **Row-Level Security in the database**, not only in the UI.

### User Roles

| Role | Permissions |
|------|-------------|
| **Admin** (Father — Owner) | Full access: all modules, all data, user management, settings |
| **Manager** (Haider — default) | Full access to all operational and accounting modules; cannot manage other users |
| **Data Entry** | Can add/edit shipments in Master Log and record payments in ledgers; cannot delete or access P&L or User Management |
| **Report Viewer** | Read-only access: can view ledgers, statements, sales reports, P&L; cannot edit anything |
| **Invoice Agent** | Can generate, view, print, and share invoices and statements; can record payments; cannot access P&L or User Management |

### Login Screen
- Company branding (navy header)
- Email + Password fields (Supabase Auth)
- Role shown after login in top bar
- Session persists until manual logout

### Initial Users (seed during setup)
- An Admin account (Father — Owner)
- A Manager account (Haider — default)

Seed these through Supabase Auth during setup rather than hard-coding plaintext passwords in the app.
Prompt each user to set/change their password on first login.

---

## DESIGN SYSTEM

### Color Palette
- **Primary Navy:** `#1a2744` — used for sidebar, invoice header, table headers, primary buttons
- **Accent Blue:** `#2563eb` — links, active states, payment row highlights in ledger
- **Success Green:** `#16a34a` — Departed status, paid badges
- **Warning Amber:** `#d97706` — AWB Issued status, pending badges
- **Danger Red:** `#dc2626` — overdue indicators, balances due
- **Light Grey:** `#f8fafc` — page background
- **White:** `#ffffff` — card/panel background

### Typography
- Headers/Company Name: Bold, uppercase tracking
- Body: Clean sans-serif (Inter or system-ui)
- Data tables: Monospace for numbers (tabular figures), regular for text
- Currency amounts: Right-aligned, always show 2 decimal places with comma separators (e.g., PKR 892,473.00)

### Layout
- **Sidebar** (left, fixed, collapsible): navy background, white icons and text, active item highlighted
- **Top bar**: breadcrumb + user role badge + logout button
- **Content area**: white cards with subtle shadows, full width
- **Tables**: sticky headers, alternating row shading, fixed columns for wide tables (horizontal scroll)
- **Modals**: for add/edit forms to keep context visible

### Formatting Standards
- Date format: DD/MM/YYYY (e.g., 11/06/2026)
- Numbers: comma-separated with 2 decimal places (e.g., 1,830.00)
- Currency prefix: PKR for Pakistani Rupees, $ for USD values
- AWB format: displayed as XXX-XXXX-XXXX
- IATA codes: always uppercase

---

## DATA RELATIONSHIPS

```
Shipment (Master Log)
  ├── links to → Client (Party Management)
  ├── links to → Airline (Party Management)
  ├── links to → Clearing Agent (Party Management)
  ├── links to → Form E Supplier (Party Management)
  ├── generates → Invoice
  ├── auto-populates → Party Ledger (receivable row)
  ├── auto-populates → Airline Sales Report (CASS)
  ├── auto-populates → Clearing Agent Payable Report
  └── auto-populates → Form E Supplier Payable Report

Payment (recorded in Party Ledger)
  ├── auto-updates → Client Balance
  └── auto-updates → Income Module

Expense Entry
  └── auto-updates → P&L

CASS Payment (recorded in Airline Sales Report)
  └── auto-updates → Expenses Module (as Airline Payment)
```

---

## SAMPLE / SEED DATA

Pre-load the following sample data so the app is not empty on first launch:

**Airlines:**
- PIA | Prefix: 214 | Commission: 5% | Other Charges Standard: 6,246 | Other Charges Self-Upload: 5,000 | BTA: 1,800 per AWB
- Emirates | Prefix: 176 | Commission: 5% | Other Charges Standard: 6,186 | BTA: 1,800 per AWB
- Qatar Airways | Prefix: 157 | Commission: 5%

**Sample Clients:** Waqas / Mudassir R&M Peshawar, Mr. Qayum Care of Imran Peshawar

**Sample Clearing Agent:** Peshawar (in-house) — PEW — PKR 10,000 per shipment

**Sample Form E Supplier:** Supplier A — default PKR rate 13.00

**Sample Shipments (3–5 records across different clients and airlines)**

---

## TECHNICAL REQUIREMENTS

- **Framework:** React (functional components + hooks), built with **Vite**
- **Styling:** Tailwind CSS utility classes; define the design tokens in `tailwind.config`
- **Routing:** React Router
- **State:** React hooks + Context for global/shared state
- **Backend / Database / Auth / File storage:** **Supabase** (PostgreSQL, Supabase Auth, Row-Level Security, Supabase Storage)
- **Persistence:** all data in normalized **Postgres** tables. Store all money as `NUMERIC(14,2)`; **never use floating-point for currency** — round explicitly to 2 decimals and avoid JS float arithmetic on money.
- **Running balances:** compute on read by ordering rows chronologically and summing (SQL window functions). Do **not** store a mutable balance column — a payment inserted between two shipment rows must recalculate every balance below it.
- **Transactions:** wrap any multi-step write (e.g. payment insert + dependent update) in a database transaction.
- **Auth & roles:** Supabase Auth; enforce the 5 roles via **Row-Level Security in the database**, not only in the UI.
- **Deployment:** Vercel (frontend) + Supabase (hosted backend). Keep the app deployable from the start.
- **PDF / Print:** `react-to-print` / `window.print()` with print-specific CSS for invoices and statements (clean A4 layout).
- **Icons:** `lucide-react`
- **Charts:** `recharts` (Dashboard, P&L)
- **Excel export:** generate CSV in JavaScript (no extra library needed)
- **Responsive:** desktop primary, mobile secondary
- **Empty states:** every empty list shows a helpful "Add your first X" prompt, not a blank screen
- **Loading states:** show a spinner during async data operations
- **Secrets:** Supabase URL + anon key come from environment variables (`.env`, never committed); use a `.env.example`

---

## CRITICAL BUSINESS LOGIC NOTES

1. **Form E Calculation:** Form E Amount (PKR) = USD Value × PKR Rate (entered per shipment, NOT a fixed rate). The rate varies per transaction between approximately 13 and 18 PKR per USD.

2. **ISC Tax:** Only applies when Origin = PEW (Peshawar) because clearing is done in-house. Other origin cities use outsourced agents and do NOT have ISC tax on the client invoice.

3. **CASS vs. Client Rate:** The rate on the client invoice (Net Rate) is typically higher than the actual CASS airline rate. The difference (minus commission structure) is the company's margin on freight.

4. **Fortnightly CASS:** Period 1 = 1st to 15th of month. Period 2 = 16th to last day of month. Always display both periods for the current month on the CASS report screen.

5. **BTA (Bank Transfer Adjustment):** A flat IATA charge per AWB (e.g., PKR 1,800/AWB for IATA insurance program). It is added on top of the net airline amount when calculating total CASS payment. It is NOT in the per-AWB table — it appears as a separate "Additional Adjustments" line.

6. **WHT (Withholding Tax):** 12% withheld on the net airline amount. This is deducted from what the agent pays to the airline, so it reduces the net payable. Configure this rate in Settings.

7. **Adjustment Line on Invoice:** When a previous invoice has a balance adjustment (credit or debit from a prior invoice), add a line "ADJUSTMENT BALANCE INV NO [previous_invoice_no]" with the adjustment amount. This can be positive or negative.

8. **Running Balance in Ledger:** Balance must recalculate correctly when payments are inserted between shipment rows. The balance is always: previous balance + receivable (for shipment rows) or previous balance − received (for payment rows), maintaining strict chronological order.

9. **Outsourced Clearing Agent Assignment:** When Origin is NOT PEW, auto-suggest the clearing agent configured for that city in Party Management. The clearing charge on the client invoice comes from the agent's per-shipment rate.

10. **Multiple Bank Accounts:** When recording a payment received, always capture which bank account it was received into (Sindh Bank, HMB, HBL, BOK, Askari, Meezan, Soneri, Other). This flows into the ledger payment row description.