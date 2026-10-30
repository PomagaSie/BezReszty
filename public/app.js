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
  let timer, failures = 0, attempts = 0, running = false, confirmed = status.dataset.initialStatus === 'confirmed';
  async function check(manual = false) {
    if (running || confirmed) return;
    running = true; button.disabled = true;
    try {
      const response = await fetch(`/api/wplaty/${encodeURIComponent(payment.dataset.paymentId)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Request failed');
      const result = await response.json(); failures = 0;
      if (result.status === 'confirmed') {
        confirmed = true; status.classList.add('confirmed');
        status.querySelector('.status-icon').textContent = '✓';
        document.getElementById('status-title').textContent = 'Dziękujemy! Wpłata potwierdzona.';
        document.getElementById('status-description').textContent = 'Twój dobry gest jest już na zbiórce.';
        button.textContent = 'Wpłata potwierdzona ✓'; clearTimeout(timer);
      } else if (manual) toast('Powiadomienie bankowe jeszcze nie dotarło. Sprawdź ponownie później.');
    } catch {
      failures++; if (manual) toast('Nie udało się sprawdzić statusu. Spróbuj ponownie.');
    } finally {
      running = false; button.disabled = confirmed;
      attempts++; if (!confirmed && attempts < 180) { clearTimeout(timer); timer = setTimeout(() => { if (!document.hidden) void check(); else timer = setTimeout(() => check(), 30000); }, Math.min(60000, 10000 * (1 + failures))); }
    }
  }
  button.disabled = confirmed;
  button.addEventListener('click', () => { clearTimeout(timer); void check(true); });
  if (!confirmed) timer = setTimeout(() => check(), 10000);
  window.addEventListener('pagehide', () => clearTimeout(timer));
}
