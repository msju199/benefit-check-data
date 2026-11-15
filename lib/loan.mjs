// 정부 대출(융자)·보증 사업을 빼는 규칙이에요(2026-11-15 결정: 금융상품처럼 보이지 않게).
// app/src/domain/loan.ts와 같은 규칙이에요. 한쪽을 바꾸면 다른 쪽도 바꿔 주세요.
//
// 1차(실제 API): 지원유형만 봐요. '||'로 나뉜 유형이 전부 융자·대출·보증이면 빼요.
//   현금||융자처럼 섞여 있으면 남기고 'mixed'로 따로 세요(사람이 검토).
// 2차(지원유형이 비어 있을 때만): 서비스명이 대출·융자·보증 상품 자체인 경우만 빼요.
//   이자·이차보전·보증료·수수료 지원, 신용회복·채무 조정, 도서 대출은 현금성 혜택이라 남겨요.

const LOAN_TYPE = /융자|대출|보증/;
const TITLE_PRODUCT = /(대출|융자|대부|보증)(\s*(사업|제도|지원|지원사업))?(\s*\([^)]*\))?$|\((융자|대출)\)|자금\s*융자|융자\s*(및|지원)|특례보증|소액금융 보증/;
const TITLE_KEEP = /(?<!무)이자|이차보전|보증료|수수료|신용회복|채무|면제|상환\s*지원|도서|서점|전집|연장서비스|보증금\s*(지원|이자)|임대보증금|임차보증금/;

export function splitTypes(value) {
  return String(value ?? '')
    .split(/\|\||,|\//)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** @returns {'loan'|'mixed'|'none'} */
export function loanTypeOf(supportType) {
  const parts = splitTypes(supportType);
  if (!parts.length) return 'none';
  const loans = parts.filter((p) => LOAN_TYPE.test(p));
  if (loans.length === parts.length) return 'loan';
  return loans.length ? 'mixed' : 'none';
}

export function isLoanTitle(title) {
  const t = String(title ?? '').trim();
  return TITLE_PRODUCT.test(t) && !TITLE_KEEP.test(t);
}

/** @returns {{exclude: boolean, why: 'type'|'title'|null, mixed: boolean}} */
export function loanVerdict(supportType, title) {
  const kind = loanTypeOf(supportType);
  if (kind === 'loan') return { exclude: true, why: 'type', mixed: false };
  if (kind === 'mixed') return { exclude: false, why: null, mixed: true };
  if (splitTypes(supportType).length === 0 && isLoanTitle(title)) return { exclude: true, why: 'title', mixed: false };
  return { exclude: false, why: null, mixed: false };
}
