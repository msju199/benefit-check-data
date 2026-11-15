// 이 파일의 행은 규칙을 확인하려고 직접 만든 테스트 입력이에요. 실제 서비스 데이터가 아니고 앱에 실리지 않아요.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDeadline } from '../lib/deadline.mjs';
import { verdict } from '../lib/links.mjs';
import { buildSnapshot, compactConditions, isPersonal } from '../lib/normalize.mjs';
import { buildGazetteer, inferRegion } from '../lib/region.mjs';

const gazRows = [
  { 소관기관유형: '광역시도', 소관기관명: '서울특별시' },
  { 소관기관유형: '광역시도', 소관기관명: '경기도' },
  { 소관기관유형: '광역시도', 소관기관명: '부산광역시' },
  { 소관기관유형: '광역시도', 소관기관명: '세종특별자치시' },
  { 소관기관유형: '시군구', 소관기관명: '서울특별시 중구' },
  { 소관기관유형: '시군구', 소관기관명: '부산광역시 중구' },
  { 소관기관유형: '시군구', 소관기관명: '서울특별시 영등포구' },
  { 소관기관유형: '시군구', 소관기관명: '경기도 고양시' },
  { 소관기관유형: '시군구', 소관기관명: '경기도 광주시' },
  { 소관기관유형: '시군구', 소관기관명: '서울특별시 강서구' },
  { 소관기관유형: '시군구', 소관기관명: '부산광역시 서구' },
];
const gaz = buildGazetteer(gazRows);
const r = (type, name) => inferRegion({ 소관기관유형: type, 소관기관명: name }, gaz);

test('지역: 중앙·공공기관은 전국', () => {
  assert.equal(r('중앙행정기관', '보건복지부').scope, 'national');
  assert.equal(r('공공기관', '어떤공단').scope, 'national');
});

test('지역: 시군구·광역은 기관명 그대로', () => {
  assert.deepEqual(r('시군구', '서울특별시 중구'), { scope: 'sigungu', sido: '서울특별시', sigungu: '중구', how: 'exact' });
  assert.deepEqual(r('광역시도', '경기도'), { scope: 'sido', sido: '경기도', sigungu: null, how: 'exact' });
});

test('지역: 시도 접두어가 있는 기관은 그 시도 안에서만 시군구를 찾는다', () => {
  assert.equal(r('교육청', '부산광역시교육청').sido, '부산광역시');
  assert.equal(r('교육청', '부산광역시교육청').scope, 'sido');
  const sub = r('지방공기업', '경기도 고양시 상하수도사업소');
  assert.equal(sub.sigungu, '고양시');
  assert.equal(r('지방공기업', '서울시설공단').sido, '서울특별시');
});

test('지역: 이름이 겹치는 시군구(중구)는 시도 없이 정하지 않는다', () => {
  assert.equal(r('지방출자_출연기관', '중구문화재단').scope, 'unknown');
});

test('지역: 고유한 시군구 이름·어간은 접두어 없이도 정한다', () => {
  assert.equal(r('지방출자_출연기관', '재단법인영등포구미래교육재단').sigungu, '영등포구');
  assert.equal(r('지방공기업', '고양도시관리공사').sigungu, '고양시');
});

test('지역: 광주는 광주광역시와 경기도 광주시가 겹쳐서 어간으로 정하지 않는다', () => {
  assert.equal(r('지방공기업', '광주도시관리공사').scope, 'unknown');
  assert.equal(r('지방출자_출연기관', '광주시민장학회').scope, 'unknown');
  assert.equal(r('지방공기업', '경기도 광주시 수도사업소').sigungu, '광주시');
});

test('지역: 강서구 안의 서구를 잘못 잡지 않는다', () => {
  // 테스트 지명표에서 강서구는 서울에만 있고, 서구는 부산에만 있어요. 긴 이름을 먼저 맞춰야 해요.
  const hit = r('지방출자_출연기관', '강서구장학회');
  assert.equal(hit.sigungu, '강서구');
  assert.equal(hit.sido, '서울특별시');
});

test('신청기한 분류', () => {
  assert.equal(parseDeadline('상시신청').kind, 'always');
  assert.equal(parseDeadline('신청불필요').kind, 'none');
  assert.equal(parseDeadline('별도의 신청절차가 없음').kind, 'none');
  assert.equal(parseDeadline('접수기관 별 상이').kind, 'varies');
  assert.deepEqual(parseDeadline('2026.03.03~2026.12.31'), { kind: 'period', start: '2026-03-03', end: '2026-12-31' });
  assert.deepEqual(parseDeadline('2026. 3. 3. ~ 2026. 4. 30.'), { kind: 'period', start: '2026-03-03', end: '2026-04-30' });
  assert.equal(parseDeadline('매년 1~2월').kind, 'text');
  assert.equal(parseDeadline('1차 2026.01.01~2026.01.31, 2차 2026.07.01~2026.07.31').kind, 'text');
  assert.equal(parseDeadline('').kind, 'empty');
});

test('개인 대상 판별', () => {
  assert.equal(isPersonal('개인'), true);
  assert.equal(isPersonal('개인||법인/시설/단체'), true);
  assert.equal(isPersonal('가구'), true);
  assert.equal(isPersonal('법인/시설/단체'), false);
  assert.equal(isPersonal('소상공인'), false);
});

test('조건 압축은 Y만 남기고 연령은 정수만', () => {
  assert.deepEqual(compactConditions({ 서비스ID: 'x', JA0110: 19, JA0111: '39', JA0101: 'Y', JA0102: null, JA0404: 'y' }), { a: [19, 39], y: ['0101', '0404'] });
  assert.deepEqual(compactConditions({ 서비스ID: 'x', JA0110: null, JA0111: 'abc' }), { a: [null, null], y: [] });
});

test('스냅샷 조립: 개인 대상만, 시도별 파일, 상세 버킷, 기준일', () => {
  const list = [
    ...gazRows.map((g, i) => ({ ...g, 서비스ID: `T${i}`, 서비스명: `테스트${i}`, 사용자구분: '개인', 조회수: i, 수정일시: '20260101000000' })),
    { 서비스ID: 'C1', 서비스명: '법인용', 소관기관유형: '중앙행정기관', 소관기관명: '어느부', 사용자구분: '법인/시설/단체' },
    { 서비스ID: 'N1', 서비스명: '전국용', 소관기관유형: '중앙행정기관', 소관기관명: '어느부', 사용자구분: '개인', 수정일시: '20261101093000' },
  ];
  const { files, report } = buildSnapshot({
    list,
    details: [{ 서비스ID: 'N1', 신청기한: '상시신청', 온라인신청사이트URL: 'www.example.org/apply' }],
    conditions: [{ 서비스ID: 'N1', JA0110: 0, JA0111: 120, JA0101: 'Y' }],
    fetchedAt: new Date('2026-11-15T00:00:00Z'),
  });
  const meta = files.get('meta.json');
  assert.equal(meta.baseDate, '2026-11-15');
  assert.equal(meta.latestSourceUpdate, '2026-11-01');
  assert.equal(meta.counts.personal, list.length - 1);
  assert.equal(report.counts.skippedNonPersonal, 1);
  const national = files.get('index/national.json').items;
  const n1 = national.find((i) => i.id === 'N1');
  assert.deepEqual(n1.c, { a: [0, 120], y: ['0101'] });
  assert.deepEqual(n1.dl, ['always']);
  const detail = files.get(`detail/${String(n1.b).padStart(2, '0')}.json`).items.N1;
  assert.equal(detail.applyUrl, 'https://www.example.org/apply');
  assert.ok(Object.keys(meta.files.sido).includes('서울특별시'));
  assert.ok(meta.regions.find((x) => x.sido === '세종특별자치시'));
  assert.ok(report.worstFirstLoad > 0);
});

test('링크 판정', () => {
  assert.equal(verdict(200), true);
  assert.equal(verdict(302), true);
  assert.equal(verdict(404), false);
  assert.equal(verdict(403), null);
  assert.equal(verdict(429), null);
  assert.equal(verdict(503), null);
});

// 아래 이름·유형은 규칙 확인용 테스트 입력이에요.
import { isLoanTitle, loanTypeOf, loanVerdict } from '../lib/loan.mjs';

test('대출: 지원유형이 전부 융자·대출·보증이면 뺀다', () => {
  assert.equal(loanTypeOf('융자'), 'loan');
  assert.equal(loanTypeOf('대출'), 'loan');
  assert.equal(loanTypeOf('융자||보증'), 'loan');
  assert.equal(loanTypeOf('현금||융자'), 'mixed');
  assert.equal(loanTypeOf('현금'), 'none');
  assert.equal(loanTypeOf('서비스(의료)'), 'none');
  assert.equal(loanTypeOf(''), 'none');
  assert.deepEqual(loanVerdict('융자', '아무 이름'), { exclude: true, why: 'type', mixed: false });
  assert.deepEqual(loanVerdict('현금||융자', '아무 이름'), { exclude: false, why: null, mixed: true });
});

test('대출: 지원유형이 있으면 서비스명은 보지 않는다', () => {
  assert.equal(loanVerdict('현금', '테스트 전세자금 대출').exclude, false);
});

test('대출: 지원유형이 없을 때 서비스명이 대출 상품이면 뺀다', () => {
  for (const t of ['테스트 디딤돌 대출', '생활안정자금(융자)', '테스트 전세자금 융자', '테스트 특례보증 지원', '테스트 노후연금 보증 지원', '테스트 소액대출', '테스트 사업비 융자 지원', '테스트 학자금 융자 지원 (무이자)']) {
    assert.equal(isLoanTitle(t), true, t);
  }
});

test('대출: 이자·보증료 지원, 신용회복, 도서 대출은 남긴다', () => {
  for (const t of ['테스트 전세자금 대출이자 지원', '테스트 보증료 지원', '테스트 학자금대출 신용회복 지원', '테스트 어린이 전집대출 서비스', '테스트 융자금 이차보전 지원', '테스트 임차보증금 지원', '테스트 신용보증수수료 지원', '테스트 학자금대출 채무면제']) {
    assert.equal(isLoanTitle(t), false, t);
  }
});

test('대출: 스냅샷에서 빼고 건수를 남긴다', () => {
  const rows = [
    { 서비스ID: 'L1', 서비스명: '테스트 대출', 지원유형: '융자', 소관기관유형: '중앙행정기관', 소관기관명: '어느부', 사용자구분: '개인' },
    { 서비스ID: 'L2', 서비스명: '테스트 섞임', 지원유형: '현금||융자', 소관기관유형: '중앙행정기관', 소관기관명: '어느부', 사용자구분: '개인' },
    { 서비스ID: 'C1', 서비스명: '테스트 현금', 지원유형: '현금', 소관기관유형: '중앙행정기관', 소관기관명: '어느부', 사용자구분: '개인' },
  ];
  const { files, report } = buildSnapshot({ list: rows, details: [], conditions: [] });
  const ids = files.get('index/national.json').items.map((i) => i.id).sort();
  assert.deepEqual(ids, ['C1', 'L2']);
  assert.equal(report.counts.loan.removedByType, 1);
  assert.equal(report.counts.loan.mixedKept, 1);
  assert.equal(files.get('meta.json').counts.loanExcluded, 1);
});
