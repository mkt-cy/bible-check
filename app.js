import { dateKey, shortDate, weekdayOf, dayChapters, dayLabel, chapterLabel, locate, weekOf, weeks } from './lib/plan.js';
import { newRecord, toggleChapter, setDayDone, setNote, dayState, doneCount, nextToRead, pastUnfinished, spreadPlan, stats, daysToFill } from './lib/progress.js';
import * as store from './lib/store.js';

const DEFAULT_PLAN = 'goodway-2026h2';
const MODES = {
  oldest: { name: '밀린 것부터 차근차근', desc: '이어 읽을 곳부터 순서대로 읽어요' },
  today: { name: '오늘 말씀부터', desc: '지난 말씀은 전체 표에서 생각날 때 채워요' },
  spread: { name: '남은 기간에 나눠 얹기', desc: '오늘 말씀에 지난 말씀 몇 장씩을 덤으로 더해요' },
};

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
  choosing: false, // 이어가기 방식 다시 고르는 중
  expanded: new Set(), // 장별 체크를 펼친 카드
  justDone: null, // '밀린 것부터'에서 방금 끝낸 날 — 연타로 다음 날까지 체크되지 않게 잠시 붙잡아 둔다
  sheetDay: null,
  storage: { ok: true },
  lastExport: null,
  installPrompt: null,
  lastDate: dateKey(),
};

const $ = (sel) => document.querySelector(sel);
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
  S.storage = await store.init({ onBlocked: () => showFatal('앱이 다른 곳에도 열려 있어요. 모두 닫았다가 다시 열어 주세요.') });
  if (S.storage.reason === 'upgrade') return showFatal('기록을 여는 중 문제가 생겼어요. 앱을 완전히 닫았다가 다시 열어 주세요. 기록은 지워지지 않았어요.');

  const planId = await store.getSetting('planId', DEFAULT_PLAN);
  const [plan, books] = await Promise.all([
    fetch(`plans/${planId}.json`).then((r) => r.json()),
    fetch('data/books.json').then((r) => r.json()),
  ]);
  S.plan = plan;
  S.byCode = new Map(books.map((b) => [b.code, b]));
  plan.days.forEach((d) => dayChapters(d).forEach((c) => S.chapterDay.set(c, d.n)));
  S.mode = await store.getSetting('catchupMode', null);
  S.lastExport = await store.getSetting('lastExport', null);
  await loadRecords();
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
  store.onExternalChange(refresh);
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installPrompt = e; render(); });
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js');
}

async function loadRecords() {
  S.recs = new Map((await store.listRecords(S.plan.id)).map((r) => [r.day, r]));
}

async function refresh() {
  await loadRecords();
  S.lastDate = dateKey();
  render();
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
  const route = location.hash.replace('#/', '') || 'home';
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === route));
  const view = { home: viewHome, plan: viewPlan, settings: viewSettings }[route] ?? viewHome;
  preservingNote(() => {
    $('#app').innerHTML = view();
    if (S.sheetDay) renderSheet();
  });
}

/** 다시 그려도 쓰던 묵상 글과 커서가 날아가지 않게 */
function preservingNote(draw) {
  const el = document.activeElement;
  const typing = el?.dataset?.act === 'note' ? { n: el.dataset.n, inSheet: !!el.closest('.sheet'), value: el.value, at: el.selectionStart } : null;
  draw();
  if (!typing) return;
  const scope = typing.inSheet ? '.sheet' : '#app';
  const again = document.querySelector(`${scope} .note[data-n="${typing.n}"]`);
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
      <p class="eyebrow">${esc(S.plan.title)}</p>
      <h1>${longDate(today)}</h1>
      <p class="sub">${sub}</p>
    </header>
    ${notices()}
    ${cards}
    <section class="card week-strip" aria-label="이번 주">
      <h3>이번 주</h3>
      <div class="strip">${week.days.map((d) => stripCell(d, today)).join('')}</div>
    </section>
    <p class="stats">이번 달 <b>${st.daysThisMonth}</b>일 읽었어요 · 지금까지 <b>${st.chapters.toLocaleString()}</b>장</p>
    <div class="bar" role="img" aria-label="성경 전체 ${st.chapters}장 읽음"><span style="width:${(st.chapters / 1189) * 100}%"></span></div>
  `;
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
      <p class="meta">${shortDate(d.date)} (${weekdayOf(d.date)}) · ${total}장${progress}</p>
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
  const chips = list
    .map((c) => {
      const on = S.recs.get(S.chapterDay.get(c))?.chapters[c];
      return `<button class="chip wide ${on ? 'on' : ''}" data-act="ch" data-c="${c}" aria-pressed="${!!on}">${chapterLabel(c, S.byCode)}</button>`;
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
      <div class="chips">${chips}</div>
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
      <span class="wd">${weekdayOf(d.date)}</span><span class="dt">${shortDate(d.date)}</span><span class="st">${ICON[state] || '·'}</span>
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

function viewSettings() {
  return `
    <header class="top">
      <p class="eyebrow">${esc(S.plan.title)}</p>
      <h1>설정</h1>
    </header>
    ${notices()}

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
    ${fillable ? `<button class="secondary fill" data-act="fill" data-n="${d.n}">여기까지 읽었어요</button>
      <p class="hint">첫날부터 이 날까지 체크 안 된 날을 한 번에 채워요.</p>` : ''}
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
  async day(el) {
    const d = day(+el.dataset.n);
    const done = dayState(d, S.recs.get(d.n)) === 'done';
    if (done && !confirm('이 날 체크를 모두 지울까요?')) return;
    S.justDone = done ? null : d.n;
    await change(d.n, (rec) => setDayDone(rec, d, !done, dateKey()));
  },
  async ch(el) {
    const c = el.dataset.c;
    await change(S.chapterDay.get(c), (rec) => toggleChapter(rec, c, dateKey()));
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
});

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
