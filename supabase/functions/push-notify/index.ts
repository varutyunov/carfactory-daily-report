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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const {
      target_names,
      included_segments,
      send_after,
      title,
      body,
      tab,
      data,
    } = await req.json();

    const hasNames = Array.isArray(target_names) && target_names.length > 0;
    const hasSegments = Array.isArray(included_segments) && included_segments.length > 0;

    if ((!hasNames && !hasSegments) || !title) {
      return new Response(
        JSON.stringify({
          error: "Missing target_names/included_segments or title",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const payload: Record<string, unknown> = {
      app_id: ONESIGNAL_APP_ID,
      target_channel: "push",
      headings: { en: title },
      contents: { en: body || "" },
    };

    // Targeting: per-employee external_id alias (e.g. ["vlad","tommy"]) OR
    // segment broadcast (e.g. ["All"]). Both are forwarded as-is to
    // OneSignal — no extra logic needed.
    if (hasNames) {
      const aliases = target_names.map((n: string) =>
        String(n).toLowerCase().replace(/\s+/g, "_")
      );
      payload.include_aliases = { external_id: aliases };
    }
    if (hasSegments) {
      payload.included_segments = included_segments;
    }

    // Optional scheduled-send (calendar event reminders use this).
    if (send_after) {
      payload.send_after = send_after;
    }

    // Forward optional `tab` and `data` to OneSignal so the page-side
    // click listener (and the SW backup) can read it and deep-link.
    const extra: Record<string, unknown> = {};
    if (tab) extra.tab = String(tab);
    if (data && typeof data === "object") {
      for (const k in data) extra[k] = data[k];
    }
    if (Object.keys(extra).length > 0) {
      payload.data = extra;
    }

    // Cold-start path: when the user taps a notification with the PWA
    // closed, OneSignal opens this URL. The page-side ?notif_tab parser
    // routes from there. Belt-and-suspenders alongside the OneSignal click
    // listener — covers iOS where SDK click events sometimes don't fire
    // before the page renders. Any extra `data` fields (e.g. `location`
    // for payments) get encoded as `notif_<field>` so the page can read
    // them too.
    if (tab) {
      const qsParts = [`notif_tab=${encodeURIComponent(String(tab))}`];
      if (data && typeof data === "object") {
        for (const k in data) {
          if (data[k] === undefined || data[k] === null) continue;
          qsParts.push(`notif_${encodeURIComponent(k)}=${encodeURIComponent(String(data[k]))}`);
        }
      }
      payload.web_url = `https://carfactory.work/?${qsParts.join("&")}`;
    }

    // OneSignal v2 endpoint with v2 app key (`os_v2_app_*`) and Key auth.
    // The legacy onesignal.com/api/v1/notifications endpoint rejects the
    // newer key format with both Basic and Key prefixes; api.onesignal.com
    // is the correct host for v2 keys.
    const osResp = await fetch("https://api.onesignal.com/notifications?c=push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Key ${ONESIGNAL_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const osData = await osResp.json();
    if (!osResp.ok) {
      throw new Error((osData.errors && osData.errors[0]) || "OneSignal error");
    }

    return new Response(JSON.stringify({ success: true, id: osData.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
