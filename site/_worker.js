const encoder = new TextEncoder();
const COOKIE_NAME = "malee_preview";
const SESSION_VALUE = "malee-preview-v1";

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
