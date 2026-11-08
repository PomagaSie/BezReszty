import sanitizeHtml from 'sanitize-html';
import { MEDIA_ID } from './media.js';

// Campaign stories are rich text. The browser editor produces HTML, but the server never trusts it: the markup is parsed
// and REBUILT from an allow-list here, so only the elements and attributes listed below can ever be stored or rendered.
export const STORY_MIN_TEXT = 100;
export const STORY_MAX_TEXT = 15000;
export const STORY_MAX_HTML = 120000;

const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const HTML_HINT = /<\/?(?:p|h[1-6]|ul|ol|li|blockquote|strong|b|em|i|u|a|br|hr|img|div|span)\b[^>]*>/i;

// Legacy / no-JavaScript input: blank lines separate paragraphs, single newlines become line breaks.
export function textToHtml(text) {
  return String(text || '').replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/).filter(part => part.trim())
    .map(part => `<p>${escape(part.trim()).replace(/\n/g, '<br>')}</p>`).join('');
}

export const plainText = html => sanitizeHtml(String(html || '').replace(/<\/(?:p|h[1-6]|li|blockquote|div)>|<br\s*\/?>/gi, ' '), { allowedTags: [], allowedAttributes: {} })
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

// 'unlink' is internal: links with an unsafe address are renamed to it and unwrapped afterwards. (Renaming to a tag that is
// not allowed makes sanitize-html emit a stray closing tag.)
const ALLOWED_TAGS = ['h2', 'h3', 'p', 'br', 'strong', 'em', 'u', 'a', 'ul', 'ol', 'li', 'blockquote', 'hr', 'img', 'unlink'];
// Browsers ignore tabs/newlines and leading control characters inside a URL scheme, so normalise before checking it.
const safeHref = href => { const value = String(href || '').replace(/[\u0000-\u0020\u007f-\u009f]+/g, ''); return /^(?:https?:\/\/[^\s]+|mailto:[^\s]+)$/i.test(value) && value.length <= 2048 ? value : ''; };
const rename = to => (tagName, attribs) => ({ tagName: to, attribs: {} });

// mediaAllowed(id) decides whether the author may embed that uploaded picture; anything else is removed.
export function sanitizeStory(input, { mediaAllowed = () => false } = {}) {
  const source = String(input || '');
  const html = sanitizeHtml(HTML_HINT.test(source) ? source : textToHtml(source), {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { a: ['href', 'rel', 'target'], img: ['src', 'alt', 'loading'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: {},
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    transformTags: {
      h1: rename('h2'), h4: rename('h3'), h5: rename('h3'), h6: rename('h3'), b: rename('strong'), i: rename('em'), div: rename('p'),
      a: (tagName, attribs) => safeHref(attribs.href)
        ? { tagName: 'a', attribs: { href: safeHref(attribs.href), rel: 'noopener noreferrer nofollow ugc', target: '_blank' } }
        : { tagName: 'unlink', attribs: {} },
      img: (tagName, attribs) => ({ tagName: 'img', attribs: { src: attribs.src || '', alt: String(attribs.alt || '').slice(0, 200), loading: 'lazy' } }),
    },
    exclusiveFilter: frame => {
      if (frame.tag === 'img') { const match = /^\/media\/([0-9a-f]{32})$/.exec(frame.attribs.src || ''); return !match || !MEDIA_ID.test(match[1]) || !mediaAllowed(match[1]); }
      if (frame.tag === 'p' || frame.tag === 'li' || frame.tag === 'blockquote') return !frame.text.trim() && !frame.mediaChildren?.length;
      return false;
    },
  }).replace(/<\/?unlink>/g, '').trim();
  return { html, text: plainText(html) };
}
