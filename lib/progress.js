// 진도 계산·기록 변경 — 순수 함수 (저장은 store.js 몫)
import { dayChapters, daysBetween } from './plan.js';

/**
 * 기록 1건 = 읽기표 하루치
 * { id, planId, day, chapters: { "ROM.1": "2026-07-24" }, readOn, note, updatedAt, deleted }
 * chapters 값은 그 장을 실제로 읽은(체크한) 날짜
 */
// randomUUID는 https·localhost에서만 있음 → 같은 와이파이 http 테스트·구형 사파리용 대체
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function newRecord(planId, day) {
  return { id: uuid(), planId, day, chapters: {}, readOn: null, note: '', updatedAt: null, deleted: false };
}

const touch = (rec, now) => ({ ...rec, updatedAt: now.toISOString() });
const latest = (chapters) => Object.values(chapters).sort().at(-1) ?? null;

export function toggleChapter(rec, code, today, now = new Date()) {
  const chapters = { ...rec.chapters };
  if (chapters[code]) delete chapters[code];
  else chapters[code] = today;
  return touch({ ...rec, chapters, readOn: latest(chapters) }, now);
}

/** 하루 전체 체크(done=true) 또는 전체 해제 */
export function setDayDone(rec, day, done, today, now = new Date()) {
  const chapters = {};
  if (done) for (const c of dayChapters(day)) chapters[c] = rec.chapters[c] ?? today;
  return touch({ ...rec, chapters, readOn: latest(chapters) }, now);
}

export function setNote(rec, note, now = new Date()) {
  return touch({ ...rec, note: note.trim() }, now);
}

export function doneCount(day, rec) {
  if (!rec) return 0;
  return dayChapters(day).filter((c) => rec.chapters[c]).length;
}

/** 'done' | 'partial' | 'none' */
export function dayState(day, rec) {
  const n = doneCount(day, rec);
  if (n === 0) return 'none';
  return n === dayChapters(day).length ? 'done' : 'partial';
}

/** 오늘 이전 날짜 중 다 못 읽은 날들 (계획 순서) */
export function pastUnfinished(plan, recs, today) {
  return plan.days.filter((d) => d.date < today && dayState(d, recs.get(d.n)) !== 'done');
}

/** 이어 읽을 날: 오늘까지 중 가장 먼저 다 못 읽은 날 */
export function nextToRead(plan, recs, today) {
  return plan.days.find((d) => d.date <= today && dayState(d, recs.get(d.n)) !== 'done') ?? null;
}

/**
 * '나눠 얹기' — 지난 분량을 남은 기간(오늘~마지막 날)에 고르게 얹는다.
 * 오늘 이미 읽은 지난 장은 오늘 몫으로 쳐서, 덤을 읽을수록 목록이 끝없이 밀려나지 않게 한다.
 * 하루 덤은 그날 본 분량을 넘기지 않는다(마지막 며칠에 몰아 읽기 방지) — 넘치면 capped=true.
 * 반환: { perDay, capped, todayExtra: 오늘 더 읽을 지난 장, readToday: 오늘 이미 읽은 지난 장 }
 */
export function spreadPlan(plan, recs, today) {
  const past = plan.days.filter((d) => d.date < today);
  const unread = [];
  const readToday = [];
  for (const d of past) {
    const rec = recs.get(d.n);
    for (const c of dayChapters(d)) {
      const at = rec?.chapters[c];
      if (!at) unread.push(c);
      else if (at === today) readToday.push(c);
    }
  }
  const remainingDays = Math.max(1, daysBetween(today, plan.end) + 1);
  const todayDay = plan.days.find((d) => d.date === today);
  const ceiling = todayDay ? dayChapters(todayDay).length : Infinity;
  const needed = Math.ceil((unread.length + readToday.length) / remainingDays);
  const perDay = Math.min(needed, ceiling);
  const left = Math.max(0, perDay - readToday.length);
  return { perDay, capped: needed > ceiling, todayExtra: unread.slice(0, left), readToday };
}

/** '여기까지 읽었어요' — 1일차부터 n일차까지 다 못 읽은 날을 계획 날짜로 채운다 */
export function daysToFill(plan, recs, n) {
  return plan.days.filter((d) => d.n <= n && dayState(d, recs.get(d.n)) !== 'done');
}

/** 줄어들지 않는 누적 숫자: 이번 달 읽은 날 수, 지금까지 읽은 장 수 */
export function stats(recs, today) {
  const month = today.slice(0, 7);
  const dates = new Set();
  let chapters = 0;
  for (const rec of recs.values()) {
    for (const at of Object.values(rec.chapters)) {
      chapters++;
      if (at.startsWith(month)) dates.add(at);
    }
  }
  return { daysThisMonth: dates.size, chapters };
}
