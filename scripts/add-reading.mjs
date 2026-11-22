// 교회 성경읽기(매주 단톡방에 올라오는 '이번 주 성경 읽기 본문') → data/reading.json
// 쓰는 법: 단톡방 글을 그대로 복사해서
//   pbpaste | npm run reading          (맥: 복사한 글을 바로)
//   npm run reading < 붙여넣은글.txt
// "11/17(화) 로마서 4-5장" 같은 줄만 골라 읽는다. 같은 날짜가 이미 있으면 새 글로 바꾼다.
// 연도는 오늘 기준으로 정한다 (12월에 1월 표를 넣으면 다음 해로).
import { readFileSync, writeFileSync } from 'node:fs';

const books = JSON.parse(readFileSync(new URL('../data/books.json', import.meta.url)));
const out = new URL('../data/reading.json', import.meta.url);
const church = JSON.parse(readFileSync(new URL('../data/church.json', import.meta.url)));
let prev = '';
try { prev = readFileSync(out, 'utf8'); } catch {}
const days = new Map((prev ? JSON.parse(prev).days : []).map((d) => [d.date, d]));

// 책 이름: 긴 이름부터 맞춰 본다 ("요한일서"가 "요한"에 먼저 걸리지 않게)
const byName = [...books].sort((a, b) => b.name.length - a.name.length);

/** "로마서 4-5장" / "로마서 16장-고린도전서 2장" / "시편 1-10편" → ranges */
export function parsePassage(s) {
  const t = s.replace(/\s+/g, ' ').trim();
  const book = (str) => byName.find((b) => str.startsWith(b.name));
  // 두 권에 걸친 분량: "로마서 16장-고린도전서 2장"
  const cross = t.match(/^(.+?)\s*(\d+)\s*[장편]?\s*[-~]\s*(.+?)\s*(\d+)\s*[장편]$/);
  if (cross) {
    const a = book(cross[1]); const b = book(cross[3]);
    if (a && b && a.code !== b.code) {
      return [{ book: a.code, from: +cross[2], to: a.chapters }, { book: b.code, from: 1, to: +cross[4] }];
    }
  }
  // 한 권 또는 여러 권: "로마서 4-5장" / "디도서 1-3장, 빌레몬서 1장" / "요한이서 요한삼서 유다서"(1장짜리 책은 장 생략 가능)
  const out = [];
  let rest = t;
  while ((rest = rest.replace(/^[\s,·]+/, ''))) {
    const b = book(rest);
    if (!b) return null;
    rest = rest.slice(b.name.length);
    const m = rest.match(/^\s*(\d+)\s*(?:[장편]?\s*[-~]\s*(\d+))?\s*[장편]?/);
    let from; let to;
    if (m) { from = +m[1]; to = +(m[2] ?? m[1]); rest = rest.slice(m[0].length); }
    else if (b.chapters === 1) { from = 1; to = 1; }
    else return null;
    if (from < 1 || to > b.chapters || from > to) return null;
    out.push({ book: b.code, from, to });
  }
  return out.length ? out : null;
}

const now = new Date(Date.now() + 9 * 3600000); // 한국 시각
function yearFor(month) {
  const y = now.getUTCFullYear(); const m = now.getUTCMonth() + 1;
  if (m === 12 && month === 1) return y + 1;
  if (m === 1 && month === 12) return y - 1;
  return y;
}

const input = readFileSync(0, 'utf8');
let added = 0; const skipped = [];
for (const line of input.split('\n')) {
  const m = line.match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*(?:\([^)]*\))?\s*(.+)$/);
  if (!m || /\d+\s*\/\s*\d+\s*[~-]\s*\d+\s*\/\s*\d+/.test(line)) continue; // 제목 줄 "(11/16~11/22)"은 건너뛴다
  const [, mo, da, rest] = m;
  const passage = rest.trim();
  const ranges = parsePassage(passage);
  if (!ranges) { skipped.push(line.trim()); continue; }
  const date = `${yearFor(+mo)}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}`;
  days.set(date, { date, passage, ranges });
  added++;
  console.log(`${date}  ${passage}`);
}
if (skipped.length) console.log(`\n못 읽은 줄 ${skipped.length}개 (책 이름·장 확인):\n  ${skipped.join('\n  ')}`);
if (!added) { console.log('넣을 줄이 없어요. "11/17(화) 로마서 4-5장" 꼴인지 확인해 주세요.'); process.exit(1); }

const list = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
const next = JSON.stringify({ name: church.reading?.name ?? '성경읽기', days: list }, null, 1) + '\n';
if (prev === next) console.log('\n변화 없음');
else { writeFileSync(out, next); console.log(`\n${added}일 넣음 → 전체 ${list.length}일 (${list[0].date} ~ ${list.at(-1).date})`); }
