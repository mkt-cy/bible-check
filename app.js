import { dateKey, shortDate, weekdayOf, dayChapters, dayLabel, chapterLabel, locate, weekOf, weeks } from './lib/plan.js';
import { newRecord, toggleChapter, setDayDone, setNote, dayState, doneCount, nextToRead, pastUnfinished, spreadPlan, stats, daysToFill } from './lib/progress.js';
import * as store from './lib/store.js';

const DEFAULT_PLAN = 'goodway-2026h2';
const MODES = {
  oldest: { name: '밀린 것부터 차근차근', desc: '이어 읽을 곳부터 순서대로 읽어요' },
  today: { name: '오늘 말씀부터', desc: '지난 말씀은 전체 표에서 생각날 때 채워요' },
  spread: { name: '남은 기간에 나눠 얹기', desc: '오늘 말씀에 지난 말씀 몇 장씩을 덤으로 더해요' },
};

const THEMES = { auto: '자동', light: '밝게', dark: '어둡게' };
const SIZES = { m: '보통', l: '크게', xl: '아주 크게' };

const UA = navigator.userAgent;
const IN_APP = /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\//i.test(UA);
const IS_IOS = /iphone|ipad|ipod/i.test(UA);
const IS_SAMSUNG = /SamsungBrowser/i.test(UA);
const STANDALONE = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

const S = {
  plan: null,
  byCode: null,
  chapterDay: new Map(), // "ROM.1" → 읽기표 일차
  recs: new Map(), // 일차 → 기록
  mode: null,
  name: '',
  onboard: null, // 처음 열 때 환영 흐름: { step: 1|2|3, past: bool }
  choosing: false, // 이어가기 방식 다시 고르는 중
  expanded: new Set(), // 장별 체크를 펼친 카드
  justDone: null, // '밀린 것부터'에서 방금 끝낸 날 — 연타로 다음 날까지 체크되지 않게 잠시 붙잡아 둔다
  sheetDay: null,
  church: null, // data/church.json — 교회 이름·설교 재생목록 (없으면 설교 탭을 숨긴다)
  sermons: [], // data/sermons.json — 매주 GitHub이 받아 오는 설교 영상 목록 (최신순)
  sermonId: null, // 지금 띄운 설교 영상
  qt: [], // data/qt.json — 매일성경 날짜별 QT 제목·본문 (매일 GitHub이 받아 온다)
  qtRecs: new Map(), // 'YYYY-MM-DD' → QT 체크 기록 (통독 기록과 따로, planId 'qt')
  sermonsTried: false, // 설교 목록 첫 받기를 마쳤는지 (못 받았으면 '불러오는 중' 대신 안내)
  storage: { ok: true },
  lastExport: null,
  installPrompt: null,
  lastDate: dateKey(),
};

const $ = (sel) => document.querySelector(sel);

/** 밝기·글자 크기: <html data-theme / data-size> + 상태 표시줄 색 */
function applyLook() {
  const r = document.documentElement;
  r.dataset.theme ||= 'auto';
  r.dataset.size ||= 'm';
  const dark = r.dataset.theme === 'dark' || (r.dataset.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#141f27' : '#f7f0e6');
}
function setLook(key, value) {
  document.documentElement.dataset[key === 'theme' ? 'theme' : 'size'] = value;
  try { localStorage.setItem(key, value); } catch {}
  applyLook();
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const day = (n) => S.plan.days[n - 1];
const label = (d) => dayLabel(d, S.byCode);
const ICON = { done: '✓', partial: '◐', none: '' };

function longDate(key) {
  const [, m, d] = key.split('-').map(Number);
  return `${m}월 ${d}일 (${weekdayOf(key)})`;
}

// ── 시작 ──

async function boot() {
  applyLook();
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyLook);
  S.storage = await store.init({ onBlocked: () => showFatal('앱이 다른 곳에도 열려 있어요. 모두 닫았다가 다시 열어 주세요.') });
  if (S.storage.reason === 'upgrade') return showFatal('기록을 여는 중 문제가 생겼어요. 앱을 완전히 닫았다가 다시 열어 주세요. 기록은 지워지지 않았어요.');

  const planId = await store.getSetting('planId', DEFAULT_PLAN);
  const [plan, books] = await Promise.all([
    fetch(`plans/${planId}.json`).then((r) => r.json()),
    fetch('data/books.json').then((r) => r.json()),
  ]);
  S.plan = plan;
  S.church = await fetch('data/church.json').then((r) => r.json()).catch(() => null);
  // 설교 목록은 기다리지 않는다 — 받아지면 설교 화면만 다시 그린다
  loadQt().then((changed) => { if (changed && (location.hash || '#/') === '#/') render(); });
  loadSermons().finally(() => {
    S.sermonsTried = true;
    if (location.hash === '#/sermons' && !$('.player')) { $('#app').innerHTML = ''; render(); }
  });
  if (!S.church?.sermons?.playlist) $('.tabbar [data-tab="sermons"]')?.remove();
  S.byCode = new Map(books.map((b) => [b.code, b]));
  plan.days.forEach((d) => dayChapters(d).forEach((c) => S.chapterDay.set(c, d.n)));
  S.mode = await store.getSetting('catchupMode', null);
  S.lastExport = await store.getSetting('lastExport', null);
  S.name = await store.getSetting('userName', '');
  await loadRecords();
  if (!S.name) S.onboard = { step: 1, past: false };
  render();
  if (location.hash === '#/plan') document.querySelector('.week.current')?.scrollIntoView({ block: 'start' });

  window.addEventListener('hashchange', () => {
    closeSheet();
    S.justDone = null;
    window.scrollTo(0, 0);
    render();
    if (location.hash === '#/plan') document.querySelector('.week.current')?.scrollIntoView({ block: 'start' });
  });
  window.addEventListener('popstate', () => {
    if (S.sheetDay && !history.state?.sheet) closeSheet(); // 안드로이드 뒤로가기 = 시트 닫기
  });
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden') {
      S.justDone = null;
      return flushNote();
    }
    await refresh(); // 다른 곳에서 바뀐 기록·자정 넘김 반영
  });
  window.addEventListener('pagehide', flushNote);
  // 설교 화면은 인터넷이 필요하다 — 연결이 바뀌면 안내/영상을 바꿔 그린다
  const redrawSermons = () => { if (location.hash === '#/sermons') { $('#app').innerHTML = ''; render(); } };
  window.addEventListener('online', redrawSermons);
  window.addEventListener('offline', redrawSermons);
  store.onExternalChange(refresh);
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installPrompt = e; render(); });
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js');
}

async function loadRecords() {
  S.recs = new Map((await store.listRecords(S.plan.id)).map((r) => [r.day, r]));
  S.qtRecs = new Map((await store.listRecords(QT_PLAN)).map((r) => [qtDate(r.day), r]));
}

// ── QT (매일성경) — 통독과 따로 체크한다. 기록은 통독과 같은 저장소에 planId 'qt', day = 20261101 꼴 ──
const QT_PLAN = 'qt';
const qtDay = (date) => Number(date.replaceAll('-', '')); // '2026-11-01' → 20261101
const qtDate = (n) => String(n).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
const qtDone = (date) => !!S.qtRecs.get(date)?.chapters?.QT;
const qtPage = (date) => `https://sum.su.or.kr:8888/bible/today?qt_ty=${encodeURIComponent(S.church.qt.edition)}&base_de=${date}`;

/** 날짜 창(이번 주·전체 표에서 날짜 누르기) 아래쪽 QT — 지난 QT를 나중에 체크하거나 앞날 본문을 미리 본다 */
function qtSheetBlock(date) {
  const qt = S.church?.qt;
  if (!qt || date < qt.start) return '';
  const today = dateKey();
  const d = S.qt.find((x) => x.date === date);
  if (!d && date > today) return `
    <section class="sheet-qt">
      <p class="kicker">QT · ${esc(qt.name)}</p>
      <p class="meta">이 날 본문은 아직 나오지 않았어요.</p>
    </section>`;
  return `
    <section class="sheet-qt">
      <p class="kicker">QT · ${esc(qt.name)}</p>
      ${d ? `<h3>${esc(d.title)}</h3>` : ''}
      ${qtPassageRow(date, d)}
      ${qtButton(date)}
    </section>`;
}

/** 본문 구절 칩 + 같은 크기의 '본문·해설 보기' 칩 */
const qtPassageRow = (date, d) => `
  <div class="qt-row">
    ${d ? `<span class="passage">${esc(d.passage)}</span>` : ''}
    <a class="passage link-chip" href="${qtPage(date)}" target="_blank" rel="noopener">본문·해설 보기 ↗</a>
  </div>`;
const qtButton = (date) => {
  const done = qtDone(date);
  return `<button class="primary ${done ? 'is-done' : ''}" data-act="qt" data-date="${date}">${done ? '✓ QT 했어요' : 'QT 했어요'}</button>`;
};

async function loadQt() {
  if (!S.church?.qt) return false;
  const days = (await fetch('data/qt.json').then((r) => r.json()).catch(() => null))?.days;
  if (!days || JSON.stringify(days) === JSON.stringify(S.qt)) return false;
  S.qt = days;
  return true;
}

function qtCard(today) {
  const qt = S.church?.qt;
  if (!qt) return '';
  if (today < qt.start) {
    const first = S.qt.find((d) => d.date === qt.start);
    return `
      <section class="card qt">
        <p class="kicker">QT · ${esc(qt.name)}</p>
        <h2>${longDate(qt.start)}부터 함께해요</h2>
        ${first ? `<p class="meta">첫날: ${esc(first.title)} · ${esc(first.passage)}</p>` : ''}
      </section>`;
  }
  const d = S.qt.find((x) => x.date === today);
  const done = qtDone(today);
  return `
    <section class="card qt ${done ? 'done' : ''}">
      <p class="kicker">오늘 QT · ${esc(qt.name)}</p>
      ${d ? `<h2>${esc(d.title)}</h2>` : ''}
      ${qtPassageRow(today, d)}
      ${qtButton(today)}
    </section>`;
}

async function refresh() {
  await loadRecords();
  S.lastDate = dateKey();
  render();
  // 설교 목록은 화면을 먼저 그린 뒤 뒤에서 받는다 (느린 데이터에서도 체크 화면이 기다리지 않게)
  const [qtChanged, sermonsChanged] = await Promise.all([loadQt(), loadSermons()]);
  if (qtChanged || (sermonsChanged && location.hash === '#/sermons')) render();
}

/** 설교 목록 다시 받기 — 앱을 켜 둔 채 일요일 밤을 넘겨도, 다시 열면 새 설교가 보이게 */
async function loadSermons() {
  if (!S.church?.sermons) return;
  const videos = (await fetch('data/sermons.json').then((r) => r.json()).catch(() => null))?.videos;
  if (!videos || videos[0]?.id === S.sermons[0]?.id) return false;
  S.sermons = videos;
  S.sermonId = null;
  if (location.hash === '#/sermons') $('#app').innerHTML = ''; // 설교 화면은 한 번만 그리므로 비워서 새로 그리게
  return true;
}

/** 하루 기록 바꾸기: DB의 최신 기록에 변경을 적용하고 화면을 다시 그린다 */
async function change(n, fn) {
  return changeMany([{ day: n, fn }]);
}

async function changeMany(list) {
  try {
    const saved = await store.update(
      S.plan.id,
      list.map(({ day: n, fn }) => ({ day: n, fn: (cur) => fn(cur ?? newRecord(S.plan.id, n)) })),
    );
    saved.forEach((r) => S.recs.set(r.day, r));
    render();
  } catch {
    await loadRecords();
    render();
    toast('저장되지 않았어요. 다시 눌러 주세요.');
  }
}

const recOf = (n) => S.recs.get(n) ?? newRecord(S.plan.id, n);

// ── 화면 ──

function render() {
  if (!S.plan) return;
  document.body.classList.toggle('onboarding', !!S.onboard);
  if (S.onboard) {
    // 앱을 잠깐 내렸다 와도(다시 그려도) 적던 이름·고른 날이 남게
    const typed = $('.onboard .name')?.value;
    const picked = $('.onboard [data-act="lastDay"]')?.value;
    $('#app').innerHTML = viewOnboard();
    if (typed != null && $('.onboard .name')) $('.onboard .name').value = typed;
    if (picked && $('.onboard [data-act="lastDay"]')) $('.onboard [data-act="lastDay"]').value = picked;
    return;
  }
  const route = location.hash.replace('#/', '') || 'home';
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === route));
  // 영상이 재생 중일 때 다시 그리면 처음으로 돌아가 버린다 → 설교 화면은 한 번만 그린다
  if (route === 'sermons' && S.church?.sermons && $('#app .sermons')) return;
  const view = { home: viewHome, plan: viewPlan, sermons: viewSermons, settings: viewSettings }[route] ?? viewHome;
  preservingNote(() => {
    $('#app').innerHTML = view();
    if (S.sheetDay) renderSheet();
  });
}

/** 다시 그려도 쓰던 묵상 글과 커서가 날아가지 않게 */
function preservingNote(draw) {
  const el = document.activeElement;
  const act = el?.dataset?.act;
  const typing = act === 'note' || act === 'name' ? { act, n: el.dataset.n, inSheet: !!el.closest('.sheet'), value: el.value, at: el.selectionStart } : null;
  draw();
  if (!typing) return;
  const scope = typing.inSheet ? '.sheet' : '#app';
  const again = document.querySelector(typing.act === 'name' ? `${scope} .name` : `${scope} .note[data-n="${typing.n}"]`);
  if (!again) return;
  again.value = typing.value;
  again.focus({ preventScroll: true });
  again.setSelectionRange(typing.at, typing.at);
}

function viewHome() {
  const today = dateKey();
  const loc = locate(S.plan, today);
  const after = loc.phase === 'after';
  const missed = pastUnfinished(S.plan, S.recs, today).length > 0;
  const next = nextToRead(S.plan, S.recs, today);
  const mode = after ? null : S.mode; // 기간이 끝나면 이어 읽기 하나뿐
  const held = S.justDone && dayState(day(S.justDone), S.recs.get(S.justDone)) === 'done' ? day(S.justDone) : null;
  const st = stats(S.recs, today);

  const sub = {
    before: `${longDate(S.plan.start)}에 시작해요`,
    during: `${weekOf(loc.day.n)}주차 · ${loc.day.n}일째`,
    after: '통독 기간이 끝났어요',
  }[loc.phase];

  let cards = '';
  if (!after && missed && (!mode || S.choosing)) cards += chooserCard();

  if (loc.phase === 'before') {
    cards += dayCard(loc.day, '첫날 말씀');
  } else if (after) {
    const focus = held ?? next;
    cards += focus ? dayCard(focus, `이어 읽기 · ${shortDate(focus.date)} 분량`) : finishCard();
    if (held && next) cards += dayRow(next, `다음 이어 읽기 · ${shortDate(next.date)} 분량`);
  } else if (mode === 'oldest' && (missed || held) && (held ?? next) && (held ?? next).n !== loc.day.n) {
    const focus = held ?? next;
    cards += dayCard(focus, `이어 읽기 · ${shortDate(focus.date)} 분량`);
    if (held && next && next.n !== loc.day.n) cards += dayRow(next, `다음 이어 읽기 · ${shortDate(next.date)} 분량`);
    cards += dayRow(loc.day, '오늘 말씀');
  } else {
    cards += dayCard(loc.day, '오늘 말씀');
    if (missed && mode === 'spread') cards += extraCard(today);
  }

  if (!after && missed && mode && !S.choosing) {
    cards += `<p class="modeline">지난 말씀은 <b>${MODES[mode].name}</b> <button class="link" data-act="choose">바꾸기</button></p>`;
  }

  const week = weeks(S.plan)[weekOf(loc.day.n) - 1];
  return `
    <header class="top">
      <p class="eyebrow">${esc(S.name)}님, 안녕하세요!</p>
      <p class="greet">${greeting(today)}</p>
      <h1>${longDate(today)}</h1>
      <p class="sub">${sub}</p>
    </header>
    ${notices()}
    ${cards}
    ${qtCard(today)}
    <section class="card week-strip" aria-label="이번 주">
      <h3>이번 주</h3>
      <div class="strip">${week.days.map((d) => stripCell(d, today)).join('')}</div>
    </section>
    ${statsLine(st)}
    <div class="bar" role="img" aria-label="성경 전체 ${st.chapters}장 읽음"><span style="width:${(st.chapters / 1189) * 100}%"></span></div>
  `;
}

/** 인사 한마디 — 날마다 바뀌고, 같은 날엔 몇 번을 열어도 같다. 재촉하는 말은 넣지 않는다 */
const GREETINGS = [
  '오늘은 좋은 하루예요.',
  '오늘도 말씀과 함께 시작해요.',
  '오늘 하루도 평안하세요.',
  '천천히, 한 장씩 가요.',
  '오늘도 만나서 반가워요.',
  '말씀 앞에 잠시 머무는 시간이에요.',
  '오늘도 함께해서 기뻐요.',
];
function greeting(key) {
  const days = Math.round(Date.UTC(...key.split('-').map((v, i) => (i === 1 ? v - 1 : +v))) / 86400000);
  return GREETINGS[days % GREETINGS.length];
}

/** 줄지 않는 숫자만, 0은 보여 주지 않는다 (월초·처음 쓰는 사람에게 '0일'은 추궁처럼 읽힌다) */
function statsLine(st) {
  const parts = [];
  if (st.daysThisMonth) parts.push(`이번 달 <b>${st.daysThisMonth}</b>일 읽었어요`);
  if (st.chapters) parts.push(`지금까지 <b>${st.chapters.toLocaleString()}</b>장`);
  return parts.length ? `<p class="stats">${parts.join(' · ')}</p>` : '<p class="stats">성경 전체 <b>1,189</b>장, 한 장씩 함께 가요</p>';
}

/** 기록이 엉뚱한 곳에 쌓이지 않게 하는 안내 */
function notices() {
  let out = '';
  if (!S.storage.ok) out += '<p class="warn">이 화면에서는 기록이 저장되지 않아요. 사파리·크롬 일반 창에서 열어 주세요.</p>';
  if (IN_APP) {
    const android = !IS_IOS && /KAKAOTALK/i.test(UA);
    out += `<p class="warn">카톡 같은 앱 안에서 열렸어요. 여기서 체크하면 기록이 따로 저장돼요.<br>
      오른쪽 아래(또는 위) <b>⋯ 메뉴 → 다른 브라우저로 열기</b>${IS_IOS ? '(사파리)' : ''}를 눌러 주세요.
      ${android ? `<br><a class="warn-link" href="kakaotalk://web/openExternal?url=${encodeURIComponent(location.href)}">기본 브라우저로 열기</a>` : ''}</p>`;
  }
  return out;
}

function dayCard(d, kicker) {
  const rec = S.recs.get(d.n);
  const state = dayState(d, rec);
  const total = dayChapters(d).length;
  const open = S.expanded.has(d.n);
  const progress = state === 'partial' ? ` · <b>${doneCount(d, rec)}/${total}장</b> 읽음` : '';
  return `
    <article class="card day ${state}">
      <p class="kicker">${kicker}</p>
      <h2>${label(d)}</h2>
      <p class="meta">${kicker.includes(shortDate(d.date)) ? '' : `${shortDate(d.date)} (${weekdayOf(d.date)}) · `}${total}장${progress}</p>
      <button class="primary ${state === 'done' ? 'is-done' : ''}" data-act="day" data-n="${d.n}">
        ${state === 'done' ? '✓ 다 읽었어요' : '다 읽었어요'}
      </button>
      <button class="link more" data-act="expand" data-n="${d.n}" aria-expanded="${open}">장별로 체크 ${open ? '▴' : '▾'}</button>
      ${open ? chapterGrid(d) : ''}
      ${state !== 'none' ? noteField(d.n, rec.note) : ''}
    </article>`;
}

function dayRow(d, kicker) {
  const state = dayState(d, S.recs.get(d.n));
  return `
    <button class="card row-card ${state}" data-act="open" data-n="${d.n}">
      <span><small>${kicker}</small>${label(d)}</span><span class="st">${ICON[state] || '›'}</span>
    </button>`;
}

function chapterGrid(d) {
  const rec = S.recs.get(d.n);
  return `<div class="chapters">${d.ranges
    .map((r) => {
      const chips = Array.from({ length: r.to - r.from + 1 }, (_, k) => {
        const c = `${r.book}.${r.from + k}`;
        const on = rec?.chapters[c];
        return `<button class="chip ${on ? 'on' : ''}" data-act="ch" data-c="${c}" aria-pressed="${!!on}" aria-label="${chapterLabel(c, S.byCode)}">${r.from + k}</button>`;
      }).join('');
      return `<div class="chgroup"><span class="book">${S.byCode.get(r.book).name}</span><div class="chips">${chips}</div></div>`;
    })
    .join('')}</div>`;
}

function noteField(n, note) {
  return `<input class="note" type="text" maxlength="200" data-act="note" data-n="${n}" value="${esc(note)}" placeholder="한 줄 남기기 (선택)" enterkeyhint="done" />`;
}

function extraCard(today) {
  const { perDay, capped, todayExtra, readToday } = spreadPlan(S.plan, S.recs, today);
  const list = [...readToday, ...todayExtra];
  if (!list.length) return '';
  // 장별 체크와 같은 모양: 책 이름 아래 숫자 칩 (책이 바뀌면 묶음도 바뀜)
  const groups = [];
  for (const c of list) {
    const book = c.split('.')[0];
    if (groups.at(-1)?.book !== book) groups.push({ book, cs: [] });
    groups.at(-1).cs.push(c);
  }
  const chips = groups
    .map(({ book, cs }) => {
      const nums = cs.map((c) => {
        const on = S.recs.get(S.chapterDay.get(c))?.chapters[c];
        return `<button class="chip ${on ? 'on' : ''}" data-act="ch" data-c="${c}" aria-pressed="${!!on}" aria-label="${chapterLabel(c, S.byCode)}">${c.split('.')[1]}</button>`;
      }).join('');
      return `<div class="chgroup"><span class="book">${S.byCode.get(book).name}</span><div class="chips">${nums}</div></div>`;
    })
    .join('');
  const meta = capped
    ? '오늘 말씀만큼 덤으로 더해요. 기간이 끝나도 이어 읽을 수 있어요'
    : `하루 ${perDay}장씩 더하면 ${shortDate(S.plan.end)}에 함께 마쳐요`;
  return `
    <article class="card extra">
      <p class="kicker">덤으로 읽기</p>
      <h2>${todayExtra.length ? '지난 말씀 조금 더' : '오늘 덤은 다 읽었어요 ✓'}</h2>
      <p class="meta">${meta}</p>
      <div class="chapters">${chips}</div>
    </article>`;
}

function modeOptions() {
  return Object.entries(MODES)
    .map(([k, m]) => `<button class="option ${S.mode === k ? 'on' : ''}" data-act="mode" data-mode="${k}"><b>${m.name}</b><small>${m.desc}</small></button>`)
    .join('');
}

function chooserCard() {
  return `
    <article class="card chooser">
      <h2>지난 말씀이 남아 있어요</h2>
      <p class="meta">어떻게 이어갈까요? 언제든 바꿀 수 있어요.</p>
      ${modeOptions()}
      <p class="hint">이미 읽고 계셨다면 <a href="#/plan">전체 표</a>에서 마지막으로 읽은 날을 눌러 <b>여기까지 읽었어요</b>를 고르세요.</p>
    </article>`;
}

function finishCard() {
  return `
    <article class="card finish">
      <p class="kicker">완주</p>
      <h2>성경 전체를 다 읽었어요</h2>
      <p class="meta">${esc(S.plan.title)} · 1,189장</p>
    </article>`;
}

function stripCell(d, today) {
  const state = dayState(d, S.recs.get(d.n));
  const cls = [state, d.date === today ? 'today' : '', d.date > today ? 'future' : ''].join(' ');
  return `
    <button class="cell ${cls}" data-act="open" data-n="${d.n}" aria-label="${shortDate(d.date)} ${label(d)} ${state === 'done' ? '읽음' : ''}">
      <span class="wd">${weekdayOf(d.date)}</span><span class="dt">${shortDate(d.date)}</span><span class="st">${ICON[state] || '·'}</span>${qtDone(d.date) ? '<span class="qt-dot" title="QT">QT</span>' : ''}
    </button>`;
}

function viewPlan() {
  const today = dateKey();
  const cur = weekOf(locate(S.plan, today).day.n);
  const st = stats(S.recs, today);
  return `
    <header class="top">
      <p class="eyebrow">${esc(S.plan.title)}</p>
      <h1>전체 표</h1>
      <p class="sub">${longDate(S.plan.start)} – ${longDate(S.plan.end)} · 지금까지 ${st.chapters.toLocaleString()}장</p>
    </header>
    ${weeks(S.plan)
      .map(({ week, days }) => {
        const done = days.filter((d) => dayState(d, S.recs.get(d.n)) === 'done').length;
        const count = done === days.length ? '✓' : done ? `${done}일 읽음` : ''; // 'n/7'은 모자란 수로 읽힌다
        return `
        <section class="card week ${week === cur ? 'current' : ''}">
          <h3><span class="wk">${week}주</span> ${shortDate(days[0].date)} – ${shortDate(days.at(-1).date)} <span class="count">${count}</span></h3>
          ${days
            .map((d) => {
              const state = dayState(d, S.recs.get(d.n));
              return `
              <button class="plan-row ${state} ${d.date === today ? 'today' : ''}" data-act="open" data-n="${d.n}">
                <span class="wd">${weekdayOf(d.date)}<small>${shortDate(d.date)}</small></span>
                <span class="lbl">${label(d)}</span>
                <span class="st">${ICON[state]}</span>
              </button>`;
            })
            .join('')}
        </section>`;
      })
      .join('')}
  `;
}

function installGuide() {
  if (STANDALONE) return '';
  let how;
  if (IN_APP) how = '먼저 <b>⋯ 메뉴 → 다른 브라우저로 열기</b>를 누른 뒤, 거기서 홈 화면에 추가해 주세요.';
  else if (IS_IOS) how = '사파리 아래쪽 <b>공유 버튼(□↑)</b> → <b>홈 화면에 추가</b>를 누르세요.';
  else if (IS_SAMSUNG) how = '삼성 인터넷 아래쪽 <b>≡ 메뉴</b> → <b>현재 페이지 추가</b> → <b>홈 화면</b>을 누르세요.';
  else how = '크롬 오른쪽 위 <b>⋮ 메뉴</b> → <b>홈 화면에 추가</b> 또는 <b>앱 설치</b>를 누르세요.';
  const carry = IS_IOS && !IN_APP && S.recs.size
    ? '<p class="meta">아이폰의 홈 화면 앱은 사파리와 기록을 따로 보관해요. 추가하기 전에 위에서 <b>내보내기</b> → 홈 화면 앱에서 <b>가져오기</b>를 해 주세요.</p>'
    : '';
  return `
    <section class="card">
      <h3>홈 화면에 추가</h3>
      ${S.installPrompt ? '<button class="secondary" data-act="install">앱으로 설치하기</button>' : ''}
      <p class="meta">${how}</p>
      ${carry}
    </section>`;
}

// ── 설교 (교회 유튜브 재생목록을 앱 안에서) ──

const SERMONS_SHOWN = 4; // 처음에 보이는 설교 목록 수 (나머지는 '더 보기')

function viewSermons() {
  if (!S.church?.sermons) return viewHome();
  const ytLink = `<a class="yt-link" href="https://www.youtube.com/playlist?list=${encodeURIComponent(S.church.sermons.playlist)}" target="_blank" rel="noopener">유튜브에서 전체 설교 보기 ↗</a>`;
  const head = `
    <header class="top">
      <p class="eyebrow">${esc(S.church.name)}</p>
      <h1>설교 말씀</h1>
    </header>`;
  // 재생목록 통째로는 퍼가기가 막혀 있어서, 받아 둔 목록에서 영상 하나씩 띄운다
  const cur = S.sermons.find((v) => v.id === S.sermonId) ?? S.sermons[0];
  if (!navigator.onLine) return `${head}<p class="warn">인터넷에 연결되면 설교 영상을 볼 수 있어요.</p><p class="center">${ytLink}</p>`;
  if (!cur) return `${head}<p class="meta">${S.sermonsTried ? '설교 목록을 불러오지 못했어요.' : '설교 목록을 불러오는 중이에요…'}</p><p class="center">${ytLink}</p>`;
  const more = S.sermons.length - SERMONS_SHOWN;
  return `
    ${head}
    <div class="sermons">
      <div class="player"><iframe src="${playerSrc(cur.id)}" title="${esc(sermonName(cur))}"
        allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
      <section class="now">${nowInfo(cur)}</section>
      <h3 class="list-head">설교 목록</h3>
      <ul class="sermon-list">${S.sermons.map((v) => `
        <li><button class="sermon-row ${v.id === cur.id ? 'on' : ''}" data-act="sermon" data-id="${esc(v.id)}">
          <span class="d">${shortDate(v.date)}</span>
          <span class="t"><b>${esc(sermonName(v))}</b>${v.passage ? `<small>${esc(v.passage)}</small>` : ''}</span>
        </button></li>`).join('')}
      </ul>
      ${more > 0 ? `<button class="secondary more" data-act="moreSermons">이전 설교 ${more}개 더 보기</button>` : ''}
      <p class="center">${ytLink}</p>
    </div>
  `;
}

/** 지금 재생 중인 설교: 날짜·시리즈 / 제목 / 본문 */
function nowInfo(v) {
  return `
    <p class="kicker">${longDate(v.date)}${v.series ? ` · ${esc(v.series)}` : ''}</p>
    <h2>${esc(sermonName(v))}</h2>
    ${v.passage ? `<p class="passage">${esc(v.passage)}</p>` : ''}`;
}

const playerSrc = (id) => `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?rel=0&playsinline=1`;
/** 썸네일에서 읽은 설교 제목, 없으면 유튜브 제목에서 날짜를 뗀 것 ("선한길교회 26.10.25. 일요경건회" → "일요경건회") */
const sermonName = (v) => v.name || v.title.replace(/^.*?\d{2}\.\d{2}\.\d{2}\.\s*/, '') || v.title;

function viewSettings() {
  return `
    <header class="top">
      <p class="eyebrow">${esc(S.plan.title)}</p>
      <h1>설정</h1>
    </header>
    ${notices()}

    <section class="card">
      <h3>이름</h3>
      <input class="note name" type="text" maxlength="20" data-act="name" value="${esc(S.name)}" autocomplete="nickname" enterkeyhint="done" />
      <button class="secondary save-name" data-act="saveName">이름 바꾸기</button>
    </section>

    <section class="card">
      <h3>화면</h3>
      <p class="seg-label">밝기</p>
      <div class="seg" role="group" aria-label="밝기">${segButtons('theme', THEMES)}</div>
      <p class="seg-label">글자 크기</p>
      <div class="seg" role="group" aria-label="글자 크기">${segButtons('size', SIZES)}</div>
    </section>

    <section class="card">
      <h3>지난 말씀 이어가기</h3>
      ${modeOptions()}
      <p class="hint">통독 기간이 끝난 뒤에는 이어 읽기만 보여요.</p>
    </section>

    <section class="card">
      <h3>기록 백업</h3>
      <p class="meta">기록은 <b>이 폰에만</b> 저장되고, 누구에게도 보내지지 않아요. 폰을 바꾸거나 앱을 지우기 전에 꼭 내보내 두세요.</p>
      ${S.lastExport ? `<p class="meta">마지막 내보내기: ${longDate(S.lastExport)}</p>` : ''}
      <div class="btns">
        <button class="secondary" data-act="export">내보내기</button>
        <label class="secondary">가져오기<input type="file" accept="application/json,.json" data-act="import" hidden /></label>
      </div>
    </section>

    ${installGuide()}

    <p class="foot">${esc(S.plan.title)} · ${S.plan.days.length}일 · 1,189장</p>
  `;
}

// ── 처음 열 때 (환영 → 이름 → 어디까지) ──

/** 이미 시작된 통독에 처음 들어온 사람만 '어디까지' 단계를 거친다 */
function needsStartPoint() {
  const loc = locate(S.plan, dateKey());
  return loc.phase === 'during' && loc.day.n > 1 && S.recs.size === 0;
}

function viewOnboard() {
  const o = S.onboard;
  const dots = `<p class="ob-dots" aria-hidden="true">${[1, 2, needsStartPoint() ? 3 : 0].filter(Boolean).map((k) => `<span class="${k === o.step ? 'on' : ''}"></span>`).join('')}</p>`;
  if (o.step === 1) {
    return `
      <section class="onboard">
        ${dots}
        <p class="eyebrow">${esc(S.plan.title)}</p>
        <h1>환영해요</h1>
        <ul class="ob-points">
          <li>매일 <b>오늘 말씀</b>을 읽고 탭 한 번으로 체크해요</li>
          <li>밀려도 괜찮아요. <b>다음 읽을 곳</b>만 알려 드려요</li>
          <li>기록은 <b>이 폰에만</b> 저장되고, 누구에게도 보내지지 않아요</li>
        </ul>
        ${notices()}
        <button class="primary" data-act="obNext">시작하기</button>
      </section>`;
  }
  if (o.step === 2) {
    return `
      <section class="onboard">
        ${dots}
        <h1>뭐라고 불러 드릴까요?</h1>
        <p class="meta">이름이나 별명을 적어 주세요. 이 폰에만 저장돼요.</p>
        <input class="note name" type="text" maxlength="20" data-act="name" value="${esc(S.name)}" placeholder="이름" autocomplete="nickname" enterkeyhint="next" />
        <button class="primary" data-act="obName">다음</button>
      </section>`;
  }
  const today = dateKey();
  const past = S.plan.days.filter((d) => d.date < today).reverse();
  return `
    <section class="onboard">
      ${dots}
      <h1>${esc(S.name)}님, 어디까지 읽으셨어요?</h1>
      <p class="meta">통독은 ${longDate(S.plan.start)}에 시작해서 오늘이 ${locate(S.plan, today).day.n}일째예요.</p>
      <button class="option" data-act="obToday"><b>오늘부터 시작할게요</b><small>지난 말씀은 전체 표에서 생각날 때 채워요</small></button>
      <button class="option ${o.past ? 'on' : ''}" data-act="obPast" aria-expanded="${o.past}"><b>이미 읽고 있었어요</b><small>마지막으로 읽은 날까지 한 번에 체크해요</small></button>
      ${o.past ? `
        <label class="ob-pick">마지막으로 읽은 날
          <select class="note" data-act="lastDay">${past.map((d) => `<option value="${d.n}">${shortDate(d.date)} (${weekdayOf(d.date)}) · ${label(d)}</option>`).join('')}</select>
        </label>
        <button class="primary" data-act="obFill">여기까지 읽었어요</button>` : ''}
      <p class="hint">다른 폰에서 쓰던 기록이 있다면 <label class="link">백업 가져오기<input type="file" accept="application/json,.json" data-act="import" hidden /></label></p>
    </section>`;
}

async function finishOnboard(msg) {
  S.onboard = null;
  if (location.hash && location.hash !== '#/') location.hash = '#/';
  else render();
  window.scrollTo(0, 0);
  if (msg) toast(msg);
}

/** 이름 저장 — 비었으면 저장하지 않고 입력란으로 돌려보낸다 */
async function saveName(input) {
  const value = input.value.trim().replace(/\s+/g, ' ');
  if (!value) {
    toast('이름을 적어 주세요');
    input.focus();
    return false;
  }
  await store.setSetting('userName', value);
  S.name = value;
  return true;
}

function segButtons(key, options) {
  const cur = document.documentElement.dataset[key];
  return Object.entries(options)
    .map(([v, name]) => `<button class="${cur === v ? 'on' : ''}" data-act="look" data-key="${key}" data-value="${v}" aria-pressed="${cur === v}">${name}</button>`)
    .join('');
}

// ── 하루 상세 (아래에서 올라오는 시트) ──

function openSheet(n) {
  if (!S.sheetDay) history.pushState({ sheet: n }, '', location.href); // 뒤로가기로 닫히게
  S.sheetDay = n;
  $('#sheet').hidden = false;
  document.body.classList.add('sheet-open');
  renderSheet();
}

/** 화면 안에서 닫기(닫기 버튼·배경·ESC) — 열 때 쌓아 둔 방문 기록(history)을 되돌리며 닫는다 */
function userCloseSheet() {
  if (history.state?.sheet) history.back(); // popstate에서 실제로 닫힌다
  else closeSheet();
}

function closeSheet() {
  if (!S.sheetDay) return;
  flushNote();
  S.sheetDay = null;
  $('#sheet').hidden = true;
  document.body.classList.remove('sheet-open');
}

function renderSheet() {
  const d = day(S.sheetDay);
  const rec = S.recs.get(d.n);
  const state = dayState(d, rec);
  const fillable = daysToFill(S.plan, S.recs, d.n).filter((x) => x.n !== d.n).length > 0;
  $('.sheet-panel').innerHTML = `
    <div class="grip"></div>
    <p class="kicker">${weekOf(d.n)}주 · ${longDate(d.date)}</p>
    <h2 id="sheet-title">${label(d)}</h2>
    ${rec?.readOn ? `<p class="meta">마지막으로 읽은 날 ${longDate(rec.readOn)}</p>` : ''}
    ${chapterGrid(d)}
    <button class="primary ${state === 'done' ? 'is-done' : ''}" data-act="day" data-n="${d.n}">${state === 'done' ? '✓ 다 읽었어요' : '다 읽었어요'}</button>
    ${state !== 'none' ? noteField(d.n, rec.note) : ''}
    ${fillable ? `<button class="link fill" data-act="fill" data-n="${d.n}">첫날부터 이 날까지 모두 읽었어요</button>` : ''}
    ${qtSheetBlock(d.date)}
    <button class="link close" data-close>닫기</button>`;
}

// ── 묵상 ──

/** 묵상은 화면을 다시 그리지 않고 저장만 한다 (다시 그리면 바로 다음 탭이 사라진다) */
async function saveNote(el) {
  const n = +el.dataset.n;
  const value = el.value.trim();
  if ((S.recs.get(n)?.note ?? '') === value) return false;
  try {
    const [rec] = await store.update(S.plan.id, [{ day: n, fn: (cur) => setNote(cur ?? newRecord(S.plan.id, n), value) }]);
    S.recs.set(n, rec);
    document.querySelectorAll(`.note[data-n="${n}"]`).forEach((x) => x !== el && (x.value = rec.note));
    return true;
  } catch {
    toast('묵상이 저장되지 않았어요. 다시 적어 주세요.');
    return false;
  }
}

function flushNote() {
  const el = document.activeElement;
  if (el?.dataset?.act === 'note') saveNote(el);
}

// ── 동작 ──

const actions = {
  async qt(el) {
    const date = el.dataset.date;
    const now = new Date();
    try {
      const [saved] = await store.update(QT_PLAN, [{
        day: qtDay(date),
        fn: (cur) => {
          const rec = cur ?? newRecord(QT_PLAN, qtDay(date));
          const chapters = rec.chapters.QT ? {} : { QT: dateKey() };
          return { ...rec, chapters, readOn: chapters.QT ?? null, updatedAt: now.toISOString() };
        },
      }]);
      S.qtRecs.set(date, saved);
      render();
      if (qtDone(date)) $('.card.qt .primary')?.classList.add('pop');
    } catch {
      toast('저장되지 않았어요. 다시 눌러 주세요.');
    }
  },
  sermon(el) {
    // 화면을 다시 그리지 않고 영상·제목만 바꾼다 (목록 펼침·스크롤 상태 유지)
    S.sermonId = el.dataset.id;
    const v = S.sermons.find((x) => x.id === S.sermonId);
    const frame = $('.player iframe');
    if (!frame || !v) return;
    frame.src = playerSrc(v.id);
    frame.title = sermonName(v);
    $('.sermons .now').innerHTML = nowInfo(v);
    document.querySelectorAll('.sermon-row').forEach((b) => b.classList.toggle('on', b === el));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },
  moreSermons(el) {
    $('.sermon-list').classList.add('all');
    el.remove();
  },
  obNext() {
    S.onboard.step = 2;
    render();
    $('.onboard .name')?.focus();
  },
  async obName() {
    if (!(await saveName($('.onboard .name')))) return;
    if (!needsStartPoint()) return finishOnboard(`${S.name}님, 반가워요`);
    S.onboard.step = 3;
    render();
  },
  async obToday() {
    S.mode = 'today'; // 중간에 들어온 사람에게 '밀렸다'는 카드부터 보여 주지 않는다
    await store.setSetting('catchupMode', S.mode);
    finishOnboard(`${S.name}님, 반가워요`);
  },
  obPast() {
    S.onboard.past = !S.onboard.past;
    render();
  },
  async obFill() {
    const d = day(+$('.onboard [data-act="lastDay"]').value);
    // 실제 읽은 날은 모르므로 계획 날짜로 남긴다 ('여기까지 읽었어요'와 같은 방식)
    await changeMany(daysToFill(S.plan, S.recs, d.n).map((x) => ({ day: x.n, fn: (rec) => setDayDone(rec, x, true, x.date) })));
    finishOnboard(`${shortDate(d.date)}까지 채웠어요`);
  },
  async saveName() {
    if (await saveName($('.name'))) toast('이름을 바꿨어요');
  },
  async day(el) {
    const d = day(+el.dataset.n);
    const done = dayState(d, S.recs.get(d.n)) === 'done';
    if (done && !confirm('이 날 체크를 모두 지울까요?')) return;
    S.justDone = done ? null : d.n;
    await change(d.n, (rec) => setDayDone(rec, d, !done, dateKey()));
    if (!done) celebrate(d.n);
  },
  async ch(el) {
    const c = el.dataset.c;
    const n = S.chapterDay.get(c);
    const was = dayState(day(n), S.recs.get(n));
    await change(n, (rec) => toggleChapter(rec, c, dateKey()));
    if (was !== 'done' && dayState(day(n), S.recs.get(n)) === 'done') celebrate(n);
  },
  look(el) {
    setLook(el.dataset.key, el.dataset.value);
    render();
  },
  async fill(el) {
    const d = day(+el.dataset.n);
    if (!confirm(`${shortDate(S.plan.start)}부터 ${shortDate(d.date)}까지 체크 안 된 날을 모두 읽음으로 표시할까요?`)) return;
    // 실제 읽은 날은 모르므로 계획 날짜로 남긴다
    const list = daysToFill(S.plan, S.recs, d.n).map((x) => ({ day: x.n, fn: (rec) => setDayDone(rec, x, true, x.date) }));
    await changeMany(list);
    toast('채웠어요');
  },
  expand(el) {
    const n = +el.dataset.n;
    S.expanded.has(n) ? S.expanded.delete(n) : S.expanded.add(n);
    render();
  },
  open(el) {
    openSheet(+el.dataset.n);
  },
  async mode(el) {
    S.mode = el.dataset.mode;
    S.choosing = false;
    render();
    await store.setSetting('catchupMode', S.mode);
  },
  choose() {
    S.choosing = true;
    render();
  },
  async export() {
    if (IN_APP && !confirm('카톡 같은 앱 안에서는 파일 저장이 잘 안 될 수 있어요. 그래도 내보낼까요?')) return;
    const data = await store.exportData();
    const name = `말씀통독-백업-${dateKey()}.json`;
    const file = new File([JSON.stringify(data)], name, { type: 'application/json' });
    let saved;
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: '말씀통독 기록 백업' });
        saved = true;
      } catch (e) {
        if (e.name === 'AbortError') return;
        throw e;
      }
    } else {
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: name });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      // 다운로드가 실제로 됐는지 브라우저가 알려 주지 않는다 — 사람에게 확인
      await new Promise((r) => setTimeout(r, 800));
      saved = confirm('백업 파일이 저장됐나요?\n(다운로드 폴더나 파일 앱에서 확인할 수 있어요)');
    }
    if (!saved) return toast('저장되지 않았어요. 다시 내보내 주세요.');
    S.lastExport = dateKey();
    await store.setSetting('lastExport', S.lastExport);
    render();
  },
  async install() {
    S.installPrompt?.prompt();
    S.installPrompt = null;
  },
};

document.addEventListener('click', async (e) => {
  if (e.target.closest('[data-close]')) return userCloseSheet();
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'INPUT') return;
  try {
    await actions[el.dataset.act]?.(el);
  } catch (err) {
    toast('문제가 생겼어요' + (err?.message ? ': ' + err.message : ''));
  }
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.act === 'note') {
    if (await saveNote(el)) toast('남겼어요');
  }
  if (el.dataset.act === 'import' && el.files[0]) {
    try {
      const data = JSON.parse(await el.files[0].text());
      const count = store.validateBackup(data);
      if (!confirm(`${count}일치 기록이 담긴 백업이에요. 불러올까요?\n같은 날 기록은 합쳐져요.`)) return;
      const n = await store.importData(data);
      S.mode = await store.getSetting('catchupMode', null);
      await loadRecords();
      if (S.onboard) return finishOnboard(n ? `${n}일치 기록을 반영했어요` : '이미 다 들어 있는 기록이에요');
      render();
      toast(n ? `${n}일치 기록을 반영했어요` : '이미 다 들어 있는 기록이에요');
    } catch (err) {
      toast(err instanceof SyntaxError ? '백업 파일을 읽을 수 없어요' : err?.message ?? '불러오지 못했어요');
    } finally {
      el.value = '';
    }
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.sheetDay) userCloseSheet();
  if (e.key === 'Enter' && e.target.dataset?.act === 'note') e.target.blur();
  if (e.key === 'Enter' && e.target.dataset?.act === 'name' && !e.isComposing) {
    e.preventDefault();
    actions[S.onboard ? 'obName' : 'saveName']().catch(() => toast('저장되지 않았어요. 다시 눌러 주세요.'));
  }
});

/** 하루를 다 읽은 순간: 버튼이 살짝 튀고, 안드로이드는 짧게 진동 */
function celebrate(n) {
  const btns = [...document.querySelectorAll(`.primary[data-n="${n}"]`)];
  const visible = btns.filter((b) => b.offsetParent).at(-1); // 시트가 열려 있으면 시트 쪽 버튼
  btns.forEach((b) => {
    b.classList.remove('pop');
    void b.offsetWidth;
    b.classList.add('pop');
  });
  if (visible) confetti(visible);
  navigator.vibrate?.([12, 60, 18]);
}

/**
 * 축하: ① 가운데서 큰 폭죽 ② 버튼 양 끝에서 파티 폭죽(빵빠레)이 안쪽 위로 ③ 리본·반짝이 ④ 🎉 하나가 떠오름
 * 모두 카드 둘레 안에서 퍼졌다 떨어진다. 움직임 줄이기 설정이면 생략
 */
function confetti(btn) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !Element.prototype.animate) return;
  const r = btn.getBoundingClientRect();
  const css = getComputedStyle(document.documentElement);
  const colors = ['--confetti-1', '--confetti-2', '--confetti-3', '--confetti-4'].map((v) => css.getPropertyValue(v).trim());
  const layer = Object.assign(document.createElement('div'), { className: 'confetti' });
  layer.style.left = `${r.left + r.width / 2}px`;
  layer.style.top = `${r.top + r.height / 2}px`;
  document.body.append(layer);
  const rand = (a, b) => a + Math.random() * (b - a);
  const color = (i) => colors[i % colors.length];
  const half = r.width / 2;

  /** 조각 하나: (x0,y0)에서 출발 → (dx,dy)까지 솟았다가 → 아래로 떨어지며 사라짐 */
  function piece(el, { x0 = 0, y0 = 0, dx, dy, fall = 90, rot = rand(-600, 600), dur = rand(1100, 1600), delay = 0, sway = 0 }) {
    layer.append(el);
    const at = (x, y, deg, sc) => `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) rotate(${deg}deg) scale(${sc})`;
    el.animate(
      [
        { transform: at(x0, y0, 0, 0.3), opacity: 1 },
        { transform: at(x0 + dx, y0 + dy, rot * 0.5, 1), opacity: 1, offset: 0.35, easing: 'cubic-bezier(.3,0,.7,1)' },
        { transform: at(x0 + dx * 1.1 + sway, y0 + dy + fall * 0.6, rot * 0.8, 1), opacity: 1, offset: 0.7 },
        { transform: at(x0 + dx * 1.15 - sway, y0 + dy + fall, rot, 0.8), opacity: 0 },
      ],
      { duration: dur, delay, easing: 'cubic-bezier(.15,.8,.35,1)', fill: 'both' },
    );
  }
  function bit(i, big = false) {
    const el = document.createElement('i');
    const kind = i % 4; // 0 동그라미 · 1,2 네모 · 3 긴 리본
    const w = kind === 0 ? rand(6, 9) : kind === 3 ? 4 : rand(6, 10);
    const h = kind === 0 ? w : kind === 3 ? rand(16, 24) : rand(9, 14);
    Object.assign(el.style, { width: `${w * (big ? 1.2 : 1)}px`, height: `${h * (big ? 1.2 : 1)}px`, background: color(i), borderRadius: kind === 0 ? '50%' : '2px' });
    return el;
  }

  // ① 가운데 큰 폭죽 — 위쪽으로 넓게
  const spread = Math.min(half + 70, 240);
  for (let i = 0; i < 56; i++) {
    const ang = (-90 + rand(-80, 80)) * (Math.PI / 180);
    const d = rand(0.35, 1);
    piece(bit(i, i % 5 === 0), { dx: Math.cos(ang) * spread * d, dy: Math.sin(ang) * rand(90, 190) * d - 20, fall: rand(80, 160), delay: rand(0, 80), sway: rand(-20, 20) });
  }
  // ② 양 끝 파티 폭죽 — 조금 늦게, 안쪽 위로 비스듬히
  for (const side of [-1, 1]) {
    for (let i = 0; i < 20; i++) {
      const ang = (side < 0 ? -55 : -125) + rand(-22, 22);
      const rad = ang * (Math.PI / 180);
      const d = rand(80, 170);
      piece(bit(i + side + 7), { x0: side * (half - 12), dx: Math.cos(rad) * d, dy: Math.sin(rad) * d, fall: rand(70, 130), delay: 180 + rand(0, 90), sway: rand(-15, 15) });
    }
  }
  // ③ 반짝이 ✦ — 버튼 둘레에서 켜졌다 꺼짐
  for (let i = 0; i < 9; i++) {
    const el = Object.assign(document.createElement('b'), { className: 'spark', textContent: '✦' });
    el.style.color = color(i + 2);
    el.style.fontSize = `${rand(12, 20)}px`;
    layer.append(el);
    const x = rand(-half - 10, half + 10);
    const y = rand(-110, -30);
    el.animate(
      [
        { transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(0) rotate(0deg)`, opacity: 0 },
        { transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(1.2) rotate(90deg)`, opacity: 1, offset: 0.4 },
        { transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(0) rotate(180deg)`, opacity: 0 },
      ],
      { duration: rand(600, 900), delay: rand(100, 700), fill: 'both' },
    );
  }
  // ④ 🎉 + 한마디가 버튼 위로 떠올라 잠시 머물렀다 사라짐
  const pop = document.createElement('b');
  pop.className = 'party';
  pop.innerHTML = '<span class="party-emoji">🎉</span><span class="party-text">오늘도 수고했어요!</span>';
  pop.setAttribute('role', 'status'); // 화면 읽기 기능에도 들리게
  layer.append(pop);
  const lift = r.height / 2 + 34; // 버튼 바로 위
  pop.animate(
    [
      { transform: 'translate(-50%, -50%) scale(.3)', opacity: 0 },
      { transform: `translate(-50%, calc(-50% - ${lift}px)) scale(1.08)`, opacity: 1, offset: 0.18 },
      { transform: `translate(-50%, calc(-50% - ${lift}px)) scale(1)`, opacity: 1, offset: 0.26 },
      { transform: `translate(-50%, calc(-50% - ${lift + 8}px)) scale(1)`, opacity: 1, offset: 0.85 },
      { transform: `translate(-50%, calc(-50% - ${lift + 22}px)) scale(.96)`, opacity: 0 },
    ],
    { duration: 2200, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'both' },
  );
  pop.querySelector('.party-emoji').animate(
    [{ transform: 'rotate(-25deg) scale(.6)' }, { transform: 'rotate(12deg) scale(1.2)', offset: 0.5 }, { transform: 'rotate(0deg) scale(1)' }],
    { duration: 600, delay: 120, easing: 'ease-out', fill: 'both' },
  );
  setTimeout(() => layer.remove(), 2500);
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2200);
}

function showFatal(msg) {
  $('#app').innerHTML = `<p class="warn">${esc(msg)}</p>`;
}

boot().catch((err) => showFatal(`앱을 여는 중 문제가 생겼어요. 새로고침해 주세요. (${err?.message ?? ''})`));
