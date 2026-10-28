// External request and first-party cookie: both warn (platform#373).
export async function sync(best: number) {
  // biome-ignore lint/suspicious/noDocumentCookie: fixture exercises the no-cookies check
  document.cookie = `best=${best}; path=/`;
  await fetch('https://scores.example.com/v1/best', { method: 'POST' });
}
