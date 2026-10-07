const encoder = new TextEncoder();
const COOKIE_NAME = "malee_preview";
const SESSION_VALUE = "malee-preview-v1";

const OFFER_CAMPAIGN = "matching-credit-opening";
const OFFER_STARTING_REMAINING = 23;
const OTP_LIFETIME_MS = 10 * 60 * 1000;
const OTP_RESEND_DELAY_MS = 60 * 1000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=UTF-8", "Cache-Control": "no-store" },
  });
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function createCode() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String(values[0] % 1_000_000).padStart(6, "0");
}

async function ensureOfferTables(db) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS opening_offer_claims (email TEXT PRIMARY KEY, name TEXT NOT NULL, code_hash TEXT NOT NULL, code_expires_at INTEGER NOT NULL, last_sent_at INTEGER NOT NULL, verified_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE TABLE IF NOT EXISTS opening_offer_inventory (campaign TEXT PRIMARY KEY, remaining INTEGER NOT NULL)"),
    db.prepare("INSERT OR IGNORE INTO opening_offer_inventory (campaign, remaining) VALUES (?1, ?2)").bind(OFFER_CAMPAIGN, OFFER_STARTING_REMAINING),
  ]);
}

async function offerRemaining(db) {
  const inventory = await db.prepare("SELECT remaining FROM opening_offer_inventory WHERE campaign = ?1").bind(OFFER_CAMPAIGN).first();
  return Number(inventory?.remaining ?? 0);
}

async function sendEmail({ to, subject, html, text }) {
  const response = await fetch("https://api.mailchannels.net/tx/v1/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: "hello@maleepilates.com", name: "MÀLEE Pilates" },
      subject,
      content: [
        { type: "text/plain", value: text },
        { type: "text/html", value: html },
      ],
    }),
  });
  return response.ok;
}

function emailShell(content) {
  return `<!doctype html><html lang="en"><body style="margin:0;background:#fff8f7;color:#403a35;font:16px/1.55 Arial,sans-serif"><main style="max-width:520px;margin:0 auto;padding:42px 30px"><p style="margin:0 0 20px;color:#9e5267;font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase">MÀLEE PILATES · FISHERMAN'S VILLAGE</p>${content}<p style="margin:28px 0 0;color:#887b73;font-size:12px">MÀLEE Pilates · Coming Soon Samui</p></main></body></html>`;
}

function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function digest(value) {
  return bytesToHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function signSession(secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToHex(await crypto.subtle.sign("HMAC", key, encoder.encode(SESSION_VALUE)));
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  return cookie.split(";").map(item => item.trim()).find(item => item.startsWith(`${name}=`))?.slice(name.length + 1);
}

async function previewIsUnlocked(request, password) {
  const supplied = getCookie(request, COOKIE_NAME);
  if (!supplied || !password) return false;
  return constantTimeEqual(supplied, await signSession(password));
}

function loginPage(failed = false) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>MÀLEE preview</title><style>body{min-height:100svh;margin:0;display:grid;place-items:center;background:#f6f1ea;color:#3b352c;font:16px/1.5 system-ui,sans-serif}.card{width:min(90vw,370px);padding:36px 28px;border-radius:28px;background:#fff;box-shadow:0 24px 70px #3b352c1c;text-align:center}.card img{width:180px;max-width:80%;margin:0 auto 26px}.eyebrow{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#8b7b64}.card h1{font:600 34px/1.05 Georgia,serif;margin:8px 0 14px}.card p{color:#675d51;margin:0 0 22px}.card label{display:block;text-align:left;font-size:13px;margin-bottom:7px}.card input{box-sizing:border-box;width:100%;border:1px solid #d8cab5;border-radius:12px;padding:13px;font:inherit}.card button{width:100%;border:0;border-radius:999px;margin-top:14px;padding:13px;background:#3b352c;color:#fff;font:600 14px system-ui,sans-serif;cursor:pointer}.error{color:#a94642;font-size:13px;margin:12px 0 0}</style></head><body><main class="card"><img src="/img/logo.webp" alt="MÀLEE Pilates"><p class="eyebrow">Private preview</p><h1>Welcome inside</h1><p>This version is shared privately while the studio prepares to open.</p><form method="post" action="/preview/login"><label for="password">Preview password</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus><button type="submit">Enter preview</button>${failed ? '<p class="error">That password did not match. Please try again.</p>' : ''}</form></main></body></html>`, { headers: { "Content-Type": "text/html; charset=UTF-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const password = env.PREVIEW_PASSWORD;

    if (url.pathname.startsWith("/offer/")) {
      if (!env.WAITLIST_DB) return json({ error: "The opening list is being prepared. Please try again in a moment." }, 503);
      await ensureOfferTables(env.WAITLIST_DB);

      if (url.pathname === "/offer/status" && request.method === "GET") {
        return json({ remaining: await offerRemaining(env.WAITLIST_DB) });
      }

      if (url.pathname === "/offer/start" && request.method === "POST") {
        let body;
        try { body = await request.json(); } catch { return json({ error: "Please enter your name and email address." }, 400); }
        const name = String(body.name || "").trim().replace(/\s+/g, " ");
        const email = String(body.email || "").trim().toLowerCase();
        if (name.length < 2 || name.length > 100 || !validEmail(email)) return json({ error: "Please enter your name and a valid email address." }, 400);
        if (await offerRemaining(env.WAITLIST_DB) < 1) return json({ error: "All opening gifts have now been claimed." }, 409);

        const current = await env.WAITLIST_DB.prepare("SELECT verified_at, last_sent_at FROM opening_offer_claims WHERE email = ?1").bind(email).first();
        if (current?.verified_at) return json({ verified: true, remaining: await offerRemaining(env.WAITLIST_DB) });
        const now = Date.now();
        if (current && now - Number(current.last_sent_at) < OTP_RESEND_DELAY_MS) return json({ error: "Please wait a minute before requesting another code." }, 429);

        const code = createCode();
        await env.WAITLIST_DB.prepare(
          "INSERT INTO opening_offer_claims (email, name, code_hash, code_expires_at, last_sent_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(email) DO UPDATE SET name = excluded.name, code_hash = excluded.code_hash, code_expires_at = excluded.code_expires_at, last_sent_at = excluded.last_sent_at",
        ).bind(email, name, await digest(`${email}:${code}`), now + OTP_LIFETIME_MS, now).run();

        const sent = await sendEmail({
          to: email,
          subject: "Your MÀLEE opening gift code",
          text: `Your MÀLEE opening gift verification code is ${code}. It expires in 10 minutes.`,
          html: emailShell(`<h1 style="margin:0;font:500 34px Georgia,serif">Your MÀLEE code</h1><p style="color:#6f635c">Enter this code on the MÀLEE opening page to confirm your special opening gift.</p><p style="margin:28px 0;padding:17px;border-radius:14px;background:#f8dadd;color:#963f58;font-size:28px;font-weight:bold;letter-spacing:8px;text-align:center">${code}</p><p style="color:#6f635c">This code expires in 10 minutes.</p>`),
        });
        if (!sent) {
          await env.WAITLIST_DB.prepare("UPDATE opening_offer_claims SET last_sent_at = 0 WHERE email = ?1").bind(email).run();
          return json({ error: "We could not send your verification email. Please try again shortly." }, 502);
        }
        return json({ sent: true });
      }

      if (url.pathname === "/offer/verify" && request.method === "POST") {
        let body;
        try { body = await request.json(); } catch { return json({ error: "Please enter the code from your email." }, 400); }
        const email = String(body.email || "").trim().toLowerCase();
        const code = String(body.code || "").replace(/\D/g, "");
        if (!validEmail(email) || !/^\d{6}$/.test(code)) return json({ error: "Enter the six-digit code from your email." }, 400);

        const claim = await env.WAITLIST_DB.prepare("SELECT name, code_hash, code_expires_at, verified_at FROM opening_offer_claims WHERE email = ?1").bind(email).first();
        if (!claim) return json({ error: "Request a new verification code and try again." }, 404);
        if (claim.verified_at) return json({ verified: true, remaining: await offerRemaining(env.WAITLIST_DB) });
        if (Date.now() > Number(claim.code_expires_at)) return json({ error: "That code has expired. Request a new one to continue." }, 400);
        if (!constantTimeEqual(String(claim.code_hash), await digest(`${email}:${code}`))) return json({ error: "That code did not match. Please try again." }, 400);

        const marked = await env.WAITLIST_DB.prepare("UPDATE opening_offer_claims SET verified_at = CURRENT_TIMESTAMP WHERE email = ?1 AND verified_at IS NULL").bind(email).run();
        if (!marked.meta?.changes) return json({ verified: true, remaining: await offerRemaining(env.WAITLIST_DB) });
        const inventory = await env.WAITLIST_DB.prepare("UPDATE opening_offer_inventory SET remaining = remaining - 1 WHERE campaign = ?1 AND remaining > 0 RETURNING remaining").bind(OFFER_CAMPAIGN).first();
        if (!inventory) {
          await env.WAITLIST_DB.prepare("UPDATE opening_offer_claims SET verified_at = NULL WHERE email = ?1").bind(email).run();
          return json({ error: "All opening gifts have now been claimed." }, 409);
        }

        await sendEmail({
          to: email,
          subject: "Your MÀLEE opening gift is confirmed",
          text: `You’re confirmed, ${claim.name}. Once you make your first MÀLEE booking or purchase, we’ll add matching credit to your account to use on a future product or service.`,
          html: emailShell(`<h1 style="margin:0;font:500 34px Georgia,serif">Your opening gift is confirmed.</h1><p style="color:#6f635c">You’re confirmed, ${escapeHtml(claim.name)}.</p><p style="padding:17px;border-radius:14px;background:#f8dadd;color:#7b4051">Once you make your first MÀLEE booking or purchase, we’ll add matching credit to your account to use on a future product or service.</p>`),
        });
        return json({ verified: true, remaining: Number(inventory.remaining) });
      }

      return json({ error: "Not found." }, 404);
    }

    if (url.pathname === "/preview") return Response.redirect(new URL("/preview/", url), 302);

    if (url.pathname === "/preview/login" && request.method === "POST") {
      const body = await request.formData();
      const candidate = String(body.get("password") || "");
      const valid = password && constantTimeEqual(await digest(candidate), await digest(password));
      if (!valid) return loginPage(true);
      const session = await signSession(password);
      return new Response(null, { status: 303, headers: { Location: "/preview/", "Set-Cookie": `${COOKIE_NAME}=${session}; Path=/preview; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`, "Cache-Control": "no-store" } });
    }

    if (url.pathname.startsWith("/preview/")) {
      if (!await previewIsUnlocked(request, password)) return loginPage();
      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      headers.set("X-Robots-Tag", "noindex, nofollow");
      headers.set("Cache-Control", "private, no-store");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }

    return env.ASSETS.fetch(request);
  },
};
