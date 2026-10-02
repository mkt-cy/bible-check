import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeRecords, validateBackup } from '../lib/store.js';

const rec = (chapters, updatedAt, note = '') => ({ id: 'a', planId: 'p', day: 90, chapters, readOn: null, note, updatedAt, deleted: false });

test('같은 날 기록은 장을 합치고 먼저 읽은 날짜를 남긴다', () => {
  const phoneNew = rec({ '1CH.11': '2026-10-03' }, '2026-10-03T02:00:00Z');
  const backup = rec({ '1CH.8': '2026-10-03', '1CH.9': '2026-10-03', '1CH.11': '2026-10-02' }, '2026-10-03T01:00:00Z', '은혜');
  const m = mergeRecords(phoneNew, backup);
  assert.deepEqual(Object.keys(m.chapters).sort(), ['1CH.11', '1CH.8', '1CH.9']);
  assert.equal(m.chapters['1CH.11'], '2026-10-02');
  assert.equal(m.note, '은혜', '빈 묵상이 있는 묵상을 지우지 않는다');
  assert.equal(m.updatedAt, '2026-10-03T02:00:00Z');
  assert.equal(m.id, 'a');
});

test('손상된 백업은 아무것도 반영하기 전에 거른다', () => {
  assert.throws(() => validateBackup({ app: 'x', records: [] }), /백업 파일이 아니에요/);
  assert.throws(() => validateBackup({ app: 'bible-check', records: [{ id: 1 }] }), /손상/);
  assert.equal(validateBackup({ app: 'bible-check', records: [rec({}, null)] }), 1);
});
