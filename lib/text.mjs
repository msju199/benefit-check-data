/** 공백만 정리해요. 내용은 바꾸지 않아요. */
export function clean(value) {
  if (value === null || value === undefined) return null;
  const s = String(value)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return s.length ? s : null;
}

export function shorten(value, max) {
  const s = clean(value);
  if (!s) return null;
  const one = s.replace(/\s+/g, ' ');
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** http(s) 주소만 남겨요. 주소를 고쳐 쓰지 않아요(https로 바꾸면 열리지 않는 사이트가 있어요). */
export function webUrl(value) {
  const s = clean(value);
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}
