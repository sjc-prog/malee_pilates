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

const BACK_OFFICE = { EXSPORTIA_API: 'https://backoffice.test/api', EXSPORTIA_VENUE_ID: '1234', EXSPORTIA_FIREBASE_KEY: 'firebase-key' };
const REGISTERED = url => url.includes('createAuthUri');
const env = (db, extra = {}) => ({ WAITLIST_DB: db, RESEND_API_KEY: 'test-key', ASSETS: { fetch: async () => new Response('asset') }, ...extra });
const post = (path, body) => new Request(`https://maleepilates.com${path}`, { method: 'POST', body: JSON.stringify(body) });
const reply = (status, body = {}) => new Response(JSON.stringify(body), { status });

/* Everything the Worker sends out is recorded. `backOffice(url, body)` answers calls to the (fake) Exsportia server. */
function fakeNetwork({ resendOk = true, backOffice = () => reply(200, { uid: 'u1' }) } = {}) {
  const mail = [], calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    if (url === 'https://api.resend.com/emails') {
      assert.equal(options.headers.authorization, 'Bearer test-key');
      mail.push(body);
      return reply(resendOk ? 200 : 401);
    }
    calls.push({ url: String(url), method: options.method || 'GET', body });
    return backOffice(String(url), body);
  };
  return { mail, calls, restore: () => { globalThis.fetch = original; } };
}

/* Claim a gift end to end; returns the response to the final confirmation. */
async function claim(d1, net, { name = 'Justin Cohen', email = 'justin@example.com', phone = '+66812345678' } = {}, extra = {}) {
  const before = net.mail.length;
  const start = await worker.fetch(post('/offer/start', { name, email, phone }), env(d1, extra));
  if (start.status !== 200) return start;
  const code = net.mail[before].text.match(/\b(\d{6})\b/)[1];
  return worker.fetch(post('/offer/verify', { email, code }), env(d1, extra));
}

test('sign-up: the code email, then the welcome email, with the phone number kept', async () => {
  const d1 = fakeD1(), net = fakeNetwork();
  try {
    const start = await worker.fetch(post('/offer/start', { name: 'Justin Cohen', email: 'Justin@Example.com', phone: '+66 81 234 5678' }), env(d1));
    assert.equal(start.status, 200);
    assert.deepEqual(await start.json(), { sent: true });
    const [codeMail] = net.mail;
    assert.equal(codeMail.from, 'MÀLEE Pilates <hello@maleepilates.com>');
    assert.deepEqual(codeMail.to, ['justin@example.com']);
    assert.equal(codeMail.subject, 'Your MÀLEE code');
    const code = codeMail.text.match(/\b(\d{6})\b/)[1];
    assert.ok(codeMail.html.includes(code) && codeMail.html.includes('/img/email/logo.png'));
    assert.equal(d1.db.prepare('SELECT phone FROM opening_offer_claims').get().phone, '+66812345678');

    const wrong = await worker.fetch(post('/offer/verify', { email: 'justin@example.com', code: code === '000000' ? '111111' : '000000' }), env(d1));
    assert.equal(wrong.status, 400);
    assert.equal(net.mail.length, 1, 'a wrong code sends nothing');

    const right = await worker.fetch(post('/offer/verify', { email: 'justin@example.com', code }), env(d1));
    assert.equal(right.status, 200);
    assert.deepEqual(await right.json(), { verified: true, remaining: 49 });
    const welcome = net.mail[1];
    assert.deepEqual(welcome.to, ['justin@example.com']);
    assert.match(welcome.subject, /^Welcome to MÀLEE/);
    assert.ok(welcome.html.includes('Welcome to MÀLEE.') && welcome.html.includes('We can&rsquo;t wait to welcome you.') && welcome.html.includes('Hello Justin'));
    assert.ok(!welcome.html.includes('Your gift code'), 'no gift code is claimed until one is attached');
    assert.ok(!welcome.html.includes('account is ready'), 'no account is claimed while the back-office link is off');
    const row = d1.db.prepare('SELECT * FROM opening_offer_claims').get();
    assert.ok(row.welcomed_at);
    assert.equal(row.exsportia_status, 'off');
    assert.equal(net.calls.length, 0, 'with no back-office settings nothing is sent to Exsportia');

    mkdirSync(new URL('../.tmp/', import.meta.url), { recursive: true });
    writeFileSync(new URL('../.tmp/email-code.html', import.meta.url), codeMail.html);
    writeFileSync(new URL('../.tmp/email-welcome.html', import.meta.url), welcome.html);
  } finally { net.restore(); }
});

test('the phone number is optional on the server, but if given it must be international', async () => {
  const d1 = fakeD1(), net = fakeNetwork();
  try {
    for (const phone of ['call me', '0812345678', '+66', '+1234567890123456']) {
      const bad = await worker.fetch(post('/offer/start', { name: 'Test Person', email: 'a@example.com', phone }), env(d1));
      assert.equal(bad.status, 400, phone);
    }
    const ok = await worker.fetch(post('/offer/start', { name: 'Test Person', email: 'a@example.com' }), env(d1));
    assert.equal(ok.status, 200);
    assert.equal(d1.db.prepare('SELECT phone FROM opening_offer_claims').get().phone, null);
  } finally { net.restore(); }
});

test('one gift per person: the same email, a +tag or Gmail-dot variant, or the same phone is refused before a code is sent', async () => {
  const d1 = fakeD1(), net = fakeNetwork();
  try {
    assert.equal((await claim(d1, net, { email: 'jane.doe@gmail.com', phone: '+447700900123' })).status, 200);
    const sent = net.mail.length;
    for (const email of ['jane.doe@gmail.com', 'JANE.DOE@gmail.com', 'janedoe@gmail.com', 'jane.doe+opening@gmail.com', 'j.a.n.e.d.o.e@googlemail.com']) {
      const res = await worker.fetch(post('/offer/start', { name: 'Jane Again', email, phone: '+66811111111' }), env(d1));
      assert.equal(res.status, 409, email);
      assert.equal((await res.json()).claimed, true);
    }
    const samePhone = await worker.fetch(post('/offer/start', { name: 'Someone Else', email: 'other@example.com', phone: '+447700900123' }), env(d1));
    assert.equal(samePhone.status, 409, 'the same phone number cannot claim again under another email');
    assert.equal(net.mail.length, sent, 'no code email is sent for a refused attempt');
    assert.equal(d1.db.prepare('SELECT remaining FROM opening_offer_inventory').get().remaining, 49, 'one gift used, once');

    const fresh = await worker.fetch(post('/offer/start', { name: 'New Person', email: 'new@example.com', phone: '+66822222222' }), env(d1));
    assert.equal(fresh.status, 200, 'a different person is not affected');
  } finally { net.restore(); }
});

test('two unconfirmed claims with the same phone: only the first to confirm gets the gift', async () => {
  const d1 = fakeD1(), net = fakeNetwork();
  try {
    const codes = {};
    for (const email of ['first@example.com', 'second@example.com']) {
      assert.equal((await worker.fetch(post('/offer/start', { name: 'Same Phone', email, phone: '+66833333333' }), env(d1))).status, 200);
      codes[email] = net.mail.at(-1).text.match(/\b(\d{6})\b/)[1];
    }
    assert.equal((await worker.fetch(post('/offer/verify', { email: 'second@example.com', code: codes['second@example.com'] }), env(d1))).status, 200);
    const late = await worker.fetch(post('/offer/verify', { email: 'first@example.com', code: codes['first@example.com'] }), env(d1));
    assert.equal(late.status, 409);
    assert.equal(d1.db.prepare('SELECT remaining FROM opening_offer_inventory').get().remaining, 49);
  } finally { net.restore(); }
});

test('confirming the same claim twice is refused, with no second welcome email', async () => {
  const d1 = fakeD1(), net = fakeNetwork();
  try {
    await claim(d1, net);
    const code = net.mail[0].text.match(/\b(\d{6})\b/)[1];
    const again = await worker.fetch(post('/offer/verify', { email: 'justin@example.com', code }), env(d1));
    assert.equal(again.status, 409);
    assert.equal(net.mail.length, 2);
  } finally { net.restore(); }
});

test('back office: a new person becomes an account and a confirmed contact, and gets the password email', async () => {
  const d1 = fakeD1();
  const net = fakeNetwork({ backOffice: url => url.includes('identitytoolkit') ? reply(200, { email: 'justin@example.com' }) : url.includes('/members/byVenue') ? reply(200, { uid: 'MEM123' }) : url.includes('/check/signIn') ? reply(200, { status: true }) : reply(200, { uid: 'abc123' }) });
  try {
    const res = await claim(d1, net, { name: 'Justin Cohen Smith', phone: '+442032901106' }, BACK_OFFICE);
    assert.equal(res.status, 200);
    assert.ok(net.calls[0].url.includes('createAuthUri'), 'the account lookup comes first');
    const [create, contact, confirm, reset] = net.calls.slice(1);
    assert.equal(create.url, 'https://backoffice.test/api/users');
    assert.equal(create.method, 'POST');
    assert.equal(create.body.venueId, '1234');
    assert.equal(create.body.email, 'justin@example.com');
    assert.equal(create.body.phone_number, '+442032901106', 'the country code goes with it, in the form Exsportia stores');
    assert.equal(create.body.firstName, 'Justin');
    assert.equal(create.body.lastName, 'Cohen Smith');
    assert.deepEqual(create.body.role, ['USER']);
    assert.ok(create.body.password.length >= 24);
    assert.equal(contact.url, 'https://backoffice.test/api/users/check/signIn?email=justin%40example.com&venueId=1234&isAfterRegistration=true', 'the venue lookup that always adds the contact');
    assert.equal(confirm.url, 'https://backoffice.test/api/members/byVenue?venueId=1234&userId=abc123', 'and the contact is looked up to be sure');
    assert.equal(reset.url, 'https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=firebase-key');
    assert.deepEqual(reset.body, { requestType: 'PASSWORD_RESET', email: 'justin@example.com' });
    const row = d1.db.prepare('SELECT * FROM opening_offer_claims').get();
    assert.equal(row.exsportia_status, 'created');
    assert.match(row.exsportia_detail, /uid abc123; contact MEM123/);
    assert.ok(!JSON.stringify(row).includes(create.body.password), 'the generated password is never stored');
    const welcome = net.mail[1].html;
    assert.ok(welcome.includes('Your MÀLEE account is ready.') && welcome.includes('second email'));
    assert.ok(welcome.includes('https://wba.exsportia.com/1234/') && welcome.includes('Open your MÀLEE account'));
  } finally { net.restore(); }
});

test('back office: an account that was made but whose contact cannot be confirmed is recorded as partial', async () => {
  const d1 = fakeD1();
  const net = fakeNetwork({ backOffice: url => url.includes('identitytoolkit') ? reply(200) : url.includes('/members/byVenue') ? new Response('', { status: 200 }) : url.includes('/check/signIn') ? reply(200, { status: true }) : reply(200, { uid: 'abc123' }) });
  try {
    assert.equal((await claim(d1, net, {}, BACK_OFFICE)).status, 200);
    const row = d1.db.prepare('SELECT exsportia_status, exsportia_detail FROM opening_offer_claims').get();
    assert.equal(row.exsportia_status, 'partial');
    assert.match(row.exsportia_detail, /contact not confirmed/);
    assert.ok(net.mail[1].html.includes('account is ready'), 'the account itself is real, so the email says so');
  } finally { net.restore(); }
});

test('back office: an email that already has an account is added to the venue as a contact', async () => {
  const d1 = fakeD1();
  const net = fakeNetwork({ backOffice: (url, body) => body ? reply(400, { code: 400, type: 'auth/email-already-exists' }) : reply(200, { status: true }) });
  try {
    assert.equal((await claim(d1, net, {}, BACK_OFFICE)).status, 200);
    const lookup = net.calls.find(c => c.method === 'GET');
    assert.equal(lookup.url, 'https://backoffice.test/api/users/check/signIn?email=justin%40example.com&venueId=1234&isAfterRegistration=true');
    assert.ok(!net.calls.some(c => c.url.includes('sendOobCode')), 'no password email for an existing account');
    assert.equal(d1.db.prepare('SELECT exsportia_status FROM opening_offer_claims').get().exsportia_status, 'existing');
    assert.ok(net.mail[1].html.includes('We found your account.'));
  } finally { net.restore(); }
});

test('back office: a phone number already on another account is left off, the contact is still made', async () => {
  const d1 = fakeD1();
  const net = fakeNetwork({ backOffice: (url, body) => body && body.phone_number ? reply(409, { code: 'PHONE_IN_DB_UNCLAIMED' }) : url.includes('/members/byVenue') ? reply(200, { uid: 'MEM2' }) : reply(200, { uid: 'u2', status: true }) });
  try {
    assert.equal((await claim(d1, net, {}, BACK_OFFICE)).status, 200);
    const creates = net.calls.filter(c => c.url.endsWith('/users'));
    assert.equal(creates.length, 2);
    assert.equal(creates[1].body.phone_number, undefined);
    const row = d1.db.prepare('SELECT exsportia_status, exsportia_detail FROM opening_offer_claims').get();
    assert.equal(row.exsportia_status, 'created');
    assert.match(row.exsportia_detail, /saved without it/);
  } finally { net.restore(); }
});

test('back office down: the visitor still gets their gift, the failure is recorded, and no account is promised', async () => {
  const d1 = fakeD1();
  const net = fakeNetwork({ backOffice: () => reply(500, { message: 'boom' }) });
  try {
    const res = await claim(d1, net, {}, BACK_OFFICE);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { verified: true, remaining: 49 });
    const row = d1.db.prepare('SELECT exsportia_status, exsportia_detail, welcomed_at FROM opening_offer_claims').get();
    assert.equal(row.exsportia_status, 'failed');
    assert.match(row.exsportia_detail, /^500 /);
    assert.ok(row.welcomed_at);
    assert.ok(!net.mail[1].html.includes('account is ready') && !net.mail[1].html.includes('We found your account'));
    assert.ok(net.mail[1].html.includes('Visit MÀLEE'));
  } finally { net.restore(); }
});

test('a failed send says so and lets the person ask again straight away', async () => {
  const d1 = fakeD1(), net = fakeNetwork({ resendOk: false });
  try {
    const res = await worker.fetch(post('/offer/start', { name: 'Test Person', email: 'b@example.com' }), env(d1));
    assert.equal(res.status, 502);
    assert.equal(d1.db.prepare('SELECT last_sent_at FROM opening_offer_claims').get().last_sent_at, 0);
  } finally { net.restore(); }
  const none = await worker.fetch(post('/offer/start', { name: 'Test Person', email: 'c@example.com' }), { ...env(d1), RESEND_API_KEY: undefined });
  assert.equal(none.status, 502, 'with no mail key configured the form fails visibly instead of pretending');
});

test('a table made before the newer columns existed is upgraded in place, and old rows get their keys', async () => {
  const d1 = fakeD1();
  d1.db.exec("CREATE TABLE opening_offer_claims (email TEXT PRIMARY KEY, name TEXT NOT NULL, code_hash TEXT NOT NULL, code_expires_at INTEGER NOT NULL, last_sent_at INTEGER NOT NULL, verified_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  d1.db.exec("INSERT INTO opening_offer_claims (email, name, code_hash, code_expires_at, last_sent_at, verified_at) VALUES ('Old.Row+x@gmail.com', 'Old Row', 'x', 0, 0, '2026-10-12')");
  const res = await worker.fetch(new Request('https://maleepilates.com/offer/status'), env(d1));
  assert.equal(res.status, 200);
  const columns = d1.db.prepare('PRAGMA table_info(opening_offer_claims)').all().map(c => c.name);
  for (const name of ['phone', 'welcomed_at', 'exsportia_status', 'exsportia_detail', 'email_key']) assert.ok(columns.includes(name), name);
  assert.equal(d1.db.prepare('SELECT email_key FROM opening_offer_claims').get().email_key, 'oldrow@gmail.com');
  const net = fakeNetwork();
  try {
    const again = await worker.fetch(post('/offer/start', { name: 'Old Row', email: 'oldrow@gmail.com' }), env(d1));
    assert.equal(again.status, 409, 'a gift claimed before the upgrade still counts');
  } finally { net.restore(); }
});

/* A back office where the account lookup says "registered" for the people in `known`. */
const answers = (known, extra = () => null) => (url, body) => {
  if (url.includes('createAuthUri')) return reply(200, { registered: known.includes(body.identifier), signinMethods: ['password'] });
  return extra(url, body) || (url.includes('/check/signIn') ? reply(200, { status: true }) : reply(500));
};

test('an email that already has an Exsportia account skips the code: contact added, welcome sent, gift taken', async () => {
  const d1 = fakeD1(), net = fakeNetwork({ backOffice: answers(['member@example.com']) });
  try {
    const res = await worker.fetch(post('/offer/start', { name: 'Existing Member', email: 'Member@Example.com', phone: '+66812345678' }), env(d1, BACK_OFFICE));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { verified: true, existing: true, remaining: 49 });
    assert.equal(net.mail.length, 1, 'one email, the welcome: no code is sent');
    assert.match(net.mail[0].subject, /^Welcome to MÀLEE/);
    assert.ok(net.mail[0].html.includes('We found your account.') && net.mail[0].html.includes('https://wba.exsportia.com/1234/'));
    assert.ok(!net.calls.some(c => c.url.endsWith('/users')), 'no new account is made');
    const lookup = net.calls.find(c => c.url.includes('/check/signIn'));
    assert.equal(lookup.url, 'https://backoffice.test/api/users/check/signIn?email=member%40example.com&venueId=1234&isAfterRegistration=true');
    const row = d1.db.prepare('SELECT * FROM opening_offer_claims').get();
    assert.ok(row.verified_at && row.welcomed_at);
    assert.equal(row.exsportia_status, 'existing');
  } finally { net.restore(); }
});

test('an existing account still cannot claim twice, and a person with no account still gets a code', async () => {
  const d1 = fakeD1(), net = fakeNetwork({ backOffice: answers(['member@example.com']) });
  try {
    const ask = email => worker.fetch(post('/offer/start', { name: 'Test Person', email, phone: email.startsWith('new') ? '+66822222222' : '+66811111111' }), env(d1, BACK_OFFICE));
    assert.equal((await ask('member@example.com')).status, 200);
    const again = await ask('member@example.com');
    assert.equal(again.status, 409);
    assert.equal(net.mail.length, 1, 'refused with no email');
    const fresh = await ask('new.person@example.com');
    assert.deepEqual(await fresh.json(), { sent: true });
    assert.match(net.mail.at(-1).subject, /^Your MÀLEE code/);
  } finally { net.restore(); }
});

test('if the account lookup fails, the person is simply sent a code', async () => {
  const d1 = fakeD1(), net = fakeNetwork({ backOffice: () => reply(500) });
  try {
    const res = await worker.fetch(post('/offer/start', { name: 'Test Person', email: 'member@example.com' }), env(d1, BACK_OFFICE));
    assert.deepEqual(await res.json(), { sent: true });
  } finally { net.restore(); }
});

test('with the back-office link off, nobody skips the code', async () => {
  const d1 = fakeD1(), net = fakeNetwork();
  try {
    const res = await worker.fetch(post('/offer/start', { name: 'Test Person', email: 'member@example.com' }), env(d1));
    assert.deepEqual(await res.json(), { sent: true });
    assert.equal(net.calls.length, 0);
  } finally { net.restore(); }
});
