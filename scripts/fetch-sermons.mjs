// 교회 설교 재생목록(유튜브 RSS) → data/sermons.json
// 이 재생목록은 통째로 퍼가기가 막혀 있어서, 영상 목록을 미리 받아 두고 앱은 영상 하나씩 띄운다.
// GitHub Actions(.github/workflows/sermons.yml)가 매주 돌린다. 손으로: npm run sermons
import { readFileSync, writeFileSync } from 'node:fs';

const church = JSON.parse(readFileSync(new URL('../data/church.json', import.meta.url)));
const list = church.sermons.playlist;
const res = await fetch(`https://www.youtube.com/feeds/videos.xml?playlist_id=${list}`);
if (!res.ok) throw new Error(`재생목록을 못 받음: HTTP ${res.status}`);
const xml = await res.text();

const tag = (s, name) => s.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1] ?? '';
const unxml = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

const videos = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => {
  const title = unxml(tag(e, 'title'));
  // 올린 날이 아니라 설교한 날: 제목의 "26.10.25." → 2026-10-25 (없으면 올린 날)
  const m = title.match(/(\d{2})\.(\d{2})\.(\d{2})\./);
  const date = m ? `20${m[1]}-${m[2]}-${m[3]}` : tag(e, 'published').slice(0, 10);
  return { id: tag(e, 'yt:videoId'), title, date };
}).filter((v) => /^[\w-]{11}$/.test(v.id));

if (!videos.length) throw new Error('영상이 하나도 없음 — 재생목록 주소를 확인');
videos.sort((a, b) => b.date.localeCompare(a.date));
const out = new URL('../data/sermons.json', import.meta.url);
const next = JSON.stringify({ playlist: list, videos }, null, 1) + '\n';
let prev = '';
try { prev = readFileSync(out, 'utf8'); } catch {}
if (prev === next) console.log('변화 없음');
else { writeFileSync(out, next); console.log(`설교 ${videos.length}개 저장 (최신 ${videos[0].date})`); }
