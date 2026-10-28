// 「매일성경」 날짜별 QT 제목·본문 구절 → data/qt.json
// 성서유니온 '오늘의 묵상' 페이지는 2주쯤 앞까지 미리 열려 있다 → 매일 돌면서 새로 열린 날만 받는다.
// 본문·해설 글은 저작권이 있어 받지 않는다 (앱은 제목·구절만 보여 주고 그날 페이지로 연결).
// GitHub Actions(.github/workflows/qt.yml)가 매일 새벽 돌린다. 손으로: npm run qt
import { readFileSync, writeFileSync } from 'node:fs';

const AHEAD = 21; // 오늘부터 며칠 앞까지 확인할지
const KEEP_PAST = 60; // 지난 날은 며칠치까지 남길지
const church = JSON.parse(readFileSync(new URL('../data/church.json', import.meta.url)));
const { edition, start } = church.qt;
const out = new URL('../data/qt.json', import.meta.url);
let prev = '';
try { prev = readFileSync(out, 'utf8'); } catch {}
const days = new Map((prev ? JSON.parse(prev).days : []).map((d) => [d.date, d]));

// 한국 날짜 기준
const kst = (offset) => new Date(Date.now() + 9 * 3600000 + offset * 86400000).toISOString().slice(0, 10);
export const pageUrl = (date) => `https://sum.su.or.kr:8888/bible/today?qt_ty=${edition}&base_de=${date}`;

/** "고린도후서(2 Corinthians) 1:23 - 2:17" → "고린도후서 1:23-2:17" / "3:1 - 3:18" → "3:1-18" */
export function shortPassage(s) {
  const m = s.match(/^(.+?)\s*(?:\([^)]*\))?\s+(\d+):(\d+)\s*-\s*(\d+):(\d+)$/);
  if (!m) return s.replace(/\([^)]*\)/, '').replace(/\s+/g, ' ').trim();
  const [, book, c1, v1, c2, v2] = m;
  return c1 === c2 ? `${book} ${c1}:${v1}${v1 === v2 ? '' : `-${v2}`}` : `${book} ${c1}:${v1}-${c2}:${v2}`;
}

const text = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ');

async function fetchDay(date) {
  const res = await fetch(pageUrl(date), { headers: { 'User-Agent': 'Mozilla/5.0 (bible-check; daily once)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const m = text(await res.text()).match(/매일성경 (\d{4})\.(\d{2})\.(\d{2}) \(.\) (.{1,80}?) 본문 : (.{1,80}?) 찬송가/);
  if (!m || `${m[1]}-${m[2]}-${m[3]}` !== date) return null; // 아직 안 열린 날
  return { date, title: m[4].trim(), passage: shortPassage(m[5].trim()) };
}

let added = 0;
try {
  for (let i = -3; i <= AHEAD; i++) {
    const date = kst(i);
    if (date < start || days.has(date)) continue;
    const day = await fetchDay(date);
    if (!day) break; // 이 날부터는 아직 안 열림
    days.set(date, day);
    added++;
    console.log(`받음 ${date}: ${day.title} (${day.passage})`);
    await new Promise((ok) => setTimeout(ok, 500)); // 사이트에 부담 주지 않게 천천히
  }
} catch (e) {
  // 사이트가 잠깐 안 될 때는 실패로 끝내지 않는다 (다음 날 다시)
  console.log(`사이트 응답 없음 (${e.message}) — 받은 데까지만 저장`);
}

const cut = kst(-KEEP_PAST);
const list = [...days.values()].filter((d) => d.date >= cut).sort((a, b) => a.date.localeCompare(b.date));
const next = JSON.stringify({ name: church.qt.name, edition, days: list }, null, 1) + '\n';
if (prev === next) console.log('변화 없음');
else { writeFileSync(out, next); console.log(`QT ${list.length}일 저장 (새로 ${added}일, 마지막 ${list.at(-1)?.date ?? '-'})`); }
