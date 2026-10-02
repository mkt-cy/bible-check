import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dayChapters, dayLabel, locate, weeks, addDays, weekdayOf } from '../lib/plan.js';
import { newRecord, toggleChapter, setDayDone, dayState, nextToRead, pastUnfinished, spreadPlan, stats, setNote, daysToFill } from '../lib/progress.js';

const plan = JSON.parse(readFileSync(new URL('../plans/goodway-2026h2.json', import.meta.url)));
const books = JSON.parse(readFileSync(new URL('../data/books.json', import.meta.url)));
const byCode = new Map(books.map((b) => [b.code, b]));
const day = (n) => plan.days[n - 1];

// 날짜 d까지 계획대로 다 읽은 기록
function readUntil(lastN, readOn = (d) => d.date) {
  const recs = new Map();
  for (const d of plan.days.slice(0, lastN)) recs.set(d.n, setDayDone(newRecord(plan.id, d.n), d, true, readOn(d)));
  return recs;
}

test('분량 표기가 원본 읽기표와 같다', () => {
  const md = readFileSync(new URL('../../Growth_mkt-cy/01_ME/faith/reading-plan.md', import.meta.url), 'utf8');
  const rows = md.split('\n').filter((l, i, a) => /^\|\s*[월화수목금토일] \d+\/\d+/.test(a[i - 2] ?? ''));
  const original = rows.flatMap((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
  assert.equal(original.length, 173);
  plan.days.forEach((d, i) => assert.equal(dayLabel(d, byCode), original[i], `${d.date}`));
});

test('요일·주차', () => {
  assert.equal(weekdayOf(plan.start), '월');
  assert.equal(weeks(plan).length, 25);
  assert.equal(weeks(plan).at(-1).days.length, 5);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('오늘 위치: 시작 전 / 진행 중 / 끝난 뒤', () => {
  assert.equal(locate(plan, '2026-07-01').phase, 'before');
  assert.equal(locate(plan, '2026-10-03').day.n, 90);
  assert.equal(dayLabel(locate(plan, '2026-10-03').day, byCode), '역대상 8-13장');
  assert.equal(locate(plan, '2026-12-26').phase, 'after');
});

test('장 체크 → 일부 → 전체 → 해제', () => {
  const d = day(18); // 사도행전 28장-로마서 6장
  let rec = newRecord(plan.id, 18);
  rec = toggleChapter(rec, 'ACT.28', '2026-07-23');
  assert.equal(dayState(d, rec), 'partial');
  rec = setDayDone(rec, d, true, '2026-07-24');
  assert.equal(dayState(d, rec), 'done');
  assert.equal(rec.chapters['ACT.28'], '2026-07-23', '먼저 읽은 장의 날짜는 유지');
  assert.equal(rec.readOn, '2026-07-24');
  rec = setDayDone(rec, d, false, '2026-07-24');
  assert.equal(dayState(d, rec), 'none');
  assert.equal(rec.readOn, null);
  assert.equal(setNote(rec, '  은혜  ').note, '은혜');
});

test('이어 읽을 곳 / 지난 미완료', () => {
  const recs = readUntil(56); // 8/30까지 읽음
  const today = '2026-10-03';
  assert.equal(nextToRead(plan, recs, today).n, 57);
  assert.equal(pastUnfinished(plan, recs, today).length, 89 - 56);
  assert.equal(nextToRead(plan, readUntil(173), today), null);
});

test('나눠 얹기: 오늘 덤을 읽어도 목표가 밀려나지 않는다', () => {
  const today = '2026-10-03';
  const recs = readUntil(56);
  const before = spreadPlan(plan, recs, today);
  assert.ok(before.perDay > 0);
  assert.equal(before.todayExtra.length, before.perDay);
  // 덤 목록을 오늘 다 읽으면 오늘 덤은 0
  for (const c of before.todayExtra) {
    const n = plan.days.find((d) => dayChapters(d).includes(c)).n;
    recs.set(n, toggleChapter(recs.get(n) ?? newRecord(plan.id, n), c, today));
  }
  const after = spreadPlan(plan, recs, today);
  assert.equal(after.perDay, before.perDay);
  assert.deepEqual(after.todayExtra, []);
  // 밀린 게 없으면 덤도 없다
  assert.deepEqual(spreadPlan(plan, readUntil(89), today).todayExtra, []);
});

test('누적 기록', () => {
  const s = stats(readUntil(89), '2026-10-03');
  assert.equal(s.daysThisMonth, 2); // 10/1, 10/2
  assert.equal(s.chapters, plan.days.slice(0, 89).flatMap(dayChapters).length);
});

test('나눠 얹기: 하루 덤은 그날 분량을 넘지 않는다', () => {
  const r = spreadPlan(plan, new Map(), '2026-12-24'); // 아무것도 안 읽고 끝 무렵
  assert.equal(r.capped, true);
  assert.ok(r.perDay <= dayChapters(plan.days.find((d) => d.date === '2026-12-24')).length);
});

test('여기까지 읽었어요: 다 읽은 날은 건너뛴다', () => {
  const recs = readUntil(3);
  assert.deepEqual(daysToFill(plan, recs, 5).map((d) => d.n), [4, 5]);
});
