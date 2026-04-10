import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const ONESIGNAL_APP_ID = "ff6238d8-1a7b-4415-a589-229cd4059233";
const ONESIGNAL_API_KEY = Deno.env.get("ONESIGNAL_API_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { form_type, customer_name, token } = await req.json();

    const typeLabels: Record<string, string> = {
      deposit: "Deposit Agreement",
      invoice: "Mechanic Invoice",
      void_release: "Void / Release",
    };
    const typeLabel = typeLabels[form_type] || form_type;

    const payload = {
      app_id: ONESIGNAL_APP_ID,
      headings: { en: `✍️ E-Sign Complete: ${typeLabel}` },
      contents: {
        en: `${customer_name || "Customer"} has signed their ${typeLabel}. Open the app to counter-sign.`,
      },
      included_segments: ["All"],
      data: { type: "esign_signed", form_type, token },
    };

    const osResp = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${ONESIGNAL_API_KEY}`,
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
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
