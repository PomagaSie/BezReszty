export default {
  async email(message, env) {
    if (message.rawSize > 256 * 1024 || !new RegExp(`^wplaty\\+[a-f0-9]{32}@${env.NOTIFICATION_DOMAIN.replaceAll('.', '\\.')}$`, 'i').test(message.to)) {
      message.setReject('Nieprawidłowy adres powiadomień lub rozmiar wiadomości.'); return;
    }
    const raw = await new Response(message.raw).arrayBuffer();
    if (raw.byteLength > 256 * 1024) { message.setReject('Wiadomość jest zbyt duża.'); return; }
    const timestamp = String(Date.now()), encoder = new TextEncoder();
    const prefix = encoder.encode(timestamp + '\n'), data = new Uint8Array(prefix.length + raw.byteLength);
    data.set(prefix); data.set(new Uint8Array(raw), prefix.length);
    const key = await crypto.subtle.importKey('raw', encoder.encode(env.BANK_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, data))].map(v => v.toString(16).padStart(2, '0')).join('');
    const response = await fetch(env.BANK_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'message/rfc822', 'X-Bezreszty-Timestamp': timestamp, 'X-Bezreszty-Signature': signature }, body: raw, redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (response.status !== 204) throw new Error('BANK_WEBHOOK_UNAVAILABLE');
    // Never log recipients, bodies, signatures or account information.
  },
  fetch() { return new Response('Not found', { status: 404 }); },
};
