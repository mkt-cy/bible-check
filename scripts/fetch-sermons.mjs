// 교회 설교 재생목록(유튜브 RSS) → data/sermons.json
// 이 재생목록은 통째로 퍼가기가 막혀 있어서, 영상 목록을 미리 받아 두고 앱은 영상 하나씩 띄운다.
// 설교 제목·본문은 유튜브 설명란에 없고 썸네일 그림에만 있어서, 맥의 문자 인식(scripts/ocr.swift)으로 읽는다.
// 한 번 읽은 영상은 다시 읽지 않는다 → sermons.json에서 손으로 고친 제목도 그대로 남는다.
// GitHub Actions(.github/workflows/sermons.yml, 맥 환경)가 매주 돌린다. 손으로: npm run sermons (맥에서)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const KEEP = 15; // 앱에 넣는 최근 설교 수
const church = JSON.parse(readFileSync(new URL('../data/church.json', import.meta.url)));
const list = church.sermons.playlist;
const out = new URL('../data/sermons.json', import.meta.url);
let prev = '';
try { prev = readFileSync(out, 'utf8'); } catch {}
const known = new Map((prev ? JSON.parse(prev).videos : []).map((v) => [v.id, v]));

const res = await fetch(`https://www.youtube.com/feeds/videos.xml?playlist_id=${list}`);
if (!res.ok) throw new Error(`재생목록을 못 받음: HTTP ${res.status}`);
const xml = await res.text();

const tag = (s, name) => s.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1] ?? '';
const unxml = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

let videos = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => {
  const title = unxml(tag(e, 'title'));
  // 올린 날이 아니라 설교한 날: 제목의 "26.10.25." → 2026-10-25 (없으면 올린 날)
  const m = title.match(/(\d{2})\.(\d{2})\.(\d{2})\./);
  const date = m ? `20${m[1]}-${m[2]}-${m[3]}` : tag(e, 'published').slice(0, 10);
  return { id: tag(e, 'yt:videoId'), title, date };
}).filter((v) => /^[\w-]{11}$/.test(v.id));
if (!videos.length) throw new Error('영상이 하나도 없음 — 재생목록 주소를 확인');
videos.sort((a, b) => b.date.localeCompare(a.date));
videos = videos.slice(0, KEEP);

// ── 썸네일에서 설교 제목·본문 읽기 ──
let ocrBin = null;
const tmp = mkdtempSync(join(tmpdir(), 'sermons-'));
function ocr(file, raw) {
  if (process.platform !== 'darwin') return null; // 문자 인식은 맥에서만 → 다른 곳에선 날짜만
  if (!ocrBin) {
    ocrBin = join(tmp, 'ocr');
    execFileSync('swiftc', ['-O', new URL('./ocr.swift', import.meta.url).pathname, '-o', ocrBin]);
  }
  return execFileSync(ocrBin, raw ? [file, 'raw'] : [file], { encoding: 'utf8' });
}

const rows = (text) => text.trim().split('\n').map((l) => {
  const [, y, h, s] = l.match(/^(\S+) (\S+) (.*)$/) ?? [];
  return { y: +y, h: +h, s: (s ?? '').trim() };
}).filter((l) => l.s).sort((a, b) => b.y - a.y); // 위에서 아래로

/**
 * 썸네일 글자 → { name, passage, series }
 * 큰 글씨 줄 = 설교 제목(교정 켠 결과), <...> 줄 = 본문·작은 시리즈 줄(교정 끈 결과 — 숫자·'-'가 안 지워진다)
 */
export function parseThumb(text, rawText = text) {
  const name = rows(text).filter((l) => l.h >= 0.09 && !l.s.startsWith('<')).map((l) => l.s).join(' ').replace(/\s+/g, ' ').trim();
  const raw = rows(rawText);
  let passage = raw.find((l) => l.s.startsWith('<'))?.s.slice(1) ?? '';
  // 끝의 '>'를 잘못 읽는 경우: "5:16-182" → "5:16-18" / "7-10철" → "7-10절"
  if (passage.endsWith('>')) passage = passage.slice(0, -1);
  else passage = passage.replace(/(\d)2$/, '$1').replace(/철$/, '절');
  const series = (raw.find((l) => /시리즈/.test(l.s))?.s ?? '')
    .replace(/[①-⑨]/g, (c) => String(c.charCodeAt(0) - 0x245f)) // ③ → 3
    .replace(/\s*\($/, '') // 잘린 괄호
    .replace(/시리즈\(/, '시리즈 (');
  return { name, passage: passage.trim(), series };
}

async function readThumb(id) {
  for (const size of ['maxresdefault', 'sddefault', 'hqdefault']) {
    const r = await fetch(`https://i.ytimg.com/vi/${id}/${size}.jpg`);
    if (!r.ok) continue;
    const file = join(tmp, `${id}.jpg`);
    writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    const text = ocr(file);
    return text ? parseThumb(text, ocr(file, true)) : null;
  }
  return null;
}

for (const v of videos) {
  const old = known.get(v.id);
  if (old?.name) { Object.assign(v, { name: old.name, passage: old.passage, series: old.series }); continue; }
  const info = await readThumb(v.id);
  if (info?.name) { Object.assign(v, info); console.log(`읽음 ${v.date}: ${info.name} <${info.passage}>`); }
}

const next = JSON.stringify({ playlist: list, videos }, null, 1) + '\n';
if (prev === next) console.log('변화 없음');
else { writeFileSync(out, next); console.log(`설교 ${videos.length}개 저장 (최신 ${videos[0].date})`); }
