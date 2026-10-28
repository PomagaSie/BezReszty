// Native details/summary and anchor links keep the entire site usable without JavaScript.
// Close a FAQ only when the visitor explicitly opens another one.
for (const item of document.querySelectorAll('.faq details')) item.addEventListener('toggle', () => {
  if (!item.open) return;
  for (const other of document.querySelectorAll('.faq details')) if (other !== item) other.open = false;
});
