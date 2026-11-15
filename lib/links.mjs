/** HTTP 상태로 링크를 판정해요. true 열림, false 깨짐, null 확인 못 함(봇 차단·일시 오류). */
export function verdict(status) {
  if (status >= 200 && status < 400) return true;
  if (status === 404 || status === 410 || (status >= 500 && status !== 503)) return false;
  return null;
}
