import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../site/_worker.js';

const env = {
  PREVIEW_PASSWORD: 'open-sesame',
  RESEND_API_KEY: 'test-key',
  ASSETS: { fetch: async () => new Response('asset') },
};

async function unlockedCookie() {
  const login = await worker.fetch(new Request('https://maleepilates.com/preview/login', {
    method: 'POST',
    body: new URLSearchParams({ password: 'open-sesame', next: '/client-review/' }),
  }), env);
  return login.headers.get('set-cookie').split(';')[0];
}

const payload = {
  responses: [
    { id: 'venue_structure', title: 'One venue with two studios', reference: 'Bophut and Nathon', status: 'yes', answer: '' },
    { id: 'nathon_timetable', title: 'Nathon timetable', reference: 'Please provide days and times', status: 'provided', answer: 'Monday to Friday, fixed slots at 09:30 and 11:00.' },
    { id: 'nathon_booking_method', title: 'Nathon booking method', reference: 'Fixed or flexible', status: 'fixed', answer: '' },
  ],
  additionalNotes: 'Please call before publishing.',
  completedAt: 'Friday, 16 October 2026 at 15:00',
  submissionId: 'MR-20261016-TEST01',
};

test('the client review endpoint is private', async () => {
  const response = await worker.fetch(new Request('https://maleepilates.com/client-review/submit', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  }), env);
  assert.equal(response.status, 401);
});

test('a completed review is emailed to Exsportia without requiring respondent details', async () => {
  const original = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(options.headers.authorization, 'Bearer test-key');
    sent.push(JSON.parse(options.body));
    return new Response('{}', { status: 200 });
  };
  try {
    const response = await worker.fetch(new Request('https://maleepilates.com/client-review/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: await unlockedCookie() },
      body: JSON.stringify(payload),
    }), env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { submitted: true, submissionId: 'MR-20261016-TEST01', sentTo: 'sjc@exsportia.com' });
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, ['sjc@exsportia.com']);
    assert.equal(sent[0].reply_to, undefined);
    assert.equal(sent[0].subject, 'MÀLEE setup review submitted');
    assert.ok(sent[0].html.includes('Monday to Friday, fixed slots at 09:30 and 11:00.'));
    assert.ok(sent[0].text.includes('Please call before publishing.'));
  } finally {
    globalThis.fetch = original;
  }
});

test('a change or written answer cannot be submitted empty', async () => {
  const bad = structuredClone(payload);
  bad.responses[1].answer = '';
  const response = await worker.fetch(new Request('https://maleepilates.com/client-review/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await unlockedCookie() },
    body: JSON.stringify(bad),
  }), env);
  assert.equal(response.status, 400);
});
