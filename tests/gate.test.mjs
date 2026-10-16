import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../site/_worker.js';

const served = [];
const env = { PREVIEW_PASSWORD: 'open-sesame', ASSETS: { fetch: async request => { served.push(new URL(request.url).pathname); return new Response('<html><body>page</body></html>', { headers: { 'content-type': 'text/html' } }); } } };
const get = (path, cookie) => worker.fetch(new Request(`https://maleepilates.com${path}`, { headers: cookie ? { cookie } : {} }), env);
const login = (password, next) => worker.fetch(new Request('https://maleepilates.com/preview/login', { method: 'POST', body: new URLSearchParams({ password, next }) }), env);

test('the home page is public', async () => {
  const res = await get('/');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '<html><body>page</body></html>');
});

test('every version, the version list and the full-site preview ask for the password', async () => {
  for (const path of ['/v1/', '/v4/', '/v5/', '/v12/', '/versions/', '/preview/', '/client-review/']) {
    served.length = 0;
    const res = await get(path);
    const html = await res.text();
    assert.ok(html.includes('Preview password'), path);
    assert.ok(html.includes(`name="next" value="${path}"`), `${path} remembers where to return`);
    assert.equal(served.length, 0, `${path} is not served before the password`);
  }
});

test('short and old addresses lead to the right place', async () => {
  for (const [from, to, status] of [['/v4', '/v4/', 302], ['/versions', '/versions/', 302], ['/preview', '/preview/', 302], ['/client-review', '/client-review/', 302], ['/preview/versions/v2/', '/v2/', 301], ['/preview/versions/', '/versions/', 301]]) {
    const res = await get(from);
    assert.equal(res.status, status, from);
    assert.equal(new URL(res.headers.get('location')).pathname, to, from);
  }
});

test('the password opens every private page and returns the person where they were going', async () => {
  const wrong = await login('nope', '/v4/');
  assert.ok((await wrong.text()).includes('did not match'));

  const ok = await login('open-sesame', '/v4/');
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/v4/');
  const cookie = ok.headers.get('set-cookie');
  assert.match(cookie, /Path=\/;/, 'one cookie for the whole site, not just /preview');

  const session = cookie.split(';')[0];
  for (const path of ['/v4/', '/versions/', '/preview/', '/client-review/']) {
    const res = await get(path, session);
    assert.equal(await res.text(), '<html><body>page</body></html>', path);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
  }
});

test('after the password, it only ever sends people to a private page on this site', async () => {
  for (const next of ['//evil.example/', 'https://evil.example/', '/', '/offer/status', '']) {
    const res = await login('open-sesame', next);
    assert.equal(res.headers.get('location'), '/preview/', JSON.stringify(next));
  }
});
