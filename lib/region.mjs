// 소관기관명으로 지역(시도·시군구)을 정하는 규칙이에요.
// 지명 목록은 API 응답 자체에서 만들어요(소관기관유형이 '광역시도'·'시군구'인 기관명). 외부 지명표를 쓰지 않아요.

/** 시도 약칭. 데이터에 그 시도 이름이 있을 때만 써요. '광주'처럼 경기도 광주시와 겹치는 약칭은 넣지 않아요. */
const SIDO_ALIASES = {
  서울특별시: ['서울'],
  부산광역시: ['부산'],
  대구광역시: ['대구'],
  인천광역시: ['인천'],
  광주광역시: ['광주광역시'],
  대전광역시: ['대전'],
  울산광역시: ['울산'],
  세종특별자치시: ['세종'],
  경기도: ['경기'],
  강원특별자치도: ['강원도', '강원'],
  강원도: ['강원'],
  충청북도: ['충북'],
  충청남도: ['충남'],
  전북특별자치도: ['전라북도', '전북'],
  전라북도: ['전북'],
  전라남도: ['전남'],
  전남광주통합특별시: ['전남광주', '전라남도', '광주광역시', '전남'],
  경상북도: ['경북'],
  경상남도: ['경남'],
  제주특별자치도: ['제주'],
};

/** 시도 이름과 겹쳐서 접두어 없이는 정하지 않는 시군구 이름. 경기도 광주시 ↔ 광주광역시('광주시민…'). */
const AMBIGUOUS_WITHOUT_SIDO = new Set(['광주시']);

const ORG_PREFIX = /^(\(재\)|\(사\)|\(주\)|재단법인|사단법인|주식회사)\s*/;

const NATIONAL_TYPES = new Set(['중앙행정기관', '공공기관']);

/**
 * @param {Array<{소관기관유형?: string, 소관기관명?: string}>} rows serviceList 행
 */
export function buildGazetteer(rows) {
  const sidos = new Set();
  /** @type {Map<string, {sido: string, name: string}>} */
  const sigungu = new Map();
  for (const row of rows) {
    const type = (row.소관기관유형 ?? '').trim();
    const name = (row.소관기관명 ?? '').trim();
    if (!name) continue;
    if (type === '광역시도') sidos.add(name);
    if (type === '시군구') {
      const parts = name.split(/\s+/);
      if (parts.length === 2) sigungu.set(name, { sido: parts[0], name: parts[1] });
    }
  }
  for (const { sido } of sigungu.values()) sidos.add(sido);

  const sidoTokens = [];
  for (const sido of sidos) {
    sidoTokens.push({ token: sido, sido });
    for (const alias of SIDO_ALIASES[sido] ?? []) sidoTokens.push({ token: alias, sido });
  }
  sidoTokens.sort((a, b) => b.token.length - a.token.length);

  const shortCount = new Map();
  for (const { name } of sigungu.values()) shortCount.set(name, (shortCount.get(name) ?? 0) + 1);

  const stemCount = new Map();
  const stemOf = (name) => name.replace(/[시군구]$/, '');
  for (const { name } of sigungu.values()) {
    const stem = stemOf(name);
    if (stem.length >= 2) stemCount.set(stem, (stemCount.get(stem) ?? 0) + 1);
  }
  const aliasSet = new Set(sidoTokens.map((t) => t.token));
  // '광주'는 시도 약칭 후보이기도 해서(광주광역시) 어간 매칭에서 빼요.
  aliasSet.add('광주');

  const uniqueSigungu = [...sigungu.values()]
    .filter((s) => shortCount.get(s.name) === 1 && !AMBIGUOUS_WITHOUT_SIDO.has(s.name))
    .sort((a, b) => b.name.length - a.name.length);
  const uniqueStems = [...sigungu.values()]
    .map((s) => ({ ...s, stem: stemOf(s.name) }))
    .filter((s) => s.stem.length >= 2 && stemCount.get(s.stem) === 1 && shortCount.get(s.name) === 1 && !aliasSet.has(s.stem))
    .sort((a, b) => b.stem.length - a.stem.length);

  const sigunguBySido = new Map();
  for (const s of sigungu.values()) {
    if (!sigunguBySido.has(s.sido)) sigunguBySido.set(s.sido, []);
    sigunguBySido.get(s.sido).push(s.name);
  }
  for (const list of sigunguBySido.values()) list.sort((a, b) => a.localeCompare(b, 'ko'));

  return { sidos: [...sidos].sort((a, b) => a.localeCompare(b, 'ko')), sigungu, sigunguBySido, sidoTokens, uniqueSigungu, uniqueStems };
}

/**
 * 지역을 정해요.
 * @returns {{scope: 'national'|'sido'|'sigungu'|'unknown', sido: string|null, sigungu: string|null, how: string}}
 */
export function inferRegion(row, gaz) {
  const type = (row.소관기관유형 ?? '').trim();
  const name = (row.소관기관명 ?? '').trim();
  if (NATIONAL_TYPES.has(type)) return { scope: 'national', sido: null, sigungu: null, how: 'type' };

  if (type === '시군구' && gaz.sigungu.has(name)) {
    const s = gaz.sigungu.get(name);
    return { scope: 'sigungu', sido: s.sido, sigungu: s.name, how: 'exact' };
  }
  if (type === '광역시도' && gaz.sidos.includes(name)) return { scope: 'sido', sido: name, sigungu: null, how: 'exact' };

  const text = name.replace(ORG_PREFIX, '');
  const sidoHit = gaz.sidoTokens.find((t) => text.startsWith(t.token));
  if (sidoHit) {
    const rest = text.slice(sidoHit.token.length);
    const inSido = (gaz.sigunguBySido.get(sidoHit.sido) ?? []).filter((n) => rest.includes(n)).sort((a, b) => b.length - a.length)[0];
    if (inSido) return { scope: 'sigungu', sido: sidoHit.sido, sigungu: inSido, how: 'sido+name' };
    return { scope: 'sido', sido: sidoHit.sido, sigungu: null, how: 'sido-prefix' };
  }

  const byName = gaz.uniqueSigungu.find((s) => text.includes(s.name));
  if (byName) return { scope: 'sigungu', sido: byName.sido, sigungu: byName.name, how: 'unique-name' };

  const byStem = gaz.uniqueStems.find((s) => text.startsWith(s.stem));
  if (byStem) return { scope: 'sigungu', sido: byStem.sido, sigungu: byStem.name, how: 'unique-stem' };

  return { scope: 'unknown', sido: null, sigungu: null, how: 'none' };
}
