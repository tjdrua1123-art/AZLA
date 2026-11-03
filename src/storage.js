import { cloneEq, migrateEq, PRESETS } from './eq.js';
const KEY = 'azla_equalizer_v3';
const validName = name => typeof name === 'string' && name.trim().length > 0 && name.length <= 36 && !['__proto__', 'constructor', 'prototype'].includes(name.trim());
export function normalizePresets(value) {
  const entries = Array.isArray(value) ? value.map(v => [v?.name, v?.eq]) : value && typeof value === 'object' ? Object.entries(value) : [];
  const map = new Map();
  for (const [name, eq] of entries.slice(0, 100)) {
    if (!validName(name)) continue;
    try { map.set(name.trim(), { name: name.trim(), eq: migrateEq(eq) }); } catch { /* discard invalid stored entries */ }
  }
  return [...map.values()];
}
export function restore(storage) {
  const fallback = { current: cloneEq(PRESETS.find(p => p.id === 'music').eq), selected: 'music', presets: [], advanced: false };
  try {
    const value = JSON.parse(storage.getItem(KEY) || 'null');
    if (value) return { current: migrateEq(value.current), selected: typeof value.selected === 'string' ? value.selected : 'custom', presets: normalizePresets(value.presets), advanced: value.advanced === true };
    const old = JSON.parse(storage.getItem('azla_cb5100_presets_v2') || storage.getItem('azla_cb5100_presets_v1') || '{}');
    fallback.presets = normalizePresets(old);
    const last = JSON.parse(storage.getItem('azla_cb5100_last_eq_v2') || storage.getItem('azla_cb5100_last_eq_v1') || 'null');
    if (last?.eq) { fallback.current = migrateEq(last.eq); fallback.selected = 'custom'; }
  } catch { /* preserve originals; never overwrite unknown storage during load */ }
  return fallback;
}
export function persist(storage, state) {
  storage.setItem(KEY, JSON.stringify({ version: 3, current: cloneEq(state.eq), selected: state.selected, presets: normalizePresets(state.presets), advanced: state.advanced === true }));
}
export function importBackup(text) {
  if (typeof text !== 'string' || text.length > 200000) throw new Error('프리셋 파일은 200 KB 이하 JSON이어야 합니다.');
  const parsed = JSON.parse(text);
  if (!['azla-equalizer-v3', 'azla-cb5100-eq-v1', 'azla-cb5100-eq-v2'].includes(parsed?.format)) throw new Error('AZLA 프리셋 JSON 파일을 선택해 주세요.');
  const presets = normalizePresets(parsed.presets);
  const current = parsed.current ? migrateEq(parsed.current) : null;
  if (!presets.length && !current) throw new Error('불러올 수 있는 EQ 설정이 없습니다.');
  return { presets, current };
}
export function exportBackup(state) {
  return { format: 'azla-equalizer-v3', bands: 10, exportedAt: new Date().toISOString(), current: cloneEq(state.eq), presets: normalizePresets(state.presets) };
}
