// 저장소 — 앱은 이 파일의 함수로만 기록을 읽고 쓴다.
// 지금은 폰 안(IndexedDB). 나중에 Supabase 동기화를 붙일 때 바꿀 곳은 여기뿐.

const DB_NAME = 'bible-check';
const VERSION = 1;
const IMPORTABLE_SETTINGS = ['catchupMode']; // lastExport 등 '이 폰의 사정'은 가져오지 않는다

let db = null;
let memory = null; // IndexedDB를 못 쓰는 환경(사생활 보호 모드 등)용 임시 저장
const channel = typeof window !== 'undefined' && 'BroadcastChannel' in window ? new BroadcastChannel('bible-check') : null; // 브라우저에서만

function open(onBlocked) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    // 버전을 올릴 때는 아래에 `if (e.oldVersion < 2) {…}` 단계를 추가한다 (기존 기록 유지)
    req.onupgradeneeded = (e) => {
      const d = req.result;
      if (e.oldVersion < 1) {
        const records = d.createObjectStore('records', { keyPath: 'id' });
        records.createIndex('planDay', ['planId', 'day'], { unique: true });
        d.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onblocked = onBlocked; // 옛 버전 앱이 다른 곳에 열려 있음
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 트랜잭션 하나를 실행하고, 실패하면 반드시 Error로 끝낸다 */
function tx(stores, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    const fail = (e) => reject(t.error ?? e?.target?.error ?? new Error('저장하지 못했어요'));
    t.oncomplete = () => resolve(result);
    t.onerror = fail;
    t.onabort = fail;
    Promise.resolve(fn(t, (v) => (result = v))).catch((e) => {
      try { t.abort(); } catch {}
      reject(e);
    });
  });
}

const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

/**
 * 반환: { ok: 계속 저장되는지, reason?: 'private' | 'blocked' | 'upgrade' }
 * 'private'만 메모리 모드로 떨어진다. 업그레이드 실패를 사생활 모드로 착각해 기록이 0장처럼 보이면 안 된다.
 */
export async function init({ onBlocked } = {}) {
  if (typeof indexedDB === 'undefined') return useMemory();
  try {
    db = await open(onBlocked);
    db.onversionchange = () => { db.close(); location.reload(); }; // 새 버전 앱이 열리면 비켜 준다
    navigator.storage?.persist?.(); // 브라우저가 공간 정리할 때 지우지 않도록 요청
    return { ok: true };
  } catch (e) {
    if (['VersionError', 'AbortError', 'ConstraintError'].includes(e?.name)) return { ok: false, reason: 'upgrade', error: e };
    return useMemory();
  }
}

function useMemory() {
  memory = { records: new Map(), settings: new Map() };
  return { ok: false, reason: 'private' };
}

export async function listRecords(planId) {
  const all = memory ? [...memory.records.values()] : await tx('records', 'readonly', (t, set) => req(t.objectStore('records').getAll()).then(set));
  return all.filter((r) => r.planId === planId && !r.deleted);
}

/**
 * 여러 날의 기록을 한 트랜잭션에서 '현재 저장된 값'을 기준으로 고친다.
 * 화면이 들고 있던 옛 기록이 아니라 DB의 최신 기록에 변경을 적용하므로, 앱이 두 곳에 열려 있어도 서로 덮어쓰지 않는다.
 * changes: [{ day, fn: (현재 기록 | null) => 새 기록 }]  반환: 저장된 기록들
 */
export async function update(planId, changes) {
  let saved;
  if (memory) {
    saved = changes.map(({ day, fn }) => {
      const cur = [...memory.records.values()].find((r) => r.planId === planId && r.day === day) ?? null;
      const next = cur ? { ...fn(cur), id: cur.id } : fn(null);
      memory.records.set(next.id, next);
      return next;
    });
  } else {
    saved = await tx('records', 'readwrite', async (t, set) => {
      const s = t.objectStore('records');
      const out = [];
      for (const { day, fn } of changes) {
        const cur = (await req(s.index('planDay').get([planId, day]))) ?? null;
        const next = cur ? { ...fn(cur), id: cur.id } : fn(null);
        s.put(next);
        out.push(next);
      }
      set(out);
    });
  }
  channel?.postMessage('changed');
  return saved;
}

/** 다른 탭·설치 앱에서 기록이 바뀌면 알려 준다 */
export function onExternalChange(cb) {
  if (channel) channel.onmessage = cb;
}

export async function getSetting(key, fallback = null) {
  const row = memory ? memory.settings.get(key) : await tx('settings', 'readonly', (t, set) => req(t.objectStore('settings').get(key)).then(set));
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  const row = { key, value };
  if (memory) return void memory.settings.set(key, row);
  await tx('settings', 'readwrite', (t) => void t.objectStore('settings').put(row));
}

// ── 내보내기 / 가져오기 ──

export async function exportData() {
  const records = memory ? [...memory.records.values()] : await tx('records', 'readonly', (t, set) => req(t.objectStore('records').getAll()).then(set));
  const settings = (await Promise.all(IMPORTABLE_SETTINGS.map(async (key) => ({ key, value: await getSetting(key) })))).filter((r) => r.value != null);
  return { app: 'bible-check', format: 1, exportedAt: new Date().toISOString(), records, settings };
}

const isRecord = (r) =>
  r && typeof r.id === 'string' && typeof r.planId === 'string' && Number.isInteger(r.day) && r.day > 0 &&
  r.chapters && typeof r.chapters === 'object' && !Array.isArray(r.chapters) &&
  Object.values(r.chapters).every((v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v));

/** 백업 파일 검사. 반환: 기록 수. 문제가 있으면 한국어 Error */
export function validateBackup(data) {
  if (data?.app !== 'bible-check' || !Array.isArray(data.records)) throw new Error('말씀통독 체크 백업 파일이 아니에요');
  if (!data.records.every(isRecord)) throw new Error('백업 파일 일부가 손상됐어요. 아무것도 바뀌지 않았어요.');
  return data.records.filter((r) => !r.deleted).length;
}

/** 같은 날 기록 두 개를 합친다: 읽은 장은 합집합(먼저 읽은 날짜 유지), 묵상은 최근에 고친 쪽 */
export function mergeRecords(cur, inc) {
  const chapters = { ...cur.chapters };
  for (const [c, at] of Object.entries(inc.chapters)) if (!chapters[c] || at < chapters[c]) chapters[c] = at;
  const newer = (inc.updatedAt ?? '') > (cur.updatedAt ?? '') ? inc : cur;
  const note = newer.note || cur.note || inc.note || '';
  return {
    ...cur,
    chapters,
    readOn: Object.values(chapters).sort().at(-1) ?? null,
    note,
    updatedAt: [cur.updatedAt, inc.updatedAt].filter(Boolean).sort().at(-1) ?? null,
    deleted: false,
  };
}

const sameRecord = (a, b) => a.note === b.note && JSON.stringify(Object.entries(a.chapters).sort()) === JSON.stringify(Object.entries(b.chapters).sort());

/** 전부 반영하거나 하나도 반영하지 않는다. 반환: 실제로 바뀐 날 수 */
export async function importData(data) {
  validateBackup(data);
  const incoming = data.records.filter((r) => !r.deleted);
  const settings = (data.settings ?? []).filter((s) => IMPORTABLE_SETTINGS.includes(s?.key));
  const plan = (cur, inc) => (cur ? mergeRecords(cur, inc) : { ...inc, deleted: false });

  let changed = 0;
  if (memory) {
    for (const inc of incoming) {
      const cur = [...memory.records.values()].find((r) => r.planId === inc.planId && r.day === inc.day);
      const next = plan(cur, inc);
      if (!cur || !sameRecord(cur, next)) { memory.records.set(next.id, next); changed++; }
    }
    for (const s of settings) memory.settings.set(s.key, s);
    return changed;
  }
  await tx(['records', 'settings'], 'readwrite', async (t) => {
    const rs = t.objectStore('records');
    for (const inc of incoming) {
      const cur = await req(rs.index('planDay').get([inc.planId, inc.day]));
      const next = plan(cur, inc);
      if (cur && sameRecord(cur, next)) continue;
      rs.put(next);
      changed++;
    }
    for (const s of settings) t.objectStore('settings').put({ key: s.key, value: s.value });
  });
  channel?.postMessage('changed');
  return changed;
}
