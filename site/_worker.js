const encoder = new TextEncoder();
const COOKIE_NAME = "malee_preview";
const SESSION_VALUE = "malee-preview-v1";

const OFFER_CAMPAIGN = "matching-credit-opening";
const OFFER_STARTING_REMAINING = 50;
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

// The phone number is kept the way Exsportia stores it: E.164, a "+", the country code, then the number.
// Returns "" when empty, null when it is not a plausible international number.
function cleanPhone(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (!raw.startsWith("+") || !/^\+[\d\s().-]*$/.test(raw) || digits.length < 8 || digits.length > 15) return null;
  return "+" + digits;
}

// "Same person" for the gift: lower case, no +tag, and no dots in Gmail addresses.
function emailKey(email) {
  const [local, domain = ""] = String(email).toLowerCase().split("@");
  const bare = local.split("+")[0];
  return domain === "gmail.com" || domain === "googlemail.com" ? `${bare.replace(/\./g, "")}@gmail.com` : `${bare}@${domain}`;
}

// ---- Version 5: the free class they chose, their answers, and who invited them.
const OPENING_CLASSES = ["Morning Glow", "Full Body Flow", "Beginner", "Booty & Core", "Sunset Tone", "Jumpboard"];
const INSTRUCTORS = ["Kru Yui", "Kru Nex", "Kru Leaw"];
const FIRST_FREE_DAY = "2026-10-20", LAST_FREE_DAY = "2026-11-02";

// undefined when none was sent, null when it is not one of the opening classes
function cleanClassChoice(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const pick = key => String(value[key] || "").trim();
  const choice = { name: pick("name"), date: pick("date"), time: pick("time"), end: pick("end"), trainer: pick("trainer") };
  if (!OPENING_CLASSES.includes(choice.name) || !INSTRUCTORS.includes(choice.trainer)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(choice.date) || choice.date < FIRST_FREE_DAY || choice.date > LAST_FREE_DAY) return null;
  if (!/^\d{2}:\d{2}$/.test(choice.time) || !/^\d{2}:\d{2}$/.test(choice.end)) return null;
  return choice;
}

const ANSWER_KEYS = { level: 80, island: 80, stay: 80, heard: 80, notes: 600, questions: 600 };
function cleanAnswers(value) {
  if (!value || typeof value !== "object") return undefined;
  const out = {};
  for (const [key, max] of Object.entries(ANSWER_KEYS)) {
    const text = String(value[key] || "").trim().slice(0, max);
    if (text) out[key] = text;
  }
  return Object.keys(out).length ? out : undefined;
}

// A short code for "invite a friend" links: the same person always gets the same code.
async function referralCode(key) {
  return (await digest(`ref:${key}`)).slice(0, 8);
}

const ALREADY_CLAIMED = "This email or phone number has already claimed an opening gift. Your welcome email has the details.";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function createCode() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String(values[0] % 1_000_000).padStart(6, "0");
}

const CLAIM_COLUMNS = [
  ["phone", "TEXT"],
  ["welcomed_at", "TEXT"],
  ["exsportia_status", "TEXT"],
  ["exsportia_detail", "TEXT"],
  ["email_key", "TEXT"],
  ["class_choice", "TEXT"],
  ["answers", "TEXT"],
  ["ref_code", "TEXT"],
  ["referred_by", "TEXT"],
  ["source", "TEXT"],
];

async function ensureOfferTables(db) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS opening_offer_claims (email TEXT PRIMARY KEY, name TEXT NOT NULL, code_hash TEXT NOT NULL, code_expires_at INTEGER NOT NULL, last_sent_at INTEGER NOT NULL, verified_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE TABLE IF NOT EXISTS opening_offer_inventory (campaign TEXT PRIMARY KEY, remaining INTEGER NOT NULL)"),
    db.prepare("INSERT OR IGNORE INTO opening_offer_inventory (campaign, remaining) VALUES (?1, ?2)").bind(OFFER_CAMPAIGN, OFFER_STARTING_REMAINING),
  ]);
  const { results } = await db.prepare("PRAGMA table_info(opening_offer_claims)").all();
  const have = new Set((results || []).map(column => column.name));
  for (const [name, type] of CLAIM_COLUMNS) {
    if (!have.has(name)) await db.prepare(`ALTER TABLE opening_offer_claims ADD COLUMN ${name} ${type}`).run();
  }
  // rows made before email_key existed
  const { results: old } = await db.prepare("SELECT email FROM opening_offer_claims WHERE email_key IS NULL").all();
  for (const row of old || []) await db.prepare("UPDATE opening_offer_claims SET email_key = ?1 WHERE email = ?2").bind(emailKey(row.email), row.email).run();
  // One gift per person, enforced by the database itself: a verified claim owns its email and its phone number.
  await db.batch([
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS claims_one_verified_per_email ON opening_offer_claims (email_key) WHERE verified_at IS NOT NULL"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS claims_one_verified_per_phone ON opening_offer_claims (phone) WHERE verified_at IS NOT NULL AND phone IS NOT NULL"),
  ]);
}

async function offerRemaining(db) {
  const inventory = await db.prepare("SELECT remaining FROM opening_offer_inventory WHERE campaign = ?1").bind(OFFER_CAMPAIGN).first();
  return Number(inventory?.remaining ?? 0);
}

const MAIL_FROM = "MÀLEE Pilates <hello@maleepilates.com>";

async function sendEmail(env, { to, subject, html, text }) {
  if (!env.RESEND_API_KEY) return false;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env.MAIL_FROM || MAIL_FROM, to: [to], subject, html, text, ...(env.MAIL_REPLY_TO ? { reply_to: env.MAIL_REPLY_TO } : {}) }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// ---- Exsportia: the person becomes a contact (and an account) in the venue's back office, the same way the booking app does it.
// Both routes are public by design; no staff login is involved. The link is OFF until all three settings exist:
//   EXSPORTIA_API          the server's base address
//   EXSPORTIA_VENUE_ID     the venue the contact is added to
//   EXSPORTIA_FIREBASE_KEY that environment's public Firebase web key (for the "choose your password" email)
function exsportiaConfig(env) {
  if (!env.EXSPORTIA_API || !env.EXSPORTIA_VENUE_ID || !env.EXSPORTIA_FIREBASE_KEY) return null;
  return { api: String(env.EXSPORTIA_API).replace(/\/$/, ""), venueId: String(env.EXSPORTIA_VENUE_ID), firebaseKey: String(env.EXSPORTIA_FIREBASE_KEY) };
}

function randomPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join("") + "aA1!";
}

async function exsportiaCall(url, options = {}) {
  try {
    const response = await fetch(url, { ...options, headers: { "content-type": "application/json", ...(options.headers || {}) }, signal: AbortSignal.timeout(9000) });
    let data = null;
    try { data = await response.json(); } catch { /* an empty body is fine */ }
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    return { ok: false, status: 0, data: { message: String(error && error.message || error) } };
  }
}

// Does this email already have an Exsportia account? true / false, or null when we cannot tell (link off, or the lookup failed).
async function hasExsportiaAccount(env, email) {
  const config = exsportiaConfig(env);
  if (!config) return null;
  const lookup = await exsportiaCall(`https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${config.firebaseKey}`, { method: "POST", body: JSON.stringify({ identifier: email, continueUri: "https://maleepilates.com" }) });
  return lookup.ok && lookup.data && typeof lookup.data.registered === "boolean" ? lookup.data.registered : null;
}

// Returns { status: "created" | "existing" | "partial" | "failed" | "off", passwordLink, detail }.
//   created   a new account, and the contact is confirmed in the venue
//   existing  the email already had an account; it was added to the venue as a contact
//   partial   the account was made but the contact could not be confirmed
async function addToExsportia(env, { name, email, phone, existing = false }) {
  const config = exsportiaConfig(env);
  if (!config) return { status: "off" };
  const { api, venueId, firebaseKey } = config;
  const [firstName, ...rest] = String(name).trim().split(" ");
  const account = withPhone => exsportiaCall(`${api}/users`, {
    method: "POST",
    body: JSON.stringify({ venueId, email, password: randomPassword(), firstName, lastName: rest.join(" "), name, role: ["USER"], withPassword: true, ...(withPhone ? { phone_number: withPhone } : {}) }),
  });
  // What the booking app does right after someone registers on a venue page: this always adds them to the
  // venue's contacts (registering alone only does so when the venue's settings say to).
  const addContact = () => exsportiaCall(`${api}/users/check/signIn?email=${encodeURIComponent(email)}&venueId=${encodeURIComponent(venueId)}&isAfterRegistration=true`);

  if (existing) { // the email is known to have an account: just add it to the venue's contacts
    const contact = await addContact();
    return contact.ok ? { status: "existing", detail: "existing account added as a contact" } : { status: "failed", detail: `existing account, contact step ${contact.status}` };
  }
  let result = await account(phone || "");
  let note = "";
  if (result.status === 409 && phone) { // that number belongs to another account: keep the contact, leave the number off
    result = await account("");
    note = "phone already on another account; saved without it";
  }
  if (result.ok) {
    const uid = result.data && result.data.uid;
    const contact = await addContact();
    const found = contact.ok && uid ? await exsportiaCall(`${api}/members/byVenue?venueId=${encodeURIComponent(venueId)}&userId=${encodeURIComponent(uid)}`) : null;
    const confirmed = Boolean(found && found.ok && found.data && found.data.uid);
    const reset = await exsportiaCall(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${firebaseKey}`, { method: "POST", body: JSON.stringify({ requestType: "PASSWORD_RESET", email }) });
    return {
      status: confirmed ? "created" : "partial",
      passwordLink: reset.ok,
      detail: [`uid ${uid || "?"}`, confirmed ? `contact ${found.data.uid}` : `contact not confirmed (${contact.status})`, note, reset.ok ? "" : `password email failed ${reset.status}`].filter(Boolean).join("; "),
    };
  }
  if (result.data && result.data.type === "auth/email-already-exists") { // already has an account: add them to the venue's contacts
    const contact = await addContact();
    return contact.ok ? { status: "existing", detail: "existing account added as a contact" } : { status: "failed", detail: `existing account, contact step ${contact.status}` };
  }
  return { status: "failed", detail: `${result.status} ${JSON.stringify(result.data || {}).slice(0, 300)}` };
}

// ---- The two emails. Table layout and inline styles, so they hold up in Gmail, Apple Mail and Outlook.
const INK = "#45403a", PAPER = "#fffaf7", PINK = "#f2cad4", PINK_DEEP = "#a95f73", SAGE = "#e3ecdc", BUTTER = "#f6e9bd", MUTE = "#8a7f76";
const SERIF = "'Playfair Display',Georgia,'Times New Roman',serif", SANS = "'DM Sans',Helvetica,Arial,sans-serif";

function siteUrl(env) {
  return String(env.SITE_URL || "https://maleepilates.com").replace(/\/$/, "");
}

function emailFrame(env, { preheader, body, reason }) {
  const site = siteUrl(env);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>MÀLEE Pilates</title></head>
<body style="margin:0;padding:0;background:${PAPER};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${PAPER}">${preheader}${"&nbsp;&zwnj;".repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER}"><tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:28px;border:1px solid #f0dfe3;overflow:hidden">
<tr><td align="center" style="padding:34px 24px 6px;background:${PINK};background-image:linear-gradient(100deg,${PINK},${SAGE} 55%,${BUTTER})">
<img src="${site}/img/email/logo.png" width="250" alt="MÀLEE Pilates" style="display:block;width:250px;max-width:70%;height:auto;border:0">
<p style="margin:14px 0 0;font:600 11px/1.4 ${SANS};letter-spacing:.2em;text-transform:uppercase;color:${PINK_DEEP}">Fisherman&rsquo;s Village &middot; Koh Samui</p>
<div style="height:26px;line-height:26px">&nbsp;</div></td></tr>
${body}
<tr><td align="center" style="padding:6px 28px 30px"><p style="margin:0;font:400 12px/1.7 ${SANS};color:${MUTE}">MÀLEE Pilates &middot; Fisherman&rsquo;s Village, Koh Samui<br>${reason}</p></td></tr>
</table></td></tr></table></body></html>`;
}

function codeEmail(env, { code }) {
  const body = `<tr><td align="center" style="padding:34px 32px 8px">
<p style="margin:0 0 10px;font:600 11px/1.4 ${SANS};letter-spacing:.2em;text-transform:uppercase;color:${PINK_DEEP}">Almost there</p>
<h1 style="margin:0;font:500 34px/1.15 ${SERIF};color:${INK}">Your MÀLEE code</h1>
<p style="margin:14px 0 0;font:400 16px/1.65 ${SANS};color:#675d51">Enter this code on the MÀLEE page to confirm your opening gift.</p></td></tr>
<tr><td align="center" style="padding:20px 32px 8px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:18px 30px;border-radius:18px;background:${PINK};background-image:linear-gradient(100deg,${PINK},${BUTTER});font:700 34px/1 ${SANS};letter-spacing:10px;color:#72505b">${code}</td></tr></table>
<p style="margin:16px 0 0;font:400 14px/1.6 ${SANS};color:${MUTE}">This code expires in 10 minutes. If you didn&rsquo;t ask for it, you can safely ignore this email.</p></td></tr>
<tr><td style="padding:14px 0 0"></td></tr>`;
  return {
    subject: "Your MÀLEE code",
    text: `Your MÀLEE verification code is ${code}. It expires in 10 minutes. If you didn't ask for it, ignore this email.`,
    html: emailFrame(env, { preheader: `Your MÀLEE code is ${code}`, body, reason: "You&rsquo;re receiving this because someone used this address to claim a MÀLEE opening gift." }),
  };
}

function welcomeEmail(env, { name, giftCode, account, classChoice }) {
  const site = siteUrl(env);
  const first = String(name || "").trim().split(/\s+/)[0];
  const hello = first ? escapeHtml(first) : "";
  const trainer = (file, label) => `<td width="33%" align="center" style="padding:0 5px"><img src="${site}/img/email/${file}" width="150" alt="${label}" style="display:block;width:100%;max-width:150px;height:auto;border-radius:18px;border:0"><p style="margin:8px 0 0;font:600 12px/1.3 ${SANS};color:${INK}">${label}</p></td>`;
  const when = classChoice ? new Date(`${classChoice.date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }) : "";
  const freeClass = classChoice
    ? `<tr><td style="padding:22px 28px 6px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 22px;border-radius:22px;background:${SAGE};background-image:linear-gradient(110deg,${PINK},${SAGE} 60%,${BUTTER})">
<p style="margin:0;font:600 11px/1.4 ${SANS};letter-spacing:.2em;text-transform:uppercase;color:${PINK_DEEP}">Your free class</p>
<p style="margin:8px 0 0;font:500 30px/1.15 ${SERIF};color:${INK}">${escapeHtml(classChoice.name)}</p>
<p style="margin:10px 0 0;font:600 15px/1.5 ${SANS};color:${INK}">${escapeHtml(when)} &middot; ${escapeHtml(classChoice.time)}&ndash;${escapeHtml(classChoice.end)}</p>
<p style="margin:2px 0 0;font:400 14px/1.5 ${SANS};color:#675d51">with ${escapeHtml(classChoice.trainer)}</p>
<p style="margin:14px 0 0;font:400 13px/1.6 ${SANS};color:#675d51">Please arrive 10 minutes early, and bring grip socks (they&rsquo;re also sold at the studio).</p></td></tr></table></td></tr>`
    : "";
  const gift = giftCode
    ? `<p style="margin:16px 0 4px;font:600 11px/1.4 ${SANS};letter-spacing:.18em;text-transform:uppercase;color:${PINK_DEEP}">Your gift code</p><p style="margin:0;font:700 26px/1.2 ${SANS};letter-spacing:4px;color:#72505b">${escapeHtml(giftCode)}</p><p style="margin:8px 0 0;font:400 14px/1.6 ${SANS};color:#675d51">It&rsquo;s already added to your account, so there&rsquo;s nothing to enter.</p>`
    : `<p style="margin:14px 0 0;font:400 14px/1.6 ${SANS};color:#675d51">Make your first MÀLEE purchase and we&rsquo;ll add the same value as credit to your account, to use on a future product or service.</p>`;
  const config = exsportiaConfig(env);
  const linked = Boolean(account && config && ["created", "existing", "partial"].includes(account.status));
  const accountNote = account && (account.status === "created" || account.status === "partial")
    ? `<tr><td style="padding:18px 28px 0"><div style="padding:16px 18px;border-radius:16px;background:#f2f6ee;font:400 14px/1.65 ${SANS};color:#675d51"><strong style="color:${INK}">Your MÀLEE account is ready.</strong> ${account.passwordLink ? "We&rsquo;ve sent a second email, from our booking system, with a link to choose your password." : "To choose your password, open the MÀLEE booking page and tap &ldquo;Forgot password?&rdquo;."}</div></td></tr>`
    : account && account.status === "existing"
      ? `<tr><td style="padding:18px 28px 0"><div style="padding:16px 18px;border-radius:16px;background:#f2f6ee;font:400 14px/1.65 ${SANS};color:#675d51"><strong style="color:${INK}">We found your account.</strong> You can sign in with your usual details when you book.</div></td></tr>`
      : "";
  const body = `<tr><td align="center" style="padding:34px 32px 6px">
<p style="margin:0 0 10px;font:600 11px/1.4 ${SANS};letter-spacing:.2em;text-transform:uppercase;color:${PINK_DEEP}">${hello ? `Hello ${hello}` : "Hello"}</p>
<h1 style="margin:0;font:500 38px/1.12 ${SERIF};color:${INK}">Welcome to MÀLEE.</h1>
<p style="margin:12px 0 0;font:italic 500 22px/1.35 ${SERIF};color:${PINK_DEEP}">We can&rsquo;t wait to welcome you.</p>
<p style="margin:18px 0 0;font:400 16px/1.7 ${SANS};color:#675d51">Thank you for joining our opening list. MÀLEE opens its doors on <strong style="color:${INK}">20 October 2026</strong>, and you&rsquo;ll be among the very first to step inside.</p></td></tr>
${classChoice ? freeClass : `<tr><td style="padding:22px 28px 6px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 22px;border-radius:22px;background:${SAGE};background-image:linear-gradient(110deg,${PINK},${SAGE} 60%,${BUTTER})">
<p style="margin:0;font:600 11px/1.4 ${SANS};letter-spacing:.2em;text-transform:uppercase;color:${PINK_DEEP}">Your opening gift</p>
<p style="margin:8px 0 0;font:500 28px/1.2 ${SERIF};color:${INK}">Your first move, matched.</p>${gift}</td></tr></table></td></tr>`}
${accountNote}
<tr><td style="padding:20px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="50%" valign="top" style="padding:0 5px 0 0"><div style="padding:14px 12px;border-radius:16px;background:#fbf0f2;text-align:center"><p style="margin:0;font:600 18px/1.2 ${SERIF};color:${INK}">20 October</p><p style="margin:4px 0 0;font:400 12px/1.4 ${SANS};color:${MUTE}">Doors open</p></div></td>
<td width="50%" valign="top" style="padding:0 0 0 5px"><div style="padding:14px 12px;border-radius:16px;background:#f2f6ee;text-align:center"><p style="margin:0;font:600 18px/1.2 ${SERIF};color:${INK}">Fisherman&rsquo;s Village</p><p style="margin:4px 0 0;font:400 12px/1.4 ${SANS};color:${MUTE}">Koh Samui</p></div></td></tr></table>
<p style="margin:14px 0 0;text-align:center;font:500 13px/1.6 ${SANS};color:#675d51">Reformer &middot; Mat Pilates &middot; Private sessions &middot; Mat Yoga</p></td></tr>
<tr><td align="center" style="padding:26px 28px 0"><p style="margin:0 0 14px;font:600 11px/1.4 ${SANS};letter-spacing:.2em;text-transform:uppercase;color:${PINK_DEEP}">Move with our instructors</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${trainer("kru-yui.jpg", "Kru Yui")}${trainer("kru-nex.jpg", "Kru Nex")}${trainer("kru-leaw.jpg", "Kru Leaw")}</tr></table></td></tr>
<tr><td align="center" style="padding:28px 28px 22px"><a href="${linked ? `https://wba.exsportia.com/${config.venueId}/` : `${site}/`}" style="display:inline-block;padding:15px 30px;border-radius:999px;background:#72505b;font:600 14px/1 ${SANS};color:#ffffff;text-decoration:none">${linked ? "Open your MÀLEE account" : "Visit MÀLEE"}</a></td></tr>`;
  return {
    subject: classChoice ? `Welcome to MÀLEE: your free class, ${when}` : "Welcome to MÀLEE, we can't wait to meet you",
    text: `Welcome to MÀLEE${first ? `, ${first}` : ""}.\n\nWe can't wait to welcome you. MÀLEE opens its doors on 20 October 2026 at Fisherman's Village, Koh Samui.\n\n${classChoice ? `Your free class: ${classChoice.name}, ${when}, ${classChoice.time}-${classChoice.end}, with ${classChoice.trainer}. Please arrive 10 minutes early.` : giftCode ? `Your gift code: ${giftCode}. It's already added to your account.` : "Your first move, matched: make your first MÀLEE purchase and we'll add the same value as credit to your account, to use on a future product or service."}\n\n${site}/`,
    html: emailFrame(env, { preheader: "We can’t wait to welcome you. Your opening gift is reserved.", body, reason: "You&rsquo;re receiving this because you joined the MÀLEE opening list." }),
  };
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

function isPrivate(pathname) {
  return pathname.startsWith("/preview/") || pathname.startsWith("/versions/") || /^\/v\d+\//.test(pathname);
}

// Only ever send someone back to a page on this site.
function safeNext(value) {
  const next = String(value || "");
  return next.startsWith("/") && !next.startsWith("//") && isPrivate(next) ? next : "/preview/";
}

const VERSIONS_LINK = '<a href="/versions/" style="position:fixed;left:12px;top:12px;z-index:2147483000;padding:7px 12px;border-radius:999px;background:rgba(64,58,53,.82);color:#fff;font:600 11px/1 Helvetica,Arial,sans-serif;letter-spacing:.04em;text-decoration:none">&larr; All versions</a>';

function loginPage(failed = false, next = "/preview/") {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>MÀLEE preview</title><style>body{min-height:100svh;margin:0;display:grid;place-items:center;background:#f6f1ea;color:#3b352c;font:16px/1.5 system-ui,sans-serif}.card{width:min(90vw,370px);padding:36px 28px;border-radius:28px;background:#fff;box-shadow:0 24px 70px #3b352c1c;text-align:center}.card img{width:180px;max-width:80%;margin:0 auto 26px}.eyebrow{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#8b7b64}.card h1{font:600 34px/1.05 Georgia,serif;margin:8px 0 14px}.card p{color:#675d51;margin:0 0 22px}.card label{display:block;text-align:left;font-size:13px;margin-bottom:7px}.card input{box-sizing:border-box;width:100%;border:1px solid #d8cab5;border-radius:12px;padding:13px;font:inherit}.card button{width:100%;border:0;border-radius:999px;margin-top:14px;padding:13px;background:#3b352c;color:#fff;font:600 14px system-ui,sans-serif;cursor:pointer}.error{color:#a94642;font-size:13px;margin:12px 0 0}</style></head><body><main class="card"><img src="/img/logo.webp" alt="MÀLEE Pilates"><p class="eyebrow">Private preview</p><h1>Welcome inside</h1><p>This version is shared privately while the studio prepares to open.</p><form method="post" action="/preview/login"><input type="hidden" name="next" value="${escapeHtml(next)}"><label for="password">Preview password</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus><button type="submit">Enter preview</button>${failed ? '<p class="error">That password did not match. Please try again.</p>' : ''}</form></main></body></html>`, { headers: { "Content-Type": "text/html; charset=UTF-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
}

// A claim is complete once the person is verified (by code, or because their Exsportia account already is):
// take a gift, add them to the back office, send the welcome email.
async function completeClaim(env, { email, claim, existing = false }) {
  const db = env.WAITLIST_DB;
  let marked;
  try {
    marked = await db.prepare("UPDATE opening_offer_claims SET verified_at = CURRENT_TIMESTAMP WHERE email = ?1 AND verified_at IS NULL").bind(email).run();
  } catch { // another claim with the same email or phone number was confirmed first
    return { error: ALREADY_CLAIMED, status: 409, claimed: true };
  }
  if (!marked.meta?.changes) return { error: ALREADY_CLAIMED, status: 409, claimed: true };
  const inventory = await db.prepare("UPDATE opening_offer_inventory SET remaining = remaining - 1 WHERE campaign = ?1 AND remaining > 0 RETURNING remaining").bind(OFFER_CAMPAIGN).first();
  if (!inventory) {
    await db.prepare("UPDATE opening_offer_claims SET verified_at = NULL WHERE email = ?1").bind(email).run();
    return { error: "All opening gifts have now been claimed.", status: 409 };
  }
  const account = await addToExsportia(env, { name: claim.name, email, phone: claim.phone || "", existing });
  await db.prepare("UPDATE opening_offer_claims SET exsportia_status = ?1, exsportia_detail = ?2 WHERE email = ?3").bind(account.status, account.detail || null, email).run();
  let classChoice;
  try { classChoice = claim.class_choice ? JSON.parse(claim.class_choice) : undefined; } catch { classChoice = undefined; }
  const welcomed = await sendEmail(env, { to: email, ...welcomeEmail(env, { name: claim.name, account, classChoice }) });
  if (welcomed) await db.prepare("UPDATE opening_offer_claims SET welcomed_at = CURRENT_TIMESTAMP WHERE email = ?1").bind(email).run();
  return { remaining: Number(inventory.remaining), ref: claim.ref_code || undefined };
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
        const phone = cleanPhone(body.phone);
        if (name.length < 2 || name.length > 100 || !validEmail(email)) return json({ error: "Please enter your name and a valid email address." }, 400);
        if (phone === null) return json({ error: "Please enter a valid phone number." }, 400);
        const classChoice = cleanClassChoice(body.classChoice);
        if (classChoice === null) return json({ error: "Please choose your class again." }, 400);
        const answers = cleanAnswers(body.answers);
        const referredBy = /^[0-9a-f]{8}$/.test(String(body.ref || "")) ? String(body.ref) : null;
        const source = String(body.source || "").replace(/[^a-z0-9-]/gi, "").slice(0, 20) || null;
        const extra = { class_choice: classChoice ? JSON.stringify(classChoice) : null, answers: answers ? JSON.stringify(answers) : null, referred_by: referredBy, source };
        if (await offerRemaining(env.WAITLIST_DB) < 1) return json({ error: "All opening gifts have now been claimed." }, 409);

        const key = emailKey(email);
        const refCode = await referralCode(key);
        const taken = await env.WAITLIST_DB.prepare("SELECT email FROM opening_offer_claims WHERE verified_at IS NOT NULL AND (email_key = ?1 OR (?2 IS NOT NULL AND phone = ?2)) LIMIT 1").bind(key, phone || null).first();
        if (taken) return json({ error: ALREADY_CLAIMED, claimed: true }, 409);
        // Already an Exsportia account? Then there is nothing to verify and no password to make: add them straight away.
        if (await hasExsportiaAccount(env, email) === true) {
          await env.WAITLIST_DB.prepare(
            "INSERT INTO opening_offer_claims (email, name, phone, email_key, ref_code, class_choice, answers, referred_by, source, code_hash, code_expires_at, last_sent_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'existing-account', 0, ?10) ON CONFLICT(email) DO UPDATE SET name = excluded.name, phone = COALESCE(excluded.phone, opening_offer_claims.phone), email_key = excluded.email_key, ref_code = excluded.ref_code, class_choice = excluded.class_choice, answers = excluded.answers, referred_by = COALESCE(opening_offer_claims.referred_by, excluded.referred_by), source = excluded.source, code_hash = 'existing-account', code_expires_at = 0",
          ).bind(email, name, phone || null, key, refCode, extra.class_choice, extra.answers, extra.referred_by, extra.source, Date.now()).run();
          const done = await completeClaim(env, { email, claim: { name, phone: phone || "", class_choice: extra.class_choice, ref_code: refCode }, existing: true });
          if (done.error) return json({ error: done.error, ...(done.claimed ? { claimed: true } : {}) }, done.status);
          return json({ verified: true, existing: true, remaining: done.remaining, ref: done.ref });
        }
        const current = await env.WAITLIST_DB.prepare("SELECT last_sent_at FROM opening_offer_claims WHERE email = ?1").bind(email).first();
        const now = Date.now();
        if (current && now - Number(current.last_sent_at) < OTP_RESEND_DELAY_MS) return json({ error: "Please wait a minute before requesting another code." }, 429);

        const code = createCode();
        await env.WAITLIST_DB.prepare(
          "INSERT INTO opening_offer_claims (email, name, phone, email_key, ref_code, class_choice, answers, referred_by, source, code_hash, code_expires_at, last_sent_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12) ON CONFLICT(email) DO UPDATE SET name = excluded.name, phone = COALESCE(excluded.phone, opening_offer_claims.phone), email_key = excluded.email_key, ref_code = excluded.ref_code, class_choice = excluded.class_choice, answers = excluded.answers, referred_by = COALESCE(opening_offer_claims.referred_by, excluded.referred_by), source = excluded.source, code_hash = excluded.code_hash, code_expires_at = excluded.code_expires_at, last_sent_at = excluded.last_sent_at",
        ).bind(email, name, phone || null, key, refCode, extra.class_choice, extra.answers, extra.referred_by, extra.source, await digest(`${email}:${code}`), now + OTP_LIFETIME_MS, now).run();

        const sent = await sendEmail(env, { to: email, ...codeEmail(env, { code }) });
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

        const claim = await env.WAITLIST_DB.prepare("SELECT name, phone, class_choice, ref_code, code_hash, code_expires_at, verified_at FROM opening_offer_claims WHERE email = ?1").bind(email).first();
        if (!claim) return json({ error: "Request a new verification code and try again." }, 404);
        if (claim.verified_at) return json({ error: ALREADY_CLAIMED, claimed: true }, 409);
        if (Date.now() > Number(claim.code_expires_at)) return json({ error: "That code has expired. Request a new one to continue." }, 400);
        if (!constantTimeEqual(String(claim.code_hash), await digest(`${email}:${code}`))) return json({ error: "That code did not match. Please try again." }, 400);

        const done = await completeClaim(env, { email, claim });
        if (done.error) return json({ error: done.error, ...(done.claimed ? { claimed: true } : {}) }, done.status);
        return json({ verified: true, remaining: done.remaining, ...(done.ref ? { ref: done.ref } : {}) });
      }

      return json({ error: "Not found." }, 404);
    }

    // Private: the full-site preview, every landing version (/v1, /v2 …) and their index. One password opens them all.
    if (url.pathname === "/preview" || url.pathname === "/versions" || /^\/v\d+$/.test(url.pathname)) return Response.redirect(new URL(`${url.pathname}/`, url), 302);
    const oldVersion = url.pathname.match(/^\/preview\/versions\/(v\d+\/)?/); // where the versions used to live
    if (oldVersion) return Response.redirect(new URL(oldVersion[1] ? `/${oldVersion[1]}` : "/versions/", url), 301);

    if (url.pathname === "/preview/login" && request.method === "POST") {
      const body = await request.formData();
      const candidate = String(body.get("password") || "");
      const next = safeNext(body.get("next"));
      const valid = password && constantTimeEqual(await digest(candidate), await digest(password));
      if (!valid) return loginPage(true, next);
      const session = await signSession(password);
      return new Response(null, { status: 303, headers: { Location: next, "Set-Cookie": `${COOKIE_NAME}=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`, "Cache-Control": "no-store" } });
    }

    if (isPrivate(url.pathname)) {
      if (!await previewIsUnlocked(request, password)) return loginPage(false, url.pathname);
      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      headers.set("X-Robots-Tag", "noindex, nofollow");
      headers.set("Cache-Control", "private, no-store");
      const page = new Response(response.body, { status: response.status, statusText: response.statusText, headers });
      // a way back to the list from any version page
      const isVersion = /^\/v\d+\/$/.test(url.pathname) && typeof HTMLRewriter !== "undefined" && (headers.get("content-type") || "").includes("text/html");
      return isVersion ? new HTMLRewriter().on("body", { element: body => body.append(VERSIONS_LINK, { html: true }) }).transform(page) : page;
    }

    return env.ASSETS.fetch(request);
  },
};
