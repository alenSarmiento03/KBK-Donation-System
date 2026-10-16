const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type SubmissionType = "assistance" | "feedback";

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

class SubmissionTooLargeError extends Error {}

async function readJsonWithinLimit(request: Request, maxBytes: number) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing request body.");

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new SubmissionTooLargeError("Submission is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function getSupabaseSecretKey() {
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys) as Record<string, string>;
      if (parsed.default) return parsed.default;
    } catch {
      // Fall back to the legacy injected key below.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

function clientIp(request: Request) {
  const direct = request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip");
  if (direct) return direct.trim();
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded ? forwarded.split(",").at(-1)?.trim() || "" : "";
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function validContact(value: string) {
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  const phone = /^\+?[0-9 ().-]{7,20}$/.test(value)
    && value.replace(/[^0-9]/g, "").length >= 7
    && value.replace(/[^0-9]/g, "").length <= 15;
  return value.length >= 7 && value.length <= 160 && (email || phone);
}

function validateSubmission(type: SubmissionType, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const name = typeof record.requester_name === "string" ? record.requester_name.trim() : "";
  const contact = typeof record.contact === "string" ? record.contact.trim() : "";
  if (name.length > 120 || !validContact(contact)) return null;

  if (type === "assistance") {
    const allowedTypes = ["Food", "Education", "Medical", "Emergency", "Other"];
    const assistanceType = typeof record.assistance_type === "string" ? record.assistance_type : "";
    const description = typeof record.description === "string" ? record.description.trim() : "";
    const quantity = typeof record.quantity === "string" ? record.quantity.trim() : "";
    if (!name || record.lgu_attestation !== true || !allowedTypes.includes(assistanceType) || description.length < 10 || description.length > 1500 || quantity.length > 120) return null;
    return {
      table: "kbk_assistance_requests",
      row: {
        requester_name: name || null,
        contact,
        assistance_type: assistanceType,
        description,
        quantity: quantity || null,
      },
    };
  }

  const subject = typeof record.subject === "string" ? record.subject.trim() : "";
  const message = typeof record.message === "string" ? record.message.trim() : "";
  if (subject.length < 1 || subject.length > 160 || message.length < 10 || message.length > 2000) return null;
  return {
    table: "kbk_public_feedback_messages",
    row: { requester_name: name || null, contact, subject, message },
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);
  const maxRequestBytes = 12000;
  if (Number(request.headers.get("content-length") || 0) > maxRequestBytes) {
    return jsonResponse({ error: "Submission is too large." }, 413);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await readJsonWithinLimit(request, maxRequestBytes) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SubmissionTooLargeError) {
      return jsonResponse({ error: "Submission is too large." }, 413);
    }
    return jsonResponse({ error: "Invalid submission." }, 400);
  }
  const type = payload.type;
  if (type !== "assistance" && type !== "feedback") return jsonResponse({ error: "Invalid submission type." }, 400);
  if (typeof payload.token !== "string" || payload.token.length < 1 || payload.token.length > 2048) {
    return jsonResponse({ error: "Complete the security check and try again." }, 400);
  }
  const cleanSubmission = validateSubmission(type, payload.request);
  if (!cleanSubmission) return jsonResponse({ error: "Check the form fields and try again." }, 400);

  const turnstileSecret = Deno.env.get("TURNSTILE_SECRET_KEY");
  const allowedHosts = (Deno.env.get("KBK_TURNSTILE_HOSTNAMES") || "")
    .split(",").map(host => host.trim().toLowerCase()).filter(Boolean);
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/+$/, "");
  const supabaseKey = getSupabaseSecretKey();
  if (!turnstileSecret || !allowedHosts.length || !supabaseUrl || !supabaseKey) {
    console.error("Public submission security is not configured.");
    return jsonResponse({ error: "Online submissions are temporarily unavailable." }, 503);
  }

  const ip = clientIp(request);
  if (!ip) {
    console.error("Public submission request did not include a client IP address.");
    return jsonResponse({ error: "Online submissions are temporarily unavailable. Please try again later." }, 503);
  }
  let verification: { success?: boolean; hostname?: string };
  try {
    const siteVerify = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret: turnstileSecret,
        response: payload.token,
        ...(ip ? { remoteip: ip } : {}),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!siteVerify.ok) throw new Error(`Siteverify returned ${siteVerify.status}`);
    verification = await siteVerify.json();
  } catch (error) {
    console.error("Turnstile verification service failed.", error);
    return jsonResponse({ error: "The security check is temporarily unavailable. Please try again." }, 503);
  }
  if (!verification.success || !verification.hostname || !allowedHosts.includes(verification.hostname.toLowerCase())) {
    return jsonResponse({ error: "Security check failed. Please complete it again." }, 400);
  }

  try {
    const fingerprint = await sha256(ip);
    const limitResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/kbk_consume_submission_limit`, {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_fingerprint: fingerprint, p_submission_type: type }),
      signal: AbortSignal.timeout(8000),
    });
    if (!limitResponse.ok) throw new Error(`Rate-limit check returned ${limitResponse.status}`);
    if (await limitResponse.json() !== true) return jsonResponse({ error: "Too many submissions. Please try again later." }, 429);
  } catch (error) {
    console.error("Public submission rate-limit check failed.", error);
    return jsonResponse({ error: "Online submissions are temporarily unavailable. Please try again later." }, 503);
  }

  try {
    const insertResponse = await fetch(`${supabaseUrl}/rest/v1/${cleanSubmission.table}`, {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        "Content-Profile": "public",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(cleanSubmission.row),
      signal: AbortSignal.timeout(8000),
    });
    if (!insertResponse.ok) {
      console.error(`Inbox insert failed with status ${insertResponse.status}.`);
      return jsonResponse({ error: "We could not save your submission. Please try again later." }, 502);
    }
  } catch (error) {
    console.error("Public inbox insert failed.", error);
    return jsonResponse({ error: "We could not save your submission. Please try again later." }, 502);
  }
  return jsonResponse({ ok: true });
});
