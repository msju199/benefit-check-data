#!/usr/bin/env node
// 보조금24(행정안전부 대한민국 공공서비스(혜택) 정보) 전체를 받아 앱용 정적 JSON을 만들어요.
//
//   GOV24_SERVICE_KEY=... node fetch.mjs [--out ./out] [--per-page 1000] [--keep-raw]
//
// - 키는 환경변수로만 받아요. 키를 파일·로그·출력물에 쓰지 않아요.
// - 받은 건수가 공식 totalCount와 다르면 실패로 끝내요(빈 데이터나 반쪽 데이터를 내보내지 않아요).
// - 종료 코드: 0 성공, 2 키 없음, 3 API 오류·건수 불일치, 4 첫 다운로드 1MB(gzip) 초과
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildSnapshot } from './lib/normalize.mjs';

const BASE = 'https://api.odcloud.kr/api/gov24/v3';
const ENDPOINTS = ['serviceList', 'serviceDetail', 'supportConditions'];
const MIN_EXPECTED = 5000; // 2026-07~10 공개 수집 기록이 1만 건 안팎이에요. 이보다 크게 적으면 이상으로 봐요.

const { values: args } = parseArgs({
  options: {
    out: { type: 'string', default: './out' },
    'per-page': { type: 'string', default: '1000' },
    'keep-raw': { type: 'boolean', default: false },
    'max-per-id': { type: 'string', default: '500' },
  },
});

const rawKey = process.env.GOV24_SERVICE_KEY?.trim();
if (!rawKey) {
  console.error('GOV24_SERVICE_KEY가 없어요. data.go.kr 15113968 활용신청 후 발급된 키를 환경변수로 넣어 주세요.');
  process.exit(2);
}
// 포털은 Encoding 키와 Decoding 키를 둘 다 줘요. '%'가 있으면 이미 인코딩된 키로 봐요.
const encodedKey = rawKey.includes('%') ? rawKey : encodeURIComponent(rawKey);
const perPage = Number(args['per-page']);
const outDir = resolve(args.out);
let calls = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(endpoint, params) {
  const qs = Object.entries({ page: 1, perPage, returnType: 'JSON', ...params })
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  const url = `${BASE}/${endpoint}?${qs}&serviceKey=${encodedKey}`;
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    calls += 1;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000), headers: { accept: 'application/json' } });
      const text = await res.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error(`${endpoint}: JSON이 아니에요 (HTTP ${res.status}) ${text.slice(0, 120)}`);
      }
      if (!res.ok || (typeof body.code === 'number' && body.code < 0)) {
        const err = new Error(`${endpoint}: HTTP ${res.status} code=${body.code} ${body.msg ?? ''}`);
        err.fatal = res.status === 401 || res.status === 403 || body.code === -401;
        throw err;
      }
      if (!Array.isArray(body.data) || !Number.isInteger(body.totalCount)) {
        throw new Error(`${endpoint}: 응답 형식이 달라요 (data/totalCount 없음)`);
      }
      return body;
    } catch (error) {
      lastError = error;
      if (error.fatal) break;
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastError;
}

async function fetchAll(endpoint) {
  const first = await getJson(endpoint, { page: 1 });
  const rows = [...first.data];
  const pages = Math.ceil(first.totalCount / perPage);
  for (let page = 2; page <= pages; page += 1) {
    const body = await getJson(endpoint, { page });
    rows.push(...body.data);
    process.stderr.write(`\r${endpoint} ${page}/${pages}`);
  }
  if (pages > 1) process.stderr.write('\n');
  return { rows, totalCount: first.totalCount };
}

function uniqueIds(rows) {
  return new Set(rows.map((r) => String(r.서비스ID ?? '').trim()).filter(Boolean));
}

function verifyFields(endpoint, rows, required) {
  const sample = rows.find(Boolean);
  const missing = required.filter((f) => !(sample && f in sample));
  if (missing.length) throw new Error(`${endpoint}: 필드가 없어요 ${missing.join(', ')} (응답 필드: ${Object.keys(sample ?? {}).join(', ')})`);
}

async function main() {
  const started = new Date();
  const result = {};
  for (const endpoint of ENDPOINTS) {
    result[endpoint] = await fetchAll(endpoint);
    const ids = uniqueIds(result[endpoint].rows);
    console.error(`${endpoint}: totalCount=${result[endpoint].totalCount} 받은 행=${result[endpoint].rows.length} 고유 ID=${ids.size}`);
  }

  const list = result.serviceList.rows;
  verifyFields('serviceList', list, ['서비스ID', '서비스명', '소관기관명', '소관기관유형', '사용자구분']);
  verifyFields('supportConditions', result.supportConditions.rows, ['서비스ID', 'JA0110', 'JA0111']);
  verifyFields('serviceDetail', result.serviceDetail.rows, ['서비스ID', '신청기한']);

  const listIds = uniqueIds(list);
  if (list.length !== result.serviceList.totalCount || listIds.size < MIN_EXPECTED) {
    throw new Error(`serviceList 건수가 맞지 않아요 (행 ${list.length}, totalCount ${result.serviceList.totalCount}, 고유 ${listIds.size})`);
  }

  // 목록에는 있는데 상세·조건 일괄 응답에 빠진 서비스는 ID로 한 번 더 받아요(하루 호출 한도 때문에 상한을 둬요).
  const maxPerId = Number(args['max-per-id']);
  for (const endpoint of ['serviceDetail', 'supportConditions']) {
    const have = uniqueIds(result[endpoint].rows);
    const missing = [...listIds].filter((id) => !have.has(id));
    const take = missing.slice(0, maxPerId);
    for (const id of take) {
      const body = await getJson(endpoint, { page: 1, perPage: 10, 'cond[서비스ID::EQ]': id });
      result[endpoint].rows.push(...body.data);
    }
    if (missing.length) console.error(`${endpoint}: 일괄 응답에 없던 ${missing.length}건 중 ${take.length}건을 ID로 다시 받았어요.`);
  }

  const { files, report } = buildSnapshot({
    list,
    details: result.serviceDetail.rows,
    conditions: result.supportConditions.rows,
    fetchedAt: started,
  });

  await rm(outDir, { recursive: true, force: true });
  for (const [path, body] of files) {
    const target = join(outDir, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(body));
  }
  if (args['keep-raw']) {
    for (const endpoint of ENDPOINTS) {
      const target = join(outDir, '..', 'raw', `${endpoint}.json`);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, JSON.stringify(result[endpoint]));
    }
  }
  const summary = { ...report, apiCalls: calls, finishedAt: new Date().toISOString() };
  await writeFile(join(outDir, '..', 'fetch-report.json'), JSON.stringify(summary, null, 2));
  const { loan } = report.counts;
  console.error(`대출·융자·보증 제외: 지원유형 ${loan.removedByType}건, 서비스명(지원유형 없음) ${loan.removedByTitle}건. 섞인 유형으로 남긴 것 ${loan.mixedKept}건(fetch-report.json에 목록).`);
  const brief = { ...report.counts, loan: { removedByType: loan.removedByType, removedByTitle: loan.removedByTitle, mixedKept: loan.mixedKept } };
  console.log(JSON.stringify({ counts: brief, worstFirstLoad: report.worstFirstLoad, apiCalls: calls }, null, 2));

  if (report.worstFirstLoad > report.firstLoadLimit) {
    console.error(`첫 다운로드가 ${report.worstFirstLoad}바이트(gzip)로 한도 ${report.firstLoadLimit}를 넘어요.`);
    process.exit(4);
  }
}

main().catch((error) => {
  console.error(String(error?.message ?? error).replaceAll(encodedKey, '***').replaceAll(rawKey, '***'));
  process.exit(3);
});
