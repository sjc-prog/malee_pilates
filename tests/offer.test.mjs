import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import worker from '../site/_worker.js';

/* A stand-in for Cloudflare D1, backed by SQLite in memory. */
function fakeD1(db = new DatabaseSync(':memory:')) {
  const statement = sql => {
    let args = [];
    const self = {
      bind: (...values) => { args = values; return self; },
      first: async () => db.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: db.prepare(sql).all(...args) }),
      run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
    };
    return self;
  };
  return { db, prepare: statement, batch: async list => { for (const item of list) await item.run(); } };
}

const env = db => ({ WAITLIST_DB: db, RESEND_API_KEY: 'test-key', ASSETS: { fetch: async () => new Response('asset') } });
const post = (path, body) => new Request(`https://maleepilates.com${path}`, { method: 'POST', body: JSON.stringify(body) });

/* Capture everything sent to Resend; `ok` decides whether the send succeeds. */
function fakeResend(ok = true) {
  const sent = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(options.headers.authorization, 'Bearer test-key');
    sent.push(JSON.parse(options.body));
    return new Response('{}', { status: ok ? 200 : 401 });
  };
  return { sent, restore: () => { globalThis.fetch = original; } };
}

test('sign-up: the code email, then the welcome email, with the phone number kept', async () => {
  const d1 = fakeD1(), resend = fakeResend();
  try {
    const start = await worker.fetch(post('/offer/start', { name: 'Justin Cohen', email: 'Justin@Example.com', phone: '+66 81 234 5678' }), env(d1));
    assert.equal(start.status, 200);
    assert.deepEqual(await start.json(), { sent: true });
    assert.equal(resend.sent.length, 1);
    const [codeMail] = resend.sent;
    assert.equal(codeMail.from, 'MÀLEE Pilates <hello@maleepilates.com>');
    assert.deepEqual(codeMail.to, ['justin@example.com']);
    assert.equal(codeMail.subject, 'Your MÀLEE code');
    const code = codeMail.text.match(/\b(\d{6})\b/)[1];
    assert.ok(codeMail.html.includes(code) && codeMail.html.includes('/img/email/logo.png'));

    const row = d1.db.prepare('SELECT * FROM opening_offer_claims').get();
    assert.equal(row.phone, '+66812345678');
    assert.equal(row.verified_at, null);

    const wrong = await worker.fetch(post('/offer/verify', { email: 'justin@example.com', code: code === '000000' ? '111111' : '000000' }), env(d1));
    assert.equal(wrong.status, 400);
    assert.equal(resend.sent.length, 1, 'a wrong code sends nothing');

    const right = await worker.fetch(post('/offer/verify', { email: 'justin@example.com', code }), env(d1));
    assert.equal(right.status, 200);
    assert.deepEqual(await right.json(), { verified: true, remaining: 22 });
    assert.equal(resend.sent.length, 2);
    const welcome = resend.sent[1];
    assert.deepEqual(welcome.to, ['justin@example.com']);
    assert.match(welcome.subject, /^Welcome to MÀLEE/);
    assert.ok(welcome.html.includes('Welcome to MÀLEE.') && welcome.html.includes('We can&rsquo;t wait to welcome you.') && welcome.html.includes('Hello Justin'));
    assert.ok(!welcome.html.includes('Your gift code'), 'no gift code is claimed until one is attached');
    assert.ok(d1.db.prepare('SELECT welcomed_at FROM opening_offer_claims').get().welcomed_at);

    const again = await worker.fetch(post('/offer/verify', { email: 'justin@example.com', code }), env(d1));
    assert.deepEqual(await again.json(), { verified: true, remaining: 22 });
    assert.equal(resend.sent.length, 2, 'confirming twice does not send a second welcome');

    mkdirSync(new URL('../.tmp/', import.meta.url), { recursive: true });
    writeFileSync(new URL('../.tmp/email-code.html', import.meta.url), codeMail.html);
    writeFileSync(new URL('../.tmp/email-welcome.html', import.meta.url), welcome.html);
  } finally { resend.restore(); }
});

test('the phone number is optional but must be plausible', async () => {
  const d1 = fakeD1(), resend = fakeResend();
  try {
    const bad = await worker.fetch(post('/offer/start', { name: 'Test Person', email: 'a@example.com', phone: 'call me' }), env(d1));
    assert.equal(bad.status, 400);
    const ok = await worker.fetch(post('/offer/start', { name: 'Test Person', email: 'a@example.com' }), env(d1));
    assert.equal(ok.status, 200);
    assert.equal(d1.db.prepare('SELECT phone FROM opening_offer_claims').get().phone, null);
  } finally { resend.restore(); }
});

test('a failed send says so and lets the person ask again straight away', async () => {
  const d1 = fakeD1(), resend = fakeResend(false);
  try {
    const res = await worker.fetch(post('/offer/start', { name: 'Test Person', email: 'b@example.com' }), env(d1));
    assert.equal(res.status, 502);
    assert.equal(d1.db.prepare('SELECT last_sent_at FROM opening_offer_claims').get().last_sent_at, 0);
  } finally { resend.restore(); }
  const none = await worker.fetch(post('/offer/start', { name: 'Test Person', email: 'c@example.com' }), { ...env(d1), RESEND_API_KEY: undefined });
  assert.equal(none.status, 502, 'with no mail key configured the form fails visibly instead of pretending');
});

test('a table made before the phone column existed is upgraded in place', async () => {
  const d1 = fakeD1();
  d1.db.exec("CREATE TABLE opening_offer_claims (email TEXT PRIMARY KEY, name TEXT NOT NULL, code_hash TEXT NOT NULL, code_expires_at INTEGER NOT NULL, last_sent_at INTEGER NOT NULL, verified_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  d1.db.exec("INSERT INTO opening_offer_claims (email, name, code_hash, code_expires_at, last_sent_at) VALUES ('old@example.com', 'Old Row', 'x', 0, 0)");
  const res = await worker.fetch(new Request('https://maleepilates.com/offer/status'), env(d1));
  assert.equal(res.status, 200);
  const columns = d1.db.prepare('PRAGMA table_info(opening_offer_claims)').all().map(c => c.name);
  for (const name of ['phone', 'welcomed_at', 'exsportia_status', 'exsportia_detail']) assert.ok(columns.includes(name), name);
  assert.equal(d1.db.prepare('SELECT name FROM opening_offer_claims').get().name, 'Old Row');
});
