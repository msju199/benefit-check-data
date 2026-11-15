// 신청기한은 자유 글이에요. 확실한 경우만 분류하고, 날짜는 연도가 적힌 것만 읽어요.

const NO_APPLY = /(신청\s*불필요|별도의?\s*신청\s*절차가?\s*없|개인\s*신청\s*절차\s*없|신청\s*절차\s*없음)/;
const ALWAYS = /^(상시\s*신청|상시|연중|연중\s*상시|수시)$/;
const ALWAYS_LEAD = /^(상시\s*신청|연중\s*상시)/;
const VARIES = /(접수\s*기관\s*별?\s*상이|기관별\s*상이)/;
const DATE = /(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/g;

function iso(y, m, d) {
  const mm = Number(m);
  const dd = Number(d);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/**
 * @param {string|null|undefined} text
 * @returns {{kind: 'none'|'always'|'varies'|'period'|'text'|'empty', start: string|null, end: string|null}}
 */
export function parseDeadline(text) {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return { kind: 'empty', start: null, end: null };
  if (NO_APPLY.test(t)) return { kind: 'none', start: null, end: null };
  if (ALWAYS.test(t) || ALWAYS_LEAD.test(t)) return { kind: 'always', start: null, end: null };
  if (VARIES.test(t)) return { kind: 'varies', start: null, end: null };

  const dates = [...t.matchAll(DATE)].map((m) => iso(m[1], m[2], m[3])).filter(Boolean);
  // 날짜가 정확히 두 개이고 '~'로 이어진 하나의 기간일 때만 기간으로 봐요. 여러 회차는 글로 남겨요.
  if (dates.length === 2 && /~|부터|까지/.test(t) && dates[0] <= dates[1]) {
    return { kind: 'period', start: dates[0], end: dates[1] };
  }
  return { kind: 'text', start: null, end: null };
}
