// push-notify — sends a OneSignal push to a list of employees.
//
// Body shape:
//   {
//     target_names: string[],   // employee names; lowercased + underscored as external_id
//     title: string,
//     body?: string,
//     tab?: string,             // optional deep-link target (e.g. "deals", "payments")
//     data?: Record<string,unknown>  // optional additional data merged into OneSignal payload
//   }
//
// `tab` and `data` are forwarded as `payload.data` to OneSignal so the service
// worker can read it back from the notification on click and route the user
// straight to the right section of the app.
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const ONESIGNAL_APP_ID =
  Deno.env.get("ONESIGNAL_APP_ID") || "ff6238d8-1a7b-4415-a589-229cd4059233";
const ONESIGNAL_API_KEY = Deno.env.get("ONESIGNAL_API_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { target_names, title, body, tab, data } = await req.json();

    if (!Array.isArray(target_names) || !target_names.length || !title) {
      return new Response(
        JSON.stringify({ error: "Missing target_names or title" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const aliases = target_names.map((n: string) =>
      String(n).toLowerCase().replace(/\s+/g, "_")
    );

    const payload: Record<string, unknown> = {
      app_id: ONESIGNAL_APP_ID,
      include_aliases: { external_id: aliases },
      target_channel: "push",
      headings: { en: title },
      contents: { en: body || "" },
    };

    // Merge tab + arbitrary data into the OneSignal `data` field. The SW
    // reads `notification.data` on click and uses `data.tab` to deep-link.
    const extra: Record<string, unknown> = {};
    if (tab) extra.tab = String(tab);
    if (data && typeof data === "object") Object.assign(extra, data);
    if (Object.keys(extra).length > 0) payload.data = extra;

    const osResp = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${ONESIGNAL_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const osData = await osResp.json();
    if (!osResp.ok) {
      throw new Error(osData.errors?.[0] || "OneSignal error");
    }

    return new Response(JSON.stringify({ success: true, id: osData.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
