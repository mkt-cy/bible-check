// 읽기표 계산 — 화면·저장소와 무관한 순수 함수

const pad = (n) => String(n).padStart(2, '0');

/** 기기 현지 날짜 → "YYYY-MM-DD" */
export function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return dateKey(new Date(y, m - 1, d + n));
}

export function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
export function weekdayOf(key) {
  const [y, m, d] = key.split('-').map(Number);
  return WEEKDAYS[new Date(y, m - 1, d).getDay()];
}

/** "2026-10-03" → "10/3" */
export function shortDate(key) {
  const [, m, d] = key.split('-').map(Number);
  return `${m}/${d}`;
}

/** 하루 분량의 장 코드 목록: ["ACT.28", "ROM.1", …] */
export function dayChapters(day) {
  return day.ranges.flatMap((r) => Array.from({ length: r.to - r.from + 1 }, (_, k) => `${r.book}.${r.from + k}`));
}

const unit = (code) => (code === 'PSA' ? '편' : '장');

/** 분량 표기: "마태복음 1-7장" / "사도행전 28장-로마서 6장" / "욥기 38장-시편 2편" */
export function dayLabel(day, booksByCode) {
  const first = day.ranges[0];
  const last = day.ranges.at(-1);
  const name = (code) => booksByCode.get(code).name;
  if (day.ranges.length === 1) {
    const r = first;
    return r.from === r.to ? `${name(r.book)} ${r.from}${unit(r.book)}` : `${name(r.book)} ${r.from}-${r.to}${unit(r.book)}`;
  }
  return `${name(first.book)} ${first.from}${unit(first.book)}-${name(last.book)} ${last.to}${unit(last.book)}`;
}

/** 장 코드 → "로마서 3장" */
export function chapterLabel(code, booksByCode) {
  const [book, ch] = code.split('.');
  return `${booksByCode.get(book).name} ${ch}${unit(book)}`;
}

/** 오늘이 읽기표의 어디쯤인지 */
export function locate(plan, today) {
  if (today < plan.start) return { phase: 'before', day: plan.days[0] };
  if (today > plan.end) return { phase: 'after', day: plan.days.at(-1) };
  return { phase: 'during', day: plan.days[daysBetween(plan.start, today)] };
}

export const weekOf = (n) => Math.floor((n - 1) / 7) + 1;

export function weeks(plan) {
  const out = [];
  plan.days.forEach((d) => {
    const w = weekOf(d.n);
    (out[w - 1] ||= { week: w, days: [] }).days.push(d);
  });
  return out;
}
