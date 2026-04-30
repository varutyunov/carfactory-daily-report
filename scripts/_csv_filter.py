"""
Canonical CSV transaction filter — single source of truth.

Mirrors Automation.md §7 ("CSV transaction types — what counts toward
col G / Profit"). Every audit / sync script must use this filter so
totals are consistent.

Usage:
    from _csv_filter import is_real_payment, real_amount

    for row in csv.DictReader(f):
        if not is_real_payment(row):
            continue
        amt = real_amount(row)
        ...
"""

# Reference values that aren't real cash:
SKIP_PAYMENT_REFS = {
    'OPEN',                     # down payment, recorded in deals.money
    'OPEN REFINANCE OPEN',      # refinance opening, no cash
    'NETPAYOFF',                # system payoff calc on PAYMENT type — not real cash
    'NETPAYOFF/NOWRITEOFF',     # same
    'NETPAYOFF/WRITEOFF',       # written off
}

# Only these PAY OFF references are real cash collections:
PAYOFF_OK_REFS = {
    'NETPAYOFF',                # final balloon payment to close (real cash)
    'NETPAYOFF/NOWRITEOFF',     # same — no writeoff applied
}

# PAYPICK refs to skip (full writeoffs — no cash collected):
# PAYPICK = "pickup" (cash physically collected by office staff). The
# PT WRITEOFF variant is real cash (the partial cash portion of a
# write-off settlement). Only the FULL WRITEOFF case is no-cash.
PAYPICK_SKIP_REFS = {
    'NETPAYOFF/WRITEOFF',       # full writeoff — no cash
}


def is_real_payment(row):
    """True iff this CSV row represents real cash that should be counted
    toward customer payments (col G or Profit26)."""
    tt = (row.get('transtype') or '').strip()
    ref = (row.get('reference') or '').strip().upper()
    if tt == 'PAYMENT':
        if ref in SKIP_PAYMENT_REFS:
            return False
        return True
    if tt == 'PAYPICK':
        if ref in PAYPICK_SKIP_REFS:
            return False
        return True
    if tt == 'PAY OFF':
        return ref in PAYOFF_OK_REFS
    if tt == 'LATEFEE':
        return True
    # Other transtypes (DEPOSIT, EARNEDINT, etc.) — never count
    return False


def real_amount(row):
    """Return the real-cash amount for this row (LATEFEE uses `latefee`
    column, everything else uses `totalamt`). Returns 0 for skip rows
    or invalid values."""
    if not is_real_payment(row):
        return 0.0
    tt = (row.get('transtype') or '').strip()
    field = 'latefee' if tt == 'LATEFEE' else 'totalamt'
    try:
        amt = float(row.get(field, 0) or 0)
    except (ValueError, TypeError):
        return 0.0
    return amt if amt > 0 else 0.0


def parsed_date(row):
    """Return YYYY-MM-DD string for paiddate, or None."""
    pd = (row.get('paiddate') or '').strip()
    if not pd:
        return None
    from datetime import datetime
    try:
        dt = datetime.strptime(pd.split(' ')[0], '%m/%d/%Y')
        return dt.strftime('%Y-%m-%d')
    except Exception:
        return None
