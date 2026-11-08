import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { Placeholder } from '@tiptap/extensions';

// Browser side of the campaign editor: the rich-text story and the own-cover upload. The server remains the authority:
// whatever is produced here is parsed and rebuilt from an allow-list again in src/story.js before it is stored.
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
const MAX_BYTES = 10 * 1024 * 1024;

async function uploadImage(url, csrf, file) {
  if (!ACCEPTED.includes(file.type)) throw new Error('Wybierz plik JPEG, PNG, WebP, GIF lub AVIF.');
  if (file.size > MAX_BYTES) throw new Error('Plik jest za duży (maksymalnie 10 MB).');
  let response;
  try { response = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type, 'X-CSRF-Token': csrf }, body: file }); }
  catch { throw new Error('Brak połączenia. Spróbuj ponownie.'); }
  let body = null;
  try { body = await response.json(); } catch { /* an HTML error page */ }
  if (!response.ok || !body?.id) {
    throw new Error(body?.error || (response.status === 429 ? 'Zbyt wiele wgrań naraz. Spróbuj za kilka minut.' : response.status === 403 ? 'Sesja wygasła. Odśwież stronę i spróbuj ponownie.' : 'Nie udało się wgrać obrazu.'));
  }
  return body;
}

const el = (tag, attributes = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) { if (key === 'class') node.className = value; else node.setAttribute(key, value); }
  node.append(...children);
  return node;
};

// ---------------------------------------------------------------- own cover picture
function initCoverUpload(root) {
  const radio = root.querySelector('input[type=radio]'), hidden = root.querySelector('input[name=cover_media_id]');
  const preview = root.querySelector('[data-preview]'), pick = root.querySelector('[data-pick]'), file = root.querySelector('[data-file]'), status = root.querySelector('[data-status]');
  const form = radio.form;
  const customChosen = () => radio.checked && !hidden.value;
  const refresh = () => radio.setCustomValidity(customChosen() ? 'Wgraj plik albo wybierz jedną z gotowych ilustracji.' : '');
  const say = (message, error = false) => { status.textContent = message; status.classList.toggle('is-error', error); };
  async function handle(files) {
    const chosen = [...files].find(item => item.type.startsWith('image/')) || files[0];
    if (!chosen) return;
    pick.disabled = true; say('Wgrywanie…');
    try {
      const media = await uploadImage(root.dataset.uploadUrl, root.dataset.csrf, chosen);
      hidden.value = media.id; radio.checked = true;
      preview.replaceChildren(el('img', { src: media.thumb, alt: 'Podgląd własnej ilustracji zbiórki' }));
      say('Gotowe. Ten obraz będzie ilustracją zbiórki.');
    } catch (error) { say(error.message, true); }
    finally { pick.disabled = false; file.value = ''; refresh(); }
  }
  pick.addEventListener('click', () => file.click());
  file.addEventListener('change', () => handle(file.files));
  for (const type of ['dragenter', 'dragover']) root.addEventListener(type, event => { if ([...(event.dataTransfer?.types || [])].includes('Files')) { event.preventDefault(); root.classList.add('is-dragover'); } });
  for (const type of ['dragleave', 'drop']) root.addEventListener(type, () => root.classList.remove('is-dragover'));
  root.addEventListener('drop', event => { if (event.dataTransfer?.files?.length) { event.preventDefault(); handle(event.dataTransfer.files); } });
  for (const other of form.querySelectorAll('input[name=cover]')) other.addEventListener('change', refresh);
  refresh();
}

// ---------------------------------------------------------------- rich-text story
function initStoryEditor(root) {
  const textarea = root.querySelector('textarea'), form = textarea.form;
  const min = Number(root.dataset.min) || 0, max = Number(root.dataset.max) || Infinity;
  const surface = el('div', { class: 'rte-surface' });
  const message = el('span', { class: 'rte-message', role: 'alert' }), count = el('span', { class: 'rte-count', 'aria-live': 'polite' });
  const footer = el('div', { class: 'rte-footer' }, message, count);
  const toolbar = el('div', { class: 'rte-toolbar', role: 'toolbar', 'aria-label': 'Formatowanie tekstu' });
  const fileInput = el('input', { type: 'file', accept: ACCEPTED.join(','), multiple: '', hidden: '' });
  textarea.hidden = true; textarea.removeAttribute('required'); // a hidden control could never show its own validation bubble
  root.append(toolbar, surface, footer, fileInput);

  let editor, busy = 0;
  const say = (text = '') => { message.textContent = text; };
  const textLength = () => editor.state.doc.textContent.trim().length;
  const buttons = [];
  const add = (label, title, run, { active, enabled, cls = '' } = {}) => {
    const button = el('button', { type: 'button', title, 'aria-label': title, class: cls }, label);
    if (active) button.setAttribute('aria-pressed', 'false');
    button.addEventListener('mousedown', event => event.preventDefault()); // keep the selection in the editor
    button.addEventListener('click', run);
    toolbar.append(button); buttons.push({ button, active, enabled });
    return button;
  };
  const separator = () => toolbar.append(el('span', { class: 'rte-sep', role: 'separator' }));

  async function insertImages(files, position) {
    const images = [...files].filter(file => file.type.startsWith('image/'));
    if (!images.length) { say('Możesz wstawiać tylko obrazy (JPEG, PNG, WebP, GIF, AVIF).'); return; }
    busy++; root.classList.add('is-uploading'); say('');
    let at = position;
    for (const [index, file] of images.entries()) {
      count.textContent = `Wgrywanie obrazu ${index + 1} z ${images.length}…`;
      try {
        const media = await uploadImage(root.dataset.uploadUrl, root.dataset.csrf, file);
        const content = { type: 'image', attrs: { src: media.url, alt: '' } };
        if (at === undefined) editor.chain().focus().insertContent(content).run();
        else { editor.chain().focus().insertContentAt(at, content).run(); at = undefined; }
      } catch (error) { say(error.message); }
    }
    busy--; if (!busy) root.classList.remove('is-uploading');
    refresh();
  }

  function link() {
    const previous = editor.getAttributes('link').href || '';
    const entered = window.prompt('Adres odnośnika (np. https://example.pl). Pozostaw puste, aby usunąć link.', previous);
    if (entered === null) return;
    const value = entered.trim();
    if (!value) { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
    const href = /^(https?:\/\/|mailto:)/i.test(value) ? value : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? `mailto:${value}` : `https://${value}`;
    if (!/^(https?:\/\/[^\s]+\.[^\s]+|mailto:[^\s]+)$/i.test(href)) { say('To nie wygląda na poprawny adres odnośnika.'); return; }
    if (editor.state.selection.empty && !editor.isActive('link')) editor.chain().focus().insertContent({ type: 'text', text: value, marks: [{ type: 'link', attrs: { href } }] }).run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    say('');
  }

  function describeImage() {
    const current = editor.getAttributes('image').alt || '';
    const alt = window.prompt('Krótki opis obrazu dla osób, które go nie widzą (np. „Dzieci grają w ogrodzie”).', current);
    if (alt !== null) editor.chain().focus().updateAttributes('image', { alt: alt.trim().slice(0, 200) }).run();
  }

  add('H2', 'Nagłówek', () => editor.chain().focus().toggleHeading({ level: 2 }).run(), { active: () => editor.isActive('heading', { level: 2 }) });
  add('H3', 'Podtytuł', () => editor.chain().focus().toggleHeading({ level: 3 }).run(), { active: () => editor.isActive('heading', { level: 3 }) });
  separator();
  add('B', 'Pogrubienie (Ctrl+B)', () => editor.chain().focus().toggleBold().run(), { active: () => editor.isActive('bold') });
  add('I', 'Kursywa (Ctrl+I)', () => editor.chain().focus().toggleItalic().run(), { active: () => editor.isActive('italic'), cls: 'rte-i' });
  add('U', 'Podkreślenie (Ctrl+U)', () => editor.chain().focus().toggleUnderline().run(), { active: () => editor.isActive('underline'), cls: 'rte-u' });
  separator();
  add('• Lista', 'Lista punktowana', () => editor.chain().focus().toggleBulletList().run(), { active: () => editor.isActive('bulletList') });
  add('1. Lista', 'Lista numerowana', () => editor.chain().focus().toggleOrderedList().run(), { active: () => editor.isActive('orderedList') });
  add('❝ Cytat', 'Cytat', () => editor.chain().focus().toggleBlockquote().run(), { active: () => editor.isActive('blockquote') });
  add('―', 'Linia pozioma', () => editor.chain().focus().setHorizontalRule().run());
  separator();
  add('Link', 'Dodaj lub zmień odnośnik', link, { active: () => editor.isActive('link') });
  add('Obraz', 'Wstaw zdjęcie lub ilustrację', () => fileInput.click());
  add('Opis obrazu', 'Dodaj opis zaznaczonego obrazu', describeImage, { enabled: () => editor.isActive('image') });
  separator();
  add('↶', 'Cofnij (Ctrl+Z)', () => editor.chain().focus().undo().run(), { enabled: () => editor.can().undo() });
  add('↷', 'Ponów (Ctrl+Shift+Z)', () => editor.chain().focus().redo().run(), { enabled: () => editor.can().redo() });
  fileInput.addEventListener('change', () => { void insertImages(fileInput.files); fileInput.value = ''; });

  const imageFiles = list => [...(list || [])].filter(file => file.type.startsWith('image/'));
  editor = new Editor({
    element: surface, injectCSS: false, content: textarea.value,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, code: false, codeBlock: false, strike: false, link: { openOnClick: false, autolink: true, linkOnPaste: true, HTMLAttributes: { rel: 'noopener noreferrer nofollow ugc', target: '_blank' } } }),
      Image.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({ placeholder: textarea.getAttribute('placeholder') || '' }),
    ],
    editorProps: {
      attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-labelledby': 'story-label', spellcheck: 'true', lang: 'pl' },
      handlePaste: (view, event) => { const files = imageFiles(event.clipboardData?.files); if (!files.length) return false; event.preventDefault(); void insertImages(files); return true; },
      handleDrop: (view, event) => { const files = imageFiles(event.dataTransfer?.files); if (!files.length) return false; event.preventDefault(); void insertImages(files, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos); return true; },
    },
    onUpdate: () => { say(''); root.classList.remove('is-invalid'); sync(); refresh(); },
    onSelectionUpdate: () => refresh(),
    onTransaction: () => refresh(),
  });
  function sync() { textarea.value = editor.isEmpty ? '' : editor.getHTML(); }
  function refresh() {
    for (const { button, active, enabled } of buttons) {
      if (active) button.setAttribute('aria-pressed', String(Boolean(active())));
      button.disabled = enabled ? !enabled() : false;
    }
    if (!busy) { const length = textLength(); count.textContent = `${length} z min. ${min} znaków`; }
  }
  sync(); refresh();

  form.addEventListener('submit', event => {
    sync();
    const length = textLength();
    if (busy) { event.preventDefault(); say('Poczekaj, aż obrazy zakończą wgrywanie.'); return; }
    if (length < min || length > max) {
      event.preventDefault(); root.classList.add('is-invalid');
      say(length < min ? `Opis jest za krótki: ${length} z wymaganych ${min} znaków.` : `Opis jest za długi: ${length} z dozwolonych ${max} znaków.`);
      editor.commands.focus(); root.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  });
}

for (const root of document.querySelectorAll('[data-cover-upload]')) initCoverUpload(root);
for (const root of document.querySelectorAll('[data-story-editor]')) initStoryEditor(root);
