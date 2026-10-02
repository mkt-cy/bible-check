// 읽기표 마크다운(주차별 표) → plans/<id>.json 변환 + 검증
// 사용: node scripts/build-plan.mjs <reading-plan.md> <id> "<제목>" <연도> <읽는 순서: NT,OT>
// 예:   node scripts/build-plan.mjs ../Growth_mkt-cy/01_ME/faith/reading-plan.md goodway-2026h2 "선한길 6개월 말씀통독" 2026 NT,OT
import { readFileSync, writeFileSync } from 'node:fs';

const [src, id, title, year, order = 'OT,NT'] = process.argv.slice(2);
if (!src || !id || !title || !year) {
  console.error('사용: node scripts/build-plan.mjs <md> <id> "<제목>" <연도> [NT,OT]');
  process.exit(1);
}

const books = JSON.parse(readFileSync(new URL('../data/books.json', import.meta.url)));
const byName = new Map(books.map((b) => [b.name, b]));
// 읽는 순서대로 책을 늘어놓은 목록 (예: 신약 → 구약)
const sequence = order.split(',').flatMap((t) => books.filter((b) => b.testament === t));
const seqIndex = new Map(sequence.map((b, i) => [b.code, i]));

const pad = (n) => String(n).padStart(2, '0');

// "마가복음 14장-누가복음 3장" / "마태복음 1-7장" / "시편 146편-잠언 2장" / "빌레몬서 1장"
function parseLabel(label) {
  const s = label.replace(/\s+/g, ' ').trim();
  let m = s.match(/^(\S+) (\d+)[장편]-(\S+) (\d+)[장편]$/);
  if (m) return expand(book(m[1]), +m[2], book(m[3]), +m[4]);
  m = s.match(/^(\S+) (\d+)-(\d+)[장편]$/);
  if (m) return expand(book(m[1]), +m[2], book(m[1]), +m[3]);
  m = s.match(/^(\S+) (\d+)[장편]$/);
  if (m) return expand(book(m[1]), +m[2], book(m[1]), +m[2]);
  throw new Error(`분량을 해석할 수 없음: "${label}"`);
}

function book(name) {
  const b = byName.get(name);
  if (!b) throw new Error(`모르는 책 이름: "${name}"`);
  return b;
}

// 시작 책·장 ~ 끝 책·장 사이를 읽는 순서대로 펼쳐 책별 범위로 만든다
function expand(b1, c1, b2, c2) {
  const i1 = seqIndex.get(b1.code);
  const i2 = seqIndex.get(b2.code);
  if (i2 < i1) throw new Error(`범위 순서가 거꾸로임: ${b1.name} → ${b2.name}`);
  const ranges = [];
  for (let i = i1; i <= i2; i++) {
    const b = sequence[i];
    const from = i === i1 ? c1 : 1;
    const to = i === i2 ? c2 : b.chapters;
    if (from < 1 || to > b.chapters || from > to) throw new Error(`장 범위 오류: ${b.name} ${from}-${to}`);
    ranges.push({ book: b.code, from, to });
  }
  return ranges;
}

// 표 파싱: "| 월 7/6 | 화 7/7 |" 헤더 줄 다음의 내용 줄을 짝지어 읽는다
const lines = readFileSync(src, 'utf8').split('\n');
const cells = (line) => line.split('|').slice(1, -1).map((c) => c.trim());
const days = [];
for (let i = 0; i < lines.length; i++) {
  const head = lines[i].trim();
  if (!/^\|\s*[월화수목금토일] \d+\/\d+/.test(head)) continue;
  const dates = cells(head).map((c) => c.split(' ')[1]);
  const labels = cells(lines[i + 2]);
  if (labels.length !== dates.length) throw new Error(`${i + 1}행: 날짜 ${dates.length}개 / 분량 ${labels.length}개`);
  dates.forEach((md, k) => {
    const [mo, d] = md.split('/').map(Number);
    days.push({ date: `${year}-${pad(mo)}-${pad(d)}`, ranges: parseLabel(labels[k]) });
  });
}
days.forEach((d, i) => (d.n = i + 1));

// ── 검증 ──
const errors = [];
for (let i = 1; i < days.length; i++) {
  const prev = new Date(days[i - 1].date + 'T00:00:00Z');
  const cur = new Date(days[i].date + 'T00:00:00Z');
  if (cur - prev !== 86400000) errors.push(`날짜가 이어지지 않음: ${days[i - 1].date} → ${days[i].date}`);
}
const read = days.flatMap((d) => d.ranges.flatMap((r) => Array.from({ length: r.to - r.from + 1 }, (_, k) => `${r.book}.${r.from + k}`)));
const expected = sequence.flatMap((b) => Array.from({ length: b.chapters }, (_, k) => `${b.code}.${k + 1}`));
const seen = new Map();
read.forEach((c) => seen.set(c, (seen.get(c) || 0) + 1));
const dup = [...seen].filter(([, n]) => n > 1).map(([c]) => c);
const missing = expected.filter((c) => !seen.has(c));
if (dup.length) errors.push(`중복된 장: ${dup.join(', ')}`);
if (missing.length) errors.push(`빠진 장: ${missing.join(', ')}`);
if (!dup.length && !missing.length && read.join() !== expected.join()) errors.push('장 순서가 읽는 순서와 다름');

if (errors.length) {
  console.error('검증 실패:\n- ' + errors.join('\n- '));
  process.exit(1);
}

const plan = { id, title, start: days[0].date, end: days.at(-1).date, days: days.map(({ n, date, ranges }) => ({ n, date, ranges })) };
const out = new URL(`../plans/${id}.json`, import.meta.url);
writeFileSync(out, JSON.stringify(plan) + '\n');
console.log(`✓ ${days.length}일 · ${read.length}장 · ${plan.start} ~ ${plan.end} → plans/${id}.json`);
