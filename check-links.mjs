#!/usr/bin/env node
// 상세 파일의 신청 링크(applyUrl)와 정부24 상세 링크(pageUrl)가 열리는지 확인해요.
//
//   node check-links.mjs [--out ./out] [--concurrency 8] [--write]
//
// --write를 주면 상세 파일에 applyOk(true|false|null)를 적어요. 앱은 false인 신청 링크를 숨기고 문의처를 보여줘요.
// 봇 차단(403·405·429)이나 시간 초과는 '깨짐'이 아니라 '확인 못 함(null)'으로 남겨요.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { verdict } from './lib/links.mjs';

const { values: args } = parseArgs({
  options: {
    out: { type: 'string', default: './out' },
    concurrency: { type: 'string', default: '8' },
    write: { type: 'boolean', default: false },
    timeout: { type: 'string', default: '12000' },
  },
});

const outDir = resolve(args.out);
const timeout = Number(args.timeout);
const UA = 'Mozilla/5.0 (compatible; benefit-check-linkcheck/1.0)';

async function probe(url) {
  for (const method of ['HEAD', 'GET']) {
    try {
      const res = await fetch(url, { method, redirect: 'follow', signal: AbortSignal.timeout(timeout), headers: { 'user-agent': UA } });
      res.body?.cancel?.();
      const v = verdict(res.status);
      if (method === 'HEAD' && v !== true) continue;
      return { ok: v, status: res.status };
    } catch (error) {
      if (method === 'GET') return { ok: error?.cause?.code === 'ENOTFOUND' ? false : null, status: String(error?.cause?.code ?? error?.name ?? 'error') };
    }
  }
  return { ok: null, status: 'unknown' };
}

async function main() {
  const dir = join(outDir, 'detail');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  const docs = new Map();
  const urls = new Map(); // url -> ids
  for (const file of files) {
    const doc = JSON.parse(await readFile(join(dir, file), 'utf8'));
    docs.set(file, doc);
    for (const [id, d] of Object.entries(doc.items)) {
      for (const url of [d.applyUrl, d.pageUrl]) if (url) urls.set(url, [...(urls.get(url) ?? []), id]);
    }
  }
  const queue = [...urls.keys()];
  const results = new Map();
  let done = 0;
  await Promise.all(
    Array.from({ length: Number(args.concurrency) }, async () => {
      while (queue.length) {
        const url = queue.shift();
        results.set(url, await probe(url));
        done += 1;
        if (done % 100 === 0) process.stderr.write(`\r${done}/${urls.size}`);
      }
    }),
  );
  process.stderr.write('\n');

  const tally = { ok: 0, broken: 0, unknown: 0 };
  for (const r of results.values()) tally[r.ok === true ? 'ok' : r.ok === false ? 'broken' : 'unknown'] += 1;

  if (args.write) {
    for (const [file, doc] of docs) {
      for (const d of Object.values(doc.items)) d.applyOk = d.applyUrl ? (results.get(d.applyUrl)?.ok ?? null) : null;
      await writeFile(join(dir, file), JSON.stringify(doc));
    }
  }
  const report = { checkedAt: new Date().toISOString(), urls: urls.size, tally, broken: [...results].filter(([, r]) => r.ok === false).map(([url, r]) => ({ url, status: r.status, ids: urls.get(url) })) };
  await writeFile(join(outDir, '..', 'link-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ urls: urls.size, tally }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
