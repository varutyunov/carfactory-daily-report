# Repo Brain Protocol v1.0
### Repossession Decision Intelligence for Car Factory (DeBary + DeLand)

---

## Purpose

This protocol defines how to analyze a CarPay customer portfolio and determine which accounts are candidates for repossession. It is designed to be run by an AI analyst (Claude) against live Supabase data on a scheduled or on-demand basis.

The goal is not to flag every late account — it is to **identify the accounts where repossession is the right business decision**, distinguish them from customers who are working through difficulty, and prioritize by urgency and executability.

---

## Data Sources

| Source | Table / Location | Key Fields |
|---|---|---|
| CarPay customers | `carpay_customers` | `days_late`, `current_amount_due`, `scheduled_amount`, `payment_frequency`, `auto_pay`, `next_payment`, `phone`, `email`, `vehicle`, `location` |
| CarPay payments | `carpay_payments` | `account`, `date`, `amount_sent`, `method` |
| Deals | `deals` | `customer_name`, `gps_serial`, `vehicle_desc`, `deal_type`, `total_collected` |
| GPS (Passtime) | Live — not stored | Vehicle location, movement, state, online status |
| Communications | App DMs | Message delivery status, response history |

---

## Trigger Threshold

**Analysis begins when an account reaches 15+ days late.**

Accounts under 15 days late are excluded entirely — minor timing issues, not a signal.

---

## Step 1: Exclude False Positives First

Before scoring, apply these exclusions. These accounts are NOT repo candidates regardless of days-late:

### 1A — Near Payoff
**Rule:** If `current_amount_due` is less than 2× the `scheduled_amount` AND the customer has made at least 1 payment in the last 60 days → **exclude from repo consideration.**

**Rationale:** This customer is near the end of their loan. They owe a small balance and are still engaging. Repossessing a car from someone about to pay it off is bad business, bad optics, and legally complex. Work with them to close it out.

*Example: Guerrero, Ramona — $371 owed, 3 payments in last 45 days. Despite 169 days "late" by the calendar, she is functionally paying off a small balance. Not a repo candidate.*

### 1B — Active and Improving
**Rule:** If the customer has made 3+ payments in the last 45 days AND `days_late` < 60 → **watch only, do not escalate.**

**Rationale:** This person is actively engaging and the delinquency is recent. Give the payment trend time to resolve.

### 1C — Auto-Pay Enrolled, Recent Authorization
**Rule:** If `auto_pay = true` AND the last payment was within 30 days → **watch only.**

**Rationale:** Auto-pay failures can be technical. Contact before escalating.

---

## Step 2: Classify Remaining Accounts

### TIER 1 — Repo Ready 🚨
**Criteria (must meet ALL):**
- 90+ days late
- 0 payments in the last 90 days
- NOT near payoff (current_amount_due > 2× scheduled_amount, or no payment in 60+ days despite small balance)
- No auto-pay enrolled

**Action:** Pull GPS in Passtime immediately. If vehicle is in-state and moving → initiate repo process. If GPS offline or out of state → note and escalate for skip trace.

---

### TIER 2 — Critical ⚠️
**Criteria:**
- 45–89 days late, OR
- 60+ days late with token payments (single small payment in last 30–45 days, no consistent pattern)

**The Token Payment Pattern:** One payment after weeks of silence is a stall tactic. The customer knows the account is delinquent and made a minimal payment to reset the clock or avoid a call. Indicators:
- Only 1 payment in the last 60+ days
- Payment amount is significantly below the scheduled amount (< 50%)
- Account was silent before and after the payment

**Action:** Direct contact required within 48 hours. Establish a written payment plan with a deadline. If no response or no plan within 7 days → escalate to Tier 1 protocol (GPS check + repo).

---

### TIER 3 — Watch 👁
**Criteria:**
- 15–44 days late
- Making payments but not caught up
- OR: 45+ days late but payment frequency is clearly improving (more payments in last 45 days than prior 45 days)

**Action:** Monitor weekly. Schedule a courtesy contact. Do not escalate unless payment activity stops or days-late continues increasing without progress.

---

## Step 3: Scoring Model (0–100)

When outputting a prioritized list, score each account for ranking purposes:

| Signal | Points |
|---|---|
| Days late: 15–29 | 10 |
| Days late: 30–44 | 20 |
| Days late: 45–59 | 25 |
| Days late: 60+ | 30 |
| No payments ever | 35 |
| Last payment 45+ days ago | 35 |
| Last payment 30–44 days ago | 25 |
| Last payment 15–29 days ago | 15 |
| Average payment < 50% of scheduled | +20 |
| Average payment 50–74% of scheduled | +12 |
| Average payment 75–99% of scheduled | +5 |
| Payment frequency declining (recent 45d < prior 45d) | +10 |
| Payment frequency stable | +3 |
| Current debt > 3× scheduled (high total burden) | +10 |
| Current debt 2–3× scheduled | +6 |
| No auto-pay enrolled | +5 |
| Auto-pay enrolled | –5 |
| **Near payoff exclusion applies** | **Score → 0** |

**Score thresholds:**
- 80–100: Repo Ready
- 60–79: Critical
- 40–59: At Risk
- 20–39: Watch
- 0–19: Normal

---

## Step 4: GPS Verification (Before Any Repo Action)

Before physically initiating repossession on any account, verify in Passtime:

1. **Is the GPS online?** If offline for 30+ days → possible the device was removed or the car is hidden. Flag for skip trace.
2. **Is the vehicle moving?** Recent movement confirms the customer is using the car and it's accessible.
3. **Is it in-state?** Out-of-state vehicles complicate repo legally and logistically. Note the state and assess.
4. **Has it been in the same location for 7+ days?** A parked location (home, work) makes physical recovery easier.

GPS serial numbers are stored in the `deals` table under `gps_serial`, cross-referenced by customer name.

---

## Step 5: Communication Check

Before repo on Tier 2 accounts, confirm contact was attempted:

- Was a message sent via the app?
- Was it delivered? (check delivery status in Communications tab)
- Did the customer respond?
- How many contact attempts total?

A customer who has never received a message (undelivered) may have a wrong number on file. A different approach (email, in-person) may be needed before repo is appropriate.

---

## Output Format

When running a full analysis, produce:

### Summary Block
- Total accounts 15+ days late
- Breakdown by tier
- How many are near-payoff exclusions
- How many have no payment history
- How many have no phone/contact on file (data gap)

### Tier 1 List (Repo Ready)
Sorted by days late descending. For each:
- Name, Account #, Location, Days Late
- Last payment date and amount (or "no payments")
- GPS serial (if available)
- Recommended action

### Tier 2 List (Critical — Needs Contact)
Sorted by days late descending. For each:
- Name, Account #, Location, Days Late
- Payment pattern summary (token payment? silence? declining?)
- Phone available? (Y/N)
- Deadline for response before escalation

### Tier 3 List (Watch)
Brief list, name + account + days late + last payment + trend direction.

### Data Gap Note
List accounts missing phone, vehicle, or scheduled amount — these need a CarPay sync to improve analysis accuracy.

---

## Important Context

- **Two locations:** DeBary (larger portfolio, ~175 customers) and DeLand (~74 customers). Treat separately when prioritizing — repo logistics differ.
- **Deal types matter:** Some deals may have been structured differently (payment holidays, modified terms). When in doubt, cross-reference the `deals` table and check with Vlad before acting.
- **Old accounts:** Many accounts in the system are severely delinquent (300–450+ days) and have no payment history. These may already be known situations — Vlad has context on which ones have been written off mentally vs. which ones are still actively being pursued. Always flag these for Vlad's review rather than treating them as automatic repos.
- **Repo is not the only outcome.** Sometimes a customer reappears after months of silence. The goal of this analysis is to prioritize attention and action, not to automate repossession decisions. Vlad makes the final call.

---

## Protocol Revision Log

| Version | Date | Change |
|---|---|---|
| v1.0 | 2026-04-01 | Initial protocol. Based on live portfolio analysis of 126 late accounts. Added near-payoff exclusion after Guerrero case. |

---

*This protocol is maintained by Vlad and refined over time as edge cases are identified. When a rule produces a wrong classification, document the case and update the protocol.*
