const toast = message => {
  const box = document.getElementById('toast');
  if (!box) return;
  box.textContent = message; box.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => box.hidden = true, 4500);
};
for (const button of document.querySelectorAll('[data-copy]')) button.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(button.dataset.copy); toast('Skopiowano. Dobro jest o krok bliżej.'); }
  catch { toast('Nie udało się skopiować. Zaznacz i skopiuj tekst ręcznie.'); }
});
for (const button of document.querySelectorAll('[data-share]')) button.addEventListener('click', async () => {
  const data = { title: button.dataset.title, url: button.dataset.url };
  try {
    if (navigator.share) await navigator.share(data);
    else { await navigator.clipboard.writeText(data.url); toast('Link do zbiórki skopiowany.'); }
  } catch (error) { if (error.name !== 'AbortError') toast('Skopiuj adres tej strony, aby udostępnić zbiórkę.'); }
});
const menuToggle = document.querySelector('.mobile-toggle'), menu = document.getElementById('mobile-nav');
menuToggle?.addEventListener('click', () => { const expanded = menuToggle.getAttribute('aria-expanded') === 'true'; menuToggle.setAttribute('aria-expanded', String(!expanded)); menu.hidden = expanded; });
for (const button of document.querySelectorAll('[data-amount]')) button.addEventListener('click', () => {
  const input = document.getElementById('amount'); input.value = button.dataset.amount;
  document.querySelectorAll('[data-amount]').forEach(b => { b.classList.toggle('selected', b === button); b.setAttribute('aria-pressed', String(b === button)); });
});
document.getElementById('amount')?.addEventListener('input', event => document.querySelectorAll('[data-amount]').forEach(b => { const selected = Number(b.dataset.amount) === Number(event.target.value); b.classList.toggle('selected', selected); b.setAttribute('aria-pressed', String(selected)); }));
for (const form of document.querySelectorAll('form[data-confirm]')) form.addEventListener('submit', event => { if (!window.confirm(form.dataset.confirm)) event.preventDefault(); });
const demoDialog = document.getElementById('demo-dialog');
document.querySelector('[data-demo-payment]')?.addEventListener('click', () => demoDialog.showModal());
for (const button of document.querySelectorAll('[data-close-dialog]')) button.addEventListener('click', () => button.closest('dialog').close());
demoDialog?.addEventListener('click', event => { if(event.target===demoDialog) { const rect=demoDialog.getBoundingClientRect(); if(event.clientX<rect.left || event.clientX>rect.right || event.clientY<rect.top || event.clientY>rect.bottom) demoDialog.close(); } });
const payment = document.querySelector('[data-payment-id]');
const bankVerification = document.querySelector('[data-bank-verification]');
if (bankVerification) {
  let timer, running = false, stopped = false, paused = false, failures = 0;
  async function checkBankVerification() {
    if (running || stopped || paused) return;
    if (document.hidden) { timer = setTimeout(checkBankVerification, 15000); return; }
    running = true;
    try {
      const response = await fetch('/api/weryfikacja/status', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (response.status === 401) { stopped = true; return; }
      if (!response.ok) throw new Error('Request failed');
      const result = await response.json(); failures = 0;
      if (result.notificationSeen || result.status !== 'pending' || result.startedAt !== bankVerification.dataset.startedAt) {
        stopped = true;
        window.location.reload();
      }
    } catch { failures++; }
    finally {
      running = false;
      if (!stopped && !paused) timer = setTimeout(checkBankVerification, Math.min(60000, 5000 * (1 + failures)));
    }
  }
  timer = setTimeout(checkBankVerification, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { clearTimeout(timer); return checkBankVerification(); } });
  window.addEventListener('pagehide', () => { paused = true; clearTimeout(timer); });
  window.addEventListener('pageshow', event => { if (event.persisted) { paused = false; return checkBankVerification(); } });
}
if (payment) {
  const status = document.getElementById('payment-status'), button = document.getElementById('check-payment');
  const startedAt = Date.now();
  let timer, failures = 0, running = false, confirmed = status.dataset.initialStatus === 'confirmed';
  const svg = (name, attributes = {}) => { const node = document.createElementNS('http://www.w3.org/2000/svg', name); for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value); return node; };
  const checkmark = () => { const icon = svg('svg', { viewBox: '0 0 52 52', 'aria-hidden': 'true', class: 'check-draw' }); icon.append(svg('circle', { cx: 26, cy: 26, r: 24, class: 'check-circle' }), svg('path', { d: 'M15 27l8 8 15-17', class: 'check-tick' })); return icon; };
  const confetti = () => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const canvas = document.createElement('canvas'); canvas.className = 'confetti'; canvas.setAttribute('aria-hidden', 'true');
    const context = canvas.getContext('2d'), ratio = Math.min(devicePixelRatio || 1, 2);
    const resize = () => { canvas.width = innerWidth * ratio; canvas.height = innerHeight * ratio; };
    resize(); document.body.append(canvas);
    const colors = ['#d6f267', '#075e54', '#ffffff', '#143c35', '#f2c94c', '#ff8a7a'];
    const piece = (x, y, vx, vy) => ({ x, y, vx, vy, size: 6 + Math.random() * 7, color: colors[Math.floor(Math.random() * colors.length)], angle: Math.random() * 6.28, spin: (Math.random() - .5) * .35, round: Math.random() < .25 });
    const pieces = [];
    for (let i = 0; i < 90; i++) { const left = i % 2 === 0, angle = -(.9 + Math.random() * .6), speed = 11 + Math.random() * 9; pieces.push(piece(left ? 0 : innerWidth, innerHeight * .75, Math.cos(angle) * speed * (left ? 1 : -1) * .75, Math.sin(angle) * speed)); }
    for (let i = 0; i < 70; i++) pieces.push(piece(Math.random() * innerWidth, -20 - Math.random() * innerHeight * .5, (Math.random() - .5) * 3, 2 + Math.random() * 3));
    const began = performance.now();
    const frame = time => {
      const age = time - began; context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, canvas.width, canvas.height); context.scale(ratio, ratio);
      for (const p of pieces) {
        p.vy += .32; p.vx *= .992; p.x += p.vx; p.y += p.vy; p.angle += p.spin;
        context.save(); context.globalAlpha = Math.max(0, Math.min(1, (5200 - age) / 1200)); context.translate(p.x, p.y); context.rotate(p.angle); context.fillStyle = p.color;
        if (p.round) { context.beginPath(); context.arc(0, 0, p.size / 2, 0, 6.28); context.fill(); } else context.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * .6);
        context.restore();
      }
      if (age < 5200) requestAnimationFrame(frame); else canvas.remove();
    };
    addEventListener('resize', resize); requestAnimationFrame(frame);
  };
  const thankYou = amount => {
    const money = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: amount % 100 ? 2 : 0 }).format(amount / 100);
    const layer = document.createElement('div'); layer.className = 'thanks'; layer.setAttribute('role', 'dialog'); layer.setAttribute('aria-modal', 'true'); layer.setAttribute('aria-labelledby', 'thanks-title');
    const card = document.createElement('div'); card.className = 'thanks-card';
    const title = document.createElement('h2'); title.id = 'thanks-title'; title.textContent = 'Dziękujemy!';
    const text = document.createElement('p'); text.textContent = `Twoje ${money} dotarło do organizatora — bez prowizji i bez reszty. To naprawdę robi różnicę.`;
    const close = document.createElement('button'); close.type = 'button'; close.className = 'button full'; close.textContent = 'Super, zamknij';
    card.append(checkmark(), title, text, close); layer.append(card); document.body.append(layer);
    const dismiss = () => { layer.classList.add('leaving'); setTimeout(() => layer.remove(), 250); removeEventListener('keydown', onKey); };
    const onKey = event => { if (event.key === 'Escape') dismiss(); };
    close.addEventListener('click', dismiss); layer.addEventListener('click', event => { if (event.target === layer) dismiss(); }); addEventListener('keydown', onKey);
    close.focus({ preventScroll: true });
  };
  const markConfirmed = (amount, celebrate) => {
    confirmed = true; clearTimeout(timer); status.classList.add('confirmed');
    status.querySelector('.status-icon').replaceChildren(checkmark());
    document.getElementById('status-title').textContent = 'Dziękujemy! Wpłata potwierdzona.';
    document.getElementById('status-description').textContent = 'Twój dobry gest jest już na zbiórce.';
    button.textContent = 'Wpłata potwierdzona ✓'; button.disabled = true;
    if (celebrate) { confetti(); thankYou(amount); }
  };
  // Poll quickly right after the transfer, then back off. A hidden tab pauses and re-checks the moment it is visible again.
  const delay = () => { const elapsed = Date.now() - startedAt, base = elapsed < 120000 ? 3000 : elapsed < 600000 ? 8000 : 20000; return Math.min(60000, base * (1 + failures)); };
  const schedule = () => { clearTimeout(timer); if (!confirmed && Date.now() - startedAt < 4 * 3600000) timer = setTimeout(() => (document.hidden ? schedule() : check()), document.hidden ? 30000 : delay()); };
  async function check(manual = false) {
    if (running || confirmed) return;
    running = true; button.disabled = true;
    try {
      const response = await fetch(`/api/wplaty/${encodeURIComponent(payment.dataset.paymentId)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Request failed');
      const result = await response.json(); failures = 0;
      if (result.status === 'confirmed') markConfirmed(result.amount, true);
      else if (manual) toast('Powiadomienie bankowe jeszcze nie dotarło. Sprawdź ponownie później.');
    } catch {
      failures++; if (manual) toast('Nie udało się sprawdzić statusu. Spróbuj ponownie.');
    } finally { running = false; button.disabled = confirmed; schedule(); }
  }
  button.disabled = confirmed;
  if (confirmed) status.querySelector('.status-icon').replaceChildren(checkmark());
  button.addEventListener('click', () => void check(true));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !confirmed) { clearTimeout(timer); void check(); } });
  if (!confirmed) timer = setTimeout(() => check(), 3000);
  window.addEventListener('pagehide', () => clearTimeout(timer));
}

const mobywatel = document.querySelector('[data-mobywatel]');
if (mobywatel) {
  const shownExpiry = mobywatel.dataset.expiresAt, timerBox = mobywatel.querySelector('[data-mobywatel-timer]');
  const deadline = shownExpiry ? performance.now() + Number(mobywatel.dataset.remainingMs) : 0;
  const tick = () => {
    const left = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
    if (timerBox) timerBox.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    if (!left) window.location.reload();
  };
  if (deadline) { tick(); setInterval(tick, 1000); }
  const poll = async () => {
    if (document.hidden) return;
    try {
      const response = await fetch('/api/weryfikacja/status', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!response.ok) return;
      const result = await response.json();
      if (String(result.mobywatelExpiresAt || '') !== shownExpiry || result.status !== 'pending') window.location.reload();
    } catch { /* The next poll retries. */ }
  };
  setInterval(poll, 5000);
}

const decodeQrImage = async blob => {
  const bitmap = await createImageBitmap(blob), scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  return window.jsQR?.(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' })?.data || null;
};
for (const form of document.querySelectorAll('[data-qr-form]')) {
  const status = form.querySelector('[data-qr-status]'), field = form.querySelector('[data-qr-code]'), drop = form.querySelector('[data-qr-drop]'), file = form.querySelector('[data-qr-file]');
  const handle = async blob => {
    status.textContent = 'Odczytuję kod QR…';
    try {
      const text = await decodeQrImage(blob);
      if (text) { field.value = text; status.textContent = '✓ Odczytano kod QR. Sprawdź i kliknij „Pokaż kod organizatorowi”.'; }
      else status.textContent = 'Nie znaleziono kodu QR na obrazie. Zrób wyraźniejszy zrzut samego kodu.';
    } catch { status.textContent = 'Nie udało się odczytać obrazu.'; }
  };
  drop.addEventListener('paste', event => {
    const item = [...event.clipboardData.items].find(entry => entry.type.startsWith('image/'));
    if (item) { event.preventDefault(); handle(item.getAsFile()); return; }
    const text = event.clipboardData.getData('text').trim();
    if (!text) return;
    event.preventDefault();
    if (/^[A-Za-z0-9]{3}\s?[A-Za-z0-9]{3}$/.test(text)) { form.querySelector('[data-qr-manual]').value = text; status.textContent = '✓ Wklejono kod sześcioznakowy.'; }
    else { field.value = text; status.textContent = '✓ Wklejono treść kodu QR.'; }
  });
  file.addEventListener('change', () => { if (file.files[0]) handle(file.files[0]); });
}

// Character limit that never blocks typing: the counter and a bar show the budget, characters over the limit are marked
// red inside the field, and the form cannot be submitted until the text is short enough.
for (const wrapper of document.querySelectorAll('[data-char-limit]')) {
  const limit = Number(wrapper.dataset.charLimit), field = wrapper.querySelector('textarea, input'), backdrop = wrapper.querySelector('.limit-backdrop');
  const meter = wrapper.nextElementSibling, bar = meter?.querySelector('progress'), count = meter?.querySelector('.limit-count');
  if (!limit || !field || !backdrop || !meter) continue;
  wrapper.classList.add('is-enhanced');
  const copy = () => {
    const style = getComputedStyle(field);
    for (const name of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderRadius', 'wordSpacing', 'textIndent']) backdrop.style[name] = style[name];
    backdrop.style.scrollbarGutter = style.scrollbarGutter;
  };
  const render = () => {
    const value = field.value, over = Math.max(0, value.trim().length - limit);
    // Trailing whitespace is trimmed on save, so the marked part starts at the first character beyond the limit of the trimmed text.
    const lead = value.length - value.trimStart().length, cut = over ? lead + limit : value.length;
    backdrop.replaceChildren(document.createTextNode(value.slice(0, cut)));
    if (over) { const mark = document.createElement('mark'); mark.textContent = value.slice(cut); backdrop.append(mark); }
    backdrop.append(document.createTextNode('\n'));
    backdrop.scrollTop = field.scrollTop;
    const used = value.trim().length;
    wrapper.classList.toggle('is-over', over > 0); meter.classList.toggle('is-over', over > 0); meter.classList.toggle('is-near', !over && used >= limit * .9);
    field.setAttribute('aria-invalid', over ? 'true' : 'false');
    field.setCustomValidity(over ? `Skróć tekst o ${over} ${over === 1 ? 'znak' : [2, 3, 4].includes(over % 10) && ![12, 13, 14].includes(over % 100) ? 'znaki' : 'znaków'}, aby zapisać formularz.` : '');
    if (bar) bar.value = Math.min(used, limit);
    if (count) count.textContent = over ? `${used} / ${limit} — o ${over} za dużo` : `${used} / ${limit}`;
  };
  field.addEventListener('input', render);
  field.addEventListener('scroll', () => { backdrop.scrollTop = field.scrollTop; });
  new ResizeObserver(() => { copy(); backdrop.scrollTop = field.scrollTop; }).observe(field);
  copy(); render();
  document.fonts?.ready.then(() => { copy(); render(); });
}
