// Auth-login edge function.
//
// Receives { username, pin } from the PWA. Verifies the PIN against the bcrypt
// pin_hash via the verify_employee_pin RPC (server-side, never exposes hash).
// On success, signs and returns a JWT compatible with Supabase RLS — claims
// `role: authenticated` so PostgREST treats the request as logged-in, plus
// custom claims (`is_owner`, `app_role`, `username`, `name`, `emp_location`)
// available to RLS policies via auth.jwt()->>'<claim>'.
//
// Required env (set in Supabase dashboard → Edge Functions → auth-login → Secrets):
//   SUPABASE_URL              auto-populated by Supabase
//   SUPABASE_SERVICE_ROLE_KEY auto-populated by Supabase
//   CF_JWT_SECRET             set manually via `supabase secrets set` —
//                             must NOT start with SUPABASE_ (CLI rejects).
//                             Value = the legacy HS256 JWT secret from
//                             Settings → API → JWT Settings.
//
// JWT lifetime: 7 days. PWA detects 401 from any Supabase call → kicks to login.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const JWT_SECRET = Deno.env.get("CF_JWT_SECRET") ?? "";

const OWNERS = new Set(["vlad", "tommy"]); // hardcoded list mirrors index.html

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const JWT_LIFETIME_SECONDS = 7 * 24 * 60 * 60; // 7 days

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

interface EmployeeRow {
  id: number;
  name: string;
  username: string;
  role: string | null;
  location: string | null;
}

async function verifyPin(username: string, pin: string): Promise<EmployeeRow | null> {
  // Call the SECURITY DEFINER RPC which verifies via pgcrypto crypt().
  const resp = await fetch(`${SB_URL}/rest/v1/rpc/verify_employee_pin`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_username: username, p_pin: pin }),
  });
  if (!resp.ok) {
    console.error("verify_employee_pin RPC failed", resp.status, await resp.text());
    return null;
  }
  const rows = await resp.json();
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0] as EmployeeRow;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (!SB_URL || !SERVICE_KEY || !JWT_SECRET) {
    console.error("auth-login misconfigured: missing env vars");
    return jsonResponse({ error: "Auth service unavailable" }, 500);
  }

  let payload: { username?: string; pin?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const username = (payload.username ?? "").toString().trim().toLowerCase();
  const pin = (payload.pin ?? "").toString();
  if (!username || !pin) {
    return jsonResponse({ error: "Username and PIN required" }, 400);
  }
  if (pin.length > 64 || username.length > 64) {
    return jsonResponse({ error: "Invalid input" }, 400);
  }

  const emp = await verifyPin(username, pin);
  if (!emp) {
    // Constant-ish delay to mute timing attacks on existence-vs-wrong-pin.
    await new Promise((r) => setTimeout(r, 250));
    return jsonResponse({ error: "Invalid username or PIN" }, 401);
  }

  const isOwner = OWNERS.has(emp.username.toLowerCase());
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    aud: "authenticated",
    role: "authenticated", // PostgREST DB role
    sub: String(emp.id),
    iat: now,
    exp: now + JWT_LIFETIME_SECONDS,
    // App-specific claims (read in RLS via auth.jwt()->>'<key>'):
    app_role: emp.role ?? "employee",
    is_owner: isOwner,
    username: emp.username,
    name: emp.name,
    emp_location: emp.location ?? null,
  };

  let token: string;
  try {
    const key = await importHmacKey(JWT_SECRET);
    token = await create({ alg: "HS256", typ: "JWT" }, claims, key);
  } catch (err) {
    console.error("JWT signing failed", err);
    return jsonResponse({ error: "Token issuance failed" }, 500);
  }

  return jsonResponse({
    token,
    expires_at: claims.exp,
    user: {
      id: emp.id,
      name: emp.name,
      username: emp.username,
      role: emp.role ?? "employee",
      location: emp.location,
      is_owner: isOwner,
    },
  });
});
