// gps-sync — server-side gateway for the Passtime GPS Sync bookmarklet.
//
// Why this exists: the bookmarklet runs in the user's browser on
// secure.passtimeusa.com and authenticates to Supabase using only the
// anon key. After the Day 9 RLS migration, anon role has no row-level
// access to `deals` — so the bookmarklet's pending-deals query silently
// returned 0 rows.
//
// This function uses the service-role key server-side to bypass RLS, and
// gates access via a shared secret (`GPS_SYNC_SECRET`) the bookmarklet
// includes in the body. Same pattern as Apps Script's `SHEETS_SECRET`.
//
// Two actions:
//   POST { secret, action: 'list' }
//     → returns array of finance deals where gps_uploaded=false AND
//       gps_serial is non-empty AND voided_at is null.
//   POST { secret, action: 'mark_uploaded', deal_id: <int> }
//     → sets deals.gps_uploaded = true on that row.
//
// Anything else: 400.
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const GPS_SYNC_SECRET = Deno.env.get("GPS_SYNC_SECRET") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const sbHeaders = {
  apikey: SB_SERVICE_KEY,
  Authorization: `Bearer ${SB_SERVICE_KEY}`,
  "Content-Type": "application/json",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { secret, action } = body;

    if (!secret || secret !== GPS_SYNC_SECRET) {
      return json({ error: "Forbidden" }, 403);
    }

    if (action === "list") {
      // Pending finance deals with a serial set, not voided
      const params = new URLSearchParams({
        select:
          "id,customer_name,vehicle_desc,vin,stock,gps_serial,gps_uploaded,color,location",
        deal_type: "eq.finance",
        gps_uploaded: "eq.false",
        voided_at: "is.null",
        order: "created_at.asc",
      });
      const r = await fetch(`${SB_URL}/rest/v1/deals?${params}`, {
        headers: sbHeaders,
      });
      if (!r.ok) throw new Error(`deals fetch ${r.status}: ${await r.text()}`);
      const deals = await r.json();
      // Filter to those with non-empty serial (Postgres `neq.` on text+null
      // is awkward; easier in JS).
      const pending = (deals as any[]).filter((d) =>
        ((d.gps_serial || "") as string).trim().length > 0
      );
      return json({ ok: true, deals: pending });
    }

    if (action === "mark_uploaded") {
      const dealId = parseInt(body.deal_id, 10);
      if (!Number.isFinite(dealId)) {
        return json({ error: "Missing/invalid deal_id" }, 400);
      }
      const r = await fetch(`${SB_URL}/rest/v1/deals?id=eq.${dealId}`, {
        method: "PATCH",
        headers: { ...sbHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({ gps_uploaded: true }),
      });
      if (!r.ok) {
        throw new Error(`patch ${r.status}: ${await r.text()}`);
      }
      return json({ ok: true, deal_id: dealId });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});

function json(obj: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
