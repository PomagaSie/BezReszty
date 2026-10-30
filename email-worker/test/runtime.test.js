import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Miniflare, Log, LogLevel, Response } from 'miniflare';

const recipient = `wplaty+${'a'.repeat(32)}@bank.example.test`;
const secret = 'b'.repeat(64);
const webhook = 'https://backend.example.test/api/bank-mail';
const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const compatibilityDate = readFileSync(new URL('../cloudflare.config.ts', import.meta.url), 'utf8').match(/compatibilityDate: '([^']+)'/)[1];
// Expected rejection/error cases must not flood test output.
class TestLog extends Log { error() {} }

function mail(to = recipient, size) {
  const headers = `From: powiadomienia@alior.pl\r\nTo: ${to}\r\nMessage-ID: <${randomUUID()}@alior.pl>\r\nDate: ${new Date().toUTCString()}\r\nSubject: Uznanie rachunku\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n`;
  const raw = Buffer.from(headers + 'Zażółć gęślą jaźń\r\n');
  return size ? Buffer.concat([raw, Buffer.alloc(size - raw.length, 120)]) : raw;
}

function runtime(t, handler) {
  const mf = new Miniflare({
    cf: false,
    telemetry: { enabled: false },
    log: new TestLog(LogLevel.NONE),
    unsafeTriggerHandlers: true,
    workers: [{
      config: {
        name: 'bank-mail-test', compatibilityDate,
        manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: source }, 'shared/transport.js': { type: 'esm', contents: readFileSync(new URL('../shared/transport.js', import.meta.url), 'utf8') } } },
        env: Object.fromEntries(Object.entries({ BANK_WEBHOOK_URL: webhook, BANK_WEBHOOK_SECRET: secret, NOTIFICATION_DOMAIN: 'bank.example.test' }).map(([name, value]) => [name, { type: 'text', value }])),
      },
      dev: { outboundService: { type: 'fetcher', handler } },
    }],
  });
  t.after(() => mf.dispose());
  return mf;
}

async function deliver(mf, raw = mail(), to = recipient) {
  const params = new URLSearchParams({ from: 'powiadomienia@alior.pl', to, format: 'json' });
  const response = await mf.dispatchFetch(`http://localhost/cdn-cgi/local/email?${params}`, { method: 'POST', body: raw });
  return { status: response.status, ...await response.json() };
}

test('Workers runtime forwards exact RFC822 bytes and a fresh, valid HMAC', async t => {
  const raw = mail();
  let calls = 0;
  const mf = runtime(t, async request => {
    calls++;
    assert.equal(request.url, webhook);
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.get('content-type'), 'message/rfc822');
    const body = Buffer.from(await request.arrayBuffer());
    assert.deepEqual(body, raw);
    const timestamp = request.headers.get('x-bezreszty-timestamp');
    assert.match(timestamp, /^\d{13}$/);
    assert.ok(Math.abs(Date.now() - Number(timestamp)) < 5000);
    assert.equal(request.headers.get('x-bezreszty-signature'), createHmac('sha256', secret).update(timestamp + '\n').update(body).digest('hex'));
    return new Response(null, { status: 204 });
  });
  const result = await deliver(mf, raw);
  assert.equal(result.status, 200);
  assert.equal(result.outcome, 'ok');
  assert.equal(result.rejectReason, undefined);
  assert.equal(calls, 1);
});

test('email processing waits until the backend acknowledges durable receipt', async t => {
  let acknowledge, reached;
  const backendReached = new Promise(resolve => { reached = resolve; });
  const acknowledgement = new Promise(resolve => { acknowledge = resolve; });
  const mf = runtime(t, async () => { reached(); await acknowledgement; return new Response(null, { status: 204 }); });
  let completed = false;
  const delivery = deliver(mf).then(result => { completed = true; return result; });
  try {
    await backendReached;
    assert.equal(completed, false);
  } finally { acknowledge(); }
  assert.equal((await delivery).outcome, 'ok');
});

for (const status of [200, 301, 302, 307, 308, 401, 500, 503]) {
  test(`backend HTTP ${status} fails delivery and never follows a redirect`, async t => {
    const urls = [];
    const mf = runtime(t, request => {
      urls.push(request.url);
      return new Response(null, { status, headers: { Location: 'https://other.example.test/leak' } });
    });
    const result = await deliver(mf);
    assert.equal(result.status, 500);
    assert.equal(result.outcome, 'exception');
    assert.deepEqual(urls, [webhook]);
  });
}

test('a network failure fails email delivery', async t => {
  const mf = runtime(t, () => { throw new Error('TEST_CONNECTION_FAILURE'); });
  assert.equal((await deliver(mf)).outcome, 'exception');
});

test('invalid aliases and domains are rejected before any outbound request', async t => {
  let calls = 0;
  const mf = runtime(t, () => { calls++; return new Response(null, { status: 204 }); });
  for (const to of ['somebody@bank.example.test', `wplaty+${'a'.repeat(31)}@bank.example.test`, `wplaty+${'g'.repeat(32)}@bank.example.test`, `wplaty+${'a'.repeat(32)}@bankXexample.test`, recipient + '.attacker.test']) {
    const result = await deliver(mf, mail(to), to);
    assert.match(result.rejectReason, /Nieprawidłowy adres/);
    assert.ok(result.events.some(event => event.type === 'reject'));
  }
  assert.equal(calls, 0);
});

test('256 KiB is accepted, but a larger email is rejected without forwarding', async t => {
  let calls = 0;
  const mf = runtime(t, () => { calls++; return new Response(null, { status: 204 }); });
  assert.equal((await deliver(mf, mail(recipient, 256 * 1024))).rejectReason, undefined);
  assert.equal(calls, 1);
  const oversized = await deliver(mf, mail(recipient, 256 * 1024 + 1));
  assert.match(oversized.rejectReason, /rozmiar wiadomości/);
  assert.equal(calls, 1);
});

test('the Worker exposes no public HTTP ingestion endpoint', async t => {
  const mf = runtime(t, () => { assert.fail('Unexpected outbound request'); });
  assert.equal((await mf.dispatchFetch('http://localhost/')).status, 404);
});
