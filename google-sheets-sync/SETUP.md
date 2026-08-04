# Google Sheet ⇄ Master Shipment Log

Your client keeps a Google Sheet. It syncs **both ways**: rows they enter land in
the Master Shipment Log, and shipments added or edited on the Master Shipment
page come back down into their sheet. Shipments are matched on **AWB Number** in
both directions, so syncing the same row twice updates it instead of creating a
duplicate.

```
Google Sheet  ⇄  Apps Script (Google's servers)  ⇄  Supabase  ⇄  Master Shipment page
```

Nothing runs in the browser, so no keys are ever exposed to visitors of the site.

---

## One-time setup

### 1 — Run the migration

Supabase dashboard ▸ **SQL Editor** ▸ paste the whole of
[`supabase/migrations/007_sheet_sync.sql`](../supabase/migrations/007_sheet_sync.sql)
▸ **Run**.

This creates the `sync_shipments_from_sheet` function and a locked-down
`integration_settings` table. It also adds three columns the app already uses
(`other_charges_due_airline`, `awb_fixed_fee`, `form_e_pkr_rate_payable`) which
were never captured in a migration file — those statements are no-ops if the
columns already exist.

Then do the same with
[`supabase/migrations/008_sheet_backfill.sql`](../supabase/migrations/008_sheet_backfill.sql).
That one adds `export_shipments_to_sheet`, which is what fills a new sheet with
the shipments you already have (see [Starting from your existing
shipments](#starting-from-your-existing-shipments)). It is read-only.

Finally
[`supabase/migrations/009_sheet_pull_changes.sql`](../supabase/migrations/009_sheet_pull_changes.sql).
That adds `export_shipments_changed_since` — the "what's new since last time"
query behind the downward half of the sync (see [Changes flowing back
down](#changes-flowing-back-down)). Also read-only.

### 2 — Set the shared secret

Generate a long random string. In the SQL Editor:

```sql
INSERT INTO integration_settings (key, value)
VALUES ('sheet_sync_secret', 'PASTE-A-LONG-RANDOM-STRING-HERE')
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value, updated_at = NOW();
```

Keep that string — you paste it into the sheet in step 5. Nobody but you and the
Apps Script ever needs it. To rotate it later, re-run this statement and redo
step 5.

### 3 — Create the sheet

Create a new Google Sheet, name the first tab **`Shipments`**, then
File ▸ Import ▸ Upload [`sheet-template.csv`](sheet-template.csv)
▸ *Replace current sheet*.

Delete the example row before going live.

### 4 — Add the script

In the sheet: **Extensions ▸ Apps Script**. Delete whatever is in `Code.gs`,
paste the whole of [`Code.gs`](Code.gs), and save.

Reload the sheet. A **TIL Sync** menu appears next to Help.

### 5 — Connect it

**TIL Sync ▸ Setup — connect to system**. It asks for three things:

| Prompt | Where to get it |
|---|---|
| Supabase URL | Project Settings ▸ API ▸ Project URL |
| Supabase anon key | Project Settings ▸ API ▸ `anon` `public` |
| Sync secret | The random string from step 2 |

Then run **TIL Sync ▸ Test connection**. You want "Connected."

### 6 — Turn on auto-sync

**TIL Sync ▸ Turn ON auto-sync (every 15 min)**. Google asks for authorisation
the first time — it is your own script, so approve it.

Each cycle does two things, in this order: **push** what the sheet has, then
**pull** what the system has. Your client can still hit **Sync Now** or **Pull
updates from system** any time they don't want to wait.

---

## Changes flowing back down

A shipment added on the Master Shipment page appears in the client's sheet within
15 minutes. So does an edit — change a net rate on the website and the sheet's
cell follows.

**New AWBs are appended at the bottom** of the sheet. **AWBs the sheet already
has are rewritten in place**, in whatever row they already sit in. Nothing is
ever cleared, and rows your client typed that have not reached the server yet are
left alone.

Rows that came down are marked `OK — from system` in the Sync Status column.

**If the same AWB was changed in both places in the same 15 minutes, the system
wins.** The push runs first, so the client's edit reaches the server and is
applied there; then the pull brings back whatever the system ended up holding.
The client's edit is not lost — it just arrives back through the system, and the
website's validation and calculated totals have the last word.

**Deletes still do not propagate, in either direction.** A shipment deleted on
the website leaves its row sitting in the sheet. Delete that row by hand.

### The first pull

Run **TIL Sync ▸ Pull updates from system** once by hand. It asks how far back to
go:

- **YES** — merge every shipment in the system into the sheet now, matched on
  AWB. Use this if the sheet has drifted and you want it reconciled.
- **NO** — start from this moment. Only changes made from now on come down.

You don't need to do this if you ran **Import existing shipments from system**
first — that already leaves the sheet in step with the system and sets the
starting point for you.

Auto-sync never makes this choice on its own. If the trigger runs before anyone
has pulled by hand, it quietly sets the starting point to right now and merges
nothing, so a timer can never dump the whole log into the sheet unannounced.

To start over, run **TIL Sync ▸ Pull updates from system** after clearing the
saved starting point (Extensions ▸ Apps Script ▸ run `resetPullWatermark`).

---

## Starting from your existing shipments

A fresh sheet is empty, but the Master Shipment Log is not. To start the sheet
off with everything already in the system:

**TIL Sync ▸ Import existing shipments from system**

It pulls every shipment, oldest flight date first, and fills the sheet in. On a
log of ~2,700 shipments this takes well under a minute.

Do this **once**, before handing the sheet over. Two things to know:

**It replaces the sheet, it never touches the system.** If the sheet already has
data rows it asks first, then clears everything below the header row. Nothing in
the Master Shipment Log is read-modified or deleted — the import only reads.

**Imported rows come in already marked as synced.** Their Sync Status reads
`OK — imported` and their hash is pre-filled, so the next auto-sync skips all
2,700 of them instead of pushing every row straight back at the server. Edit one
afterwards and only that row goes back, exactly as if it had been typed by hand.

Because of that, **don't run Re-sync ALL rows on a full sheet** unless you have a
reason to. It would send every row in batches of 50, which on a few thousand rows
will hit Apps Script's 6-minute execution limit part-way through. Sync Now is the
one to use — it only sends what changed.

### What comes across

Every column in the template, resolved back to names: client, clearing agent,
sales agent and Form E supplier arrive as text, not IDs. Airline is not imported
because it is not a column — it is read from the AWB prefix on the way back in.

Form E USD comes across **per kg**, matching the Add Shipment form, so a shipment
stored as $350 total on 1,000 kg imports as `0.35`.

Freight Amount, CASS Freight Total and Total Receivable are not imported, because
the database computes them.

One thing to check afterwards: if any historical shipment carries a status
outside the eight valid values below, its row will import fine but will be
rejected if it is ever edited and pushed back. Sort the Status column once after
importing to spot any.

---

## The columns

**Required** — a row is rejected if any of these is blank:

| Column | Notes |
|---|---|
| Flight Date | Any date format Sheets recognises |
| AWB Number | e.g. `176-1421-4841` |
| Client Name | Must already exist in Party Management |
| Origin | 3-letter IATA, e.g. `PEW` |
| Destination | 3-letter IATA, e.g. `DXB` |
| Chargeable Weight | Must be greater than 0 |
| Net Rate | PKR per kg |

**Optional** — leave blank and the system fills in a sensible default:

| Column | Default when blank |
|---|---|
| Pieces | `1` |
| Status | `PNDNG` |
| USD Rate | `1` |
| CASS Airline Rate | `0` |
| Clearing Agent | The agent registered for that origin |
| Clearing Charges | That agent's per-shipment charge |
| IDC Tax | For `PEW` only: clearing charges × the IDC rate in Settings |
| Other Charges | `0` |
| AWB Fixed Fee | `1000` |
| Sales Agent | none |
| SA Commission | That agent's standing per-kg rate |
| Form E Supplier | none |
| Form E USD Rate | `0` — this is **per kg**, same as the Add Shipment form |
| Form E PKR Receivable / Payable | `0` |
| Notes | empty |

**Airline is not a column.** It is read from the AWB prefix — `176-…` resolves
to Emirates via the IATA prefix in Party Management. If the prefix is unknown
the row is rejected.

**Freight Amount, CASS Freight Total and Total Receivable are not columns
either.** The database computes those, and always has. They show up on the
Master Shipment page automatically.

Valid Status values: `PNDNG` · `AP-BLZ` · `BKD` · `CNCLD` · `NO SHOW` ·
`OFFLOADED` · `SHPD` · `EMAILED`

---

## What your client sees

Three columns appear on the right after the first sync:

- **Sync Status** — `OK — created`, `OK — updated`, `OK — imported`,
  `OK — from system`, or `ERROR — <reason>` in red
- **Last Synced** — timestamp
- **Row Hash** — hidden bookkeeping; ignore it

Typical errors and what they mean:

| Message | Fix |
|---|---|
| `Unknown client "X" — add it in Party Management first` | Add the client on the website, then it syncs on the next run |
| `Client "X" matches 3 clients — use the exact name` | Type the client's full name as registered |
| `No active airline with IATA prefix "999"` | Add the airline in Party Management |
| `Chargeable Weight is required and must be greater than 0` | Fill the weight in |
| `Flight Date "..." is not a valid date` | Re-enter the date |

A bad row never blocks the good ones — the rest of the batch still goes through.

---

## Behaviour worth knowing

**Edits flow through.** Change a synced row and the next sync updates that
shipment, matched on AWB.

**Blank cells never wipe website data.** If your finance team enters a CASS rate
on the website and that column is empty in the sheet, the sync leaves it alone.
Only cells with something in them overwrite.

**Deletes do not propagate.** Deleting a sheet row leaves the shipment in place.
This is deliberate — shipments are referenced by invoices and ledger entries, and
an accidental row delete should not take those down. Cancel a shipment by setting
its status to `CNCLD` instead. It works the same way round: deleting a shipment
on the website leaves its row in the sheet.

**Rows that came down are not sent back up.** Each merged row is stamped so the
next push treats it as already in sync. Edit one afterwards and only that row
goes back, exactly as if it had been typed by hand.

**Unchanged rows are skipped.** The sync only sends rows whose content changed,
so a 2,000-row sheet costs one small request per run. **Re-sync ALL rows** forces
everything through if you ever need it.

**Changing the AWB number creates a second shipment.** The AWB is the identity
key. Correcting a typo'd AWB in the sheet will insert a new shipment and leave
the old one behind — delete that one on the website.

---

## Security

The anon key sits in the sheet's Script Properties, which is standard — it is
already public in the website bundle and grants nothing on its own, because RLS
requires an authenticated session for every table.

The only three things the sheet can do are call `sync_shipments_from_sheet`,
`export_shipments_to_sheet` and `export_shipments_changed_since`, and only with
the shared secret. Between them they can write shipments and read shipments plus
the party names attached to them. None can read invoices, ledgers, payments or
your client list wholesale, and none can delete anything. The `service_role` key
is never involved.

Note that the two export functions do hand back the whole shipment log to anyone
holding the secret — which is the same thing the sheet itself shows, so it moves
no line, but it is a reason to keep the secret to yourself rather than the sheet's
editors.

If the secret ever leaks, re-run step 2 with a new string and redo step 5.

---

## Rolling back

```sql
DROP FUNCTION IF EXISTS sync_shipments_from_sheet(TEXT, JSONB);
DROP FUNCTION IF EXISTS export_shipments_to_sheet(TEXT, INT, INT);
DROP FUNCTION IF EXISTS export_shipments_changed_since(TEXT, TIMESTAMPTZ, INT, INT, TEXT[]);
DROP FUNCTION IF EXISTS til_safe_numeric(TEXT);
DROP TABLE IF EXISTS integration_settings;
```

The three added shipment columns are left alone — the app uses them.
