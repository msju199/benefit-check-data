import { gzipSync } from 'node:zlib';
import { parseDeadline } from './deadline.mjs';
import { loanVerdict } from './loan.mjs';
import { buildGazetteer, inferRegion } from './region.mjs';
import { clean, shorten, webUrl } from './text.mjs';

export const SCHEMA_VERSION = 1;
export const DETAIL_BUCKETS = 64;
export const FIRST_LOAD_LIMIT_GZIP = 1_000_000;

/** 지원조건 코드는 공식 Swagger(stages/44436)의 supportConditions_model 그대로예요. */
export const CONDITION_FLAG_CODES = [
  'JA0101', 'JA0102',
  'JA0201', 'JA0202', 'JA0203', 'JA0204', 'JA0205',
  'JA0301', 'JA0302', 'JA0303',
  'JA0313', 'JA0314', 'JA0315', 'JA0316', 'JA0317', 'JA0318', 'JA0319', 'JA0320', 'JA0322', 'JA0326', 'JA0327',
  'JA0328', 'JA0329', 'JA0330',
  'JA0401', 'JA0402', 'JA0403', 'JA0404', 'JA0410', 'JA0411', 'JA0412', 'JA0413', 'JA0414',
  'JA1101', 'JA1102', 'JA1103', 'JA1201', 'JA1202', 'JA1299',
  'JA2101', 'JA2102', 'JA2103', 'JA2201', 'JA2202', 'JA2203', 'JA2299',
];

/** 개인·가구가 받을 수 있는 서비스만 담아요. '개인||법인/시설/단체'처럼 섞인 값은 개인이 들어 있으면 담아요. */
export function isPersonal(userType) {
  const parts = String(userType ?? '').split('||').map((s) => s.trim());
  return parts.includes('개인') || parts.includes('가구');
}

function ageOf(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 150 ? n : null;
}

/** 조건 행을 {a:[시작,끝], y:[Y인 코드 뒤 4자리]}로 줄여요. 해석(그룹·판정)은 앱이 해요. */
export function compactConditions(row) {
  if (!row) return null;
  const y = CONDITION_FLAG_CODES.filter((code) => String(row[code] ?? '').trim().toUpperCase() === 'Y').map((c) => c.slice(2));
  return { a: [ageOf(row.JA0110), ageOf(row.JA0111)], y };
}

export function bucketOf(id) {
  let h = 2166136261;
  for (const ch of String(id)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % DETAIL_BUCKETS;
}

function kstDate(d = new Date()) {
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** 수정일시는 'YYYYMMDDHHmmss' 형태예요. 'YYYY-MM-DD'로 바꾸고, 형식이 다르면 null이에요. */
export function dateOf(value) {
  const m = String(value ?? '').match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * 세 엔드포인트 결과를 합쳐 앱용 파일을 만들어요.
 * @returns {{files: Map<string, unknown>, report: object}}
 */
export function buildSnapshot({ list, details, conditions, fetchedAt = new Date() }) {
  const gaz = buildGazetteer(list);
  const detailById = new Map(details.map((d) => [String(d.서비스ID), d]));
  const condById = new Map(conditions.map((c) => [String(c.서비스ID), c]));

  const index = new Map(); // key -> items
  const buckets = Array.from({ length: DETAIL_BUCKETS }, () => ({}));
  const loan = { removedByType: 0, removedByTitle: 0, mixedKept: 0, removedTitles: [], mixedTitles: [] };
  const counts = { list: list.length, personal: 0, skippedNonPersonal: 0, loan, withDetail: 0, withConditions: 0, regionHow: {}, scope: {}, deadline: {} };
  let latestSourceUpdate = null;
  const seen = new Set();

  for (const row of list) {
    const id = String(row.서비스ID ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (!isPersonal(row.사용자구분)) {
      counts.skippedNonPersonal += 1;
      continue;
    }
    const lv = loanVerdict(row.지원유형, row.서비스명);
    if (lv.exclude) {
      if (lv.why === 'type') loan.removedByType += 1;
      else loan.removedByTitle += 1;
      loan.removedTitles.push(clean(row.서비스명) ?? id);
      continue;
    }
    if (lv.mixed) {
      loan.mixedKept += 1;
      loan.mixedTitles.push(`${clean(row.서비스명) ?? id} [${clean(row.지원유형)}]`);
    }
    counts.personal += 1;
    const detail = detailById.get(id) ?? null;
    const cond = condById.get(id) ?? null;
    if (detail) counts.withDetail += 1;
    if (cond) counts.withConditions += 1;

    const region = inferRegion(row, gaz);
    counts.regionHow[region.how] = (counts.regionHow[region.how] ?? 0) + 1;
    counts.scope[region.scope] = (counts.scope[region.scope] ?? 0) + 1;
    const deadlineText = clean(detail?.신청기한 ?? row.신청기한);
    const deadline = parseDeadline(deadlineText);
    counts.deadline[deadline.kind] = (counts.deadline[deadline.kind] ?? 0) + 1;
    const updated = dateOf(detail?.수정일시 ?? row.수정일시);
    if (updated && (!latestSourceUpdate || updated > latestSourceUpdate)) latestSourceUpdate = updated;

    const item = {
      id,
      t: clean(row.서비스명) ?? clean(detail?.서비스명) ?? id,
      s: shorten(row.서비스목적요약 ?? detail?.서비스목적, 80),
      f: clean(row.서비스분야),
      k: clean(row.지원유형),
      ag: clean(row.소관기관명),
      at: clean(row.소관기관유형),
      rs: region.scope,
      sd: region.sido,
      sg: region.sigungu,
      c: compactConditions(cond),
      dl: deadline.kind === 'period' ? [deadline.kind, deadline.start, deadline.end] : [deadline.kind],
      v: Number.isFinite(Number(row.조회수)) ? Number(row.조회수) : 0,
      up: updated,
      b: bucketOf(id),
    };
    const key = region.scope === 'national' || region.scope === 'unknown' ? 'national' : region.sido;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(item);

    buckets[item.b][id] = {
      purpose: clean(detail?.서비스목적 ?? row.서비스목적요약),
      target: clean(detail?.지원대상 ?? row.지원대상),
      criteria: clean(detail?.선정기준 ?? row.선정기준),
      support: clean(detail?.지원내용 ?? row.지원내용),
      how: clean(detail?.신청방법 ?? row.신청방법),
      deadline: deadlineText,
      docs: clean(detail?.구비서류),
      docsOfficial: clean(detail?.공무원확인구비서류),
      docsSelf: clean(detail?.본인확인필요구비서류),
      reception: clean(detail?.접수기관명 ?? row.접수기관),
      contact: clean(detail?.문의처 ?? row.전화문의),
      dept: clean(row.부서명),
      applyUrl: webUrl(detail?.온라인신청사이트URL),
      pageUrl: webUrl(row.상세조회URL),
      law: clean(detail?.법령),
      ordinance: clean(detail?.자치법규),
      rule: clean(detail?.행정규칙),
      updated,
    };
  }

  const files = new Map();
  const sidoFiles = {};
  const sizes = {};
  const sidoKeys = [...index.keys()].filter((k) => k !== 'national').sort((a, b) => a.localeCompare(b, 'ko'));
  const sortItems = (items) => items.sort((a, b) => b.v - a.v || a.id.localeCompare(b.id));
  files.set('index/national.json', { schema: SCHEMA_VERSION, items: sortItems(index.get('national') ?? []) });
  sidoKeys.forEach((sido, i) => {
    const path = `index/sido-${String(i + 1).padStart(2, '0')}.json`;
    sidoFiles[sido] = path;
    files.set(path, { schema: SCHEMA_VERSION, sido, items: sortItems(index.get(sido)) });
  });
  buckets.forEach((bucket, i) => files.set(`detail/${String(i).padStart(2, '0')}.json`, { schema: SCHEMA_VERSION, items: bucket }));

  for (const [path, body] of files) sizes[path] = gzipSync(JSON.stringify(body), { level: 9 }).length;

  const meta = {
    schema: SCHEMA_VERSION,
    source: {
      title: '행정안전부_대한민국 공공서비스(혜택) 정보',
      provider: '행정안전부',
      url: 'https://www.data.go.kr/data/15113968/openapi.do',
      license: '이용허락범위 제한 없음',
    },
    fetchedAt: fetchedAt.toISOString(),
    baseDate: kstDate(fetchedAt),
    latestSourceUpdate,
    counts: { total: counts.list, personal: counts.personal, loanExcluded: loan.removedByType + loan.removedByTitle },
    regions: [...gaz.sigunguBySido.keys(), ...gaz.sidos.filter((s) => !gaz.sigunguBySido.has(s))]
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort((a, b) => a.localeCompare(b, 'ko'))
      .map((sido) => ({ sido, sigungu: gaz.sigunguBySido.get(sido) ?? [] })),
    files: { national: 'index/national.json', sido: sidoFiles, detail: 'detail/{bucket}.json', detailBuckets: DETAIL_BUCKETS },
  };
  files.set('meta.json', meta);
  sizes['meta.json'] = gzipSync(JSON.stringify(meta), { level: 9 }).length;

  const firstLoad = Object.fromEntries(
    Object.entries(sidoFiles).map(([sido, path]) => [sido, sizes['meta.json'] + sizes['index/national.json'] + sizes[path]]),
  );
  const worstFirstLoad = Math.max(0, ...Object.values(firstLoad));
  return { files, report: { counts, sizes, firstLoad, worstFirstLoad, firstLoadLimit: FIRST_LOAD_LIMIT_GZIP } };
}
