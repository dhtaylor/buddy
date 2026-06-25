# HELOC cash-sweep view (velocity banking)

A plain-language guide to Buddy's optional Home view for managing a line of
credit. Hand this to whoever uses the app day to day.

## What it does

Normally Home shows a single running balance. With the **HELOC cash-sweep view**
turned on, Home instead shows:

- **Your cash** (checking, savings) next to **what you owe** on your line of credit
- **Net position** — your cash minus your HELOC debt, i.e. where you actually stand
- A **paydown card** for the line of credit showing:
  - how much you currently **owe** and how much credit is still **available**
  - an estimate of the **interest you're paying each month** at the current balance
  - how much you **swept** (paid toward it) and **drew** (pulled out) this period
  - the headline number: **interest you saved** this period by parking cash against the debt

> **The idea ("velocity banking"):** instead of letting your paycheck sit in
> checking earning nothing, you keep it parked against the line of credit. HELOC
> interest is charged daily on the balance, so every dollar sitting there shrinks
> the interest — until you need it back for bills. The "interest saved" number
> shows the payoff of doing that.

This view only changes how your money is *displayed*. It never changes, hides, or
moves any of your actual data.

## How to use it

1. **Turn it on** — Go to **Settings** and check **"Enable HELOC cash-sweep
   view."** Save. (Admin only.)
2. **Add your line of credit** — In Settings, add an account of type
   **"HELOC / Line of credit"** and enter:
   - the **balance you owe as a negative number** (e.g. `-25,000.00`)
   - your **credit limit** (e.g. `50,000`)
   - your **APR** (e.g. `8.5`)
3. **Record money as usual:**
   - paying money **toward** the line of credit = a **credit** (a "sweep")
   - pulling money **out** of it = a **debit** (a "draw")
4. **Read Home** — Watch **Net position** climb as you pay down, and check
   **interest saved** each period to see the strategy working.

## Troubleshooting

- **The view doesn't appear after enabling it.** The paydown cards only show when
  at least one HELOC account exists — add one (step 2).
- **I still see the old screen.** Buddy is an installed app (PWA) and may be
  showing a cached version. Hard-refresh the page, or close and reopen the app.
