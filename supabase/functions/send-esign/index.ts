import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const TWILIO_SID = Deno.env.get("TWILIO_SID") || "";
const TWILIO_AUTH = Deno.env.get("TWILIO_AUTH") || "";
const TWILIO_FROM = Deno.env.get("TWILIO_FROM") || "";
const RESEND_KEY = Deno.env.get("RESEND_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { method, to, signing_url, customer_name, doc_type, token } = await req.json();

    if (method === "sms") {
      // Send SMS via Twilio
      if (!TWILIO_SID || !TWILIO_AUTH || !TWILIO_FROM) {
        throw new Error("Twilio not configured. Use Copy Link instead.");
      }

      const body = new URLSearchParams({
        To: to,
        From: TWILIO_FROM,
        Body: `Car Factory: Hi ${customer_name}, please sign your document here: ${signing_url}\n\nThis link expires in 72 hours.`,
      });

      const twilioResp = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: "Basic " + btoa(`${TWILIO_SID}:${TWILIO_AUTH}`),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: body.toString(),
        }
      );

      const twilioData = await twilioResp.json();
      if (!twilioResp.ok) {
        throw new Error(twilioData.message || "Twilio error");
      }

      return new Response(JSON.stringify({ success: true, sid: twilioData.sid }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    } else if (method === "email") {
      // Send Email via Resend
      if (!RESEND_KEY) {
        throw new Error("Email not configured. Use Copy Link instead.");
      }

      const emailResp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Car Factory <noreply@carfactory.work>",
          to: [to],
          subject: `Car Factory — Please Sign Your ${doc_type || "Document"}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:20px;">
              <div style="text-align:center;margin-bottom:20px;">
                <h1 style="font-size:24px;font-weight:900;letter-spacing:3px;margin:0;">CAR FACTORY</h1>
              </div>
              <p>Hi ${customer_name},</p>
              <p>You have a document ready for your electronic signature:</p>
              <p style="font-weight:700;font-size:18px;color:#1d4ed8;">${doc_type || "Document"}</p>
              <div style="text-align:center;margin:30px 0;">
                <a href="${signing_url}" style="display:inline-block;padding:16px 40px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:10px;font-size:18px;font-weight:700;">Review & Sign</a>
              </div>
              <p style="font-size:13px;color:#888;">This link expires in 72 hours. Your electronic signature is legally binding under the ESIGN Act and UETA.</p>
              <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
              <p style="font-size:11px;color:#aaa;text-align:center;">Car Factory &middot; 100 S Charles Richard Beall Blvd, DeBary, FL 32713</p>
            </div>
          `,
        }),
      });

      const emailData = await emailResp.json();
      if (!emailResp.ok) {
        throw new Error(emailData.message || "Email send error");
      }

      return new Response(JSON.stringify({ success: true, id: emailData.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    } else {
      throw new Error("Invalid method. Use 'sms' or 'email'.");
    }

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
