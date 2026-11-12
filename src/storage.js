import { cloneEq, PRESETS } from './eq.js';

const KEY = 'azla_equalizer_v5';
const DEVICE_STATE_KEY = 'azla_equalizer_device_state_v1';
const OBSOLETE_KEYS = Object.freeze([
  'azla_equalizer_v4',
  'azla_equalizer_v3',
  'azla_cb5100_presets_v2',
  'azla_cb5100_presets_v1',
  'azla_cb5100_last_eq_v2',
  'azla_cb5100_last_eq_v1'
]);

const flat = () => cloneEq(PRESETS.find(profile => profile.id === 'flat').eq);

/**
 * v5 stores only advanced-controls visibility, never the current editor.
 * Named sounds use a separate store and survive ordinary UI preference writes.
 */
export function restore(storage) {
  let advanced = false;
  try {
    const current = JSON.parse(storage.getItem(KEY) || 'null');
    if (current) advanced = current.advanced === true;
    else {
      const previous = JSON.parse(storage.getItem('azla_equalizer_v4') || 'null');
      advanced = previous?.advanced === true;
    }
  } catch { /* use a fresh 기본 사운드 screen */ }

  for (const key of OBSOLETE_KEYS) {
    try { storage.removeItem?.(key); } catch { /* never restore removed save formats */ }
  }
  return { current: flat(), selected: 'flat', advanced };
}

export function persist(storage, state) {
  storage.setItem(KEY, JSON.stringify({ version: 5, advanced: state.advanced === true }));
}

/**
 * This is an audit record of the last EQ that this app sent with a Flash
 * command. It is deliberately separate from user presets and never restores
 * the editor on launch. The device SDK can read only a Tag ID, not ten bands.
 */
export function restoreDeviceSnapshot(storage) {
  try {
    const value = JSON.parse(storage.getItem(DEVICE_STATE_KEY) || 'null');
    if (!value || value.version !== 1) return null;
    if (![value.vendorId, value.productId].every(number => Number.isInteger(number) && number >= 0 && number <= 65535)) return null;
    if (!Number.isInteger(value.tag) || value.tag < 0 || value.tag > 255 || typeof value.savedAt !== 'string') return null;
    const eq = cloneEq(value.eq);
    if (eq.tag !== value.tag) return null;
    return { version: 1, vendorId: value.vendorId, productId: value.productId, tag: value.tag, savedAt: value.savedAt, eq };
  } catch { return null; }
}

export function persistDeviceSnapshot(storage, evidence) {
  if (evidence?.result !== 'flash-command-transmitted') throw new Error('Flash 전송이 완료된 EQ만 현재 상태로 기록할 수 있습니다.');
  const eq = cloneEq(evidence.eq), vendorId = evidence.device?.vendorId, productId = evidence.device?.productId;
  if (![vendorId, productId].every(number => Number.isInteger(number) && number >= 0 && number <= 65535)) throw new Error('장치 식별 정보를 확인할 수 없습니다.');
  const value = { version: 1, vendorId, productId, tag: eq.tag, savedAt: String(evidence.time || new Date().toISOString()), eq };
  storage.setItem(DEVICE_STATE_KEY, JSON.stringify(value));
  return { ...value, eq: cloneEq(eq) };
}

const SOUNDS_KEY = 'azla_equalizer_sounds_v1';

export function soundName(value) {
  if (typeof value !== 'string') throw new Error('사운드 이름을 입력해 주세요.');
  const name = value.trim().normalize('NFC');
  if (!name || name.length > 40 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('사운드 이름은 1~40자로 입력해 주세요.');
  return name;
}
function soundRecord(value) {
  if (!value || typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value.id)) throw new Error('사운드 정보를 확인할 수 없습니다.');
  return { id: value.id, name: soundName(value.name), eq: cloneEq(value.eq) };
}
function distinctSound(records, record) {
  if (records.some(item => item.id === record.id || item.name.toLocaleLowerCase('ko-KR') === record.name.toLocaleLowerCase('ko-KR'))) throw new Error('이미 사용 중인 이름입니다. 다른 이름을 입력해 주세요.');
}
export function restoreSounds(storage) {
  try {
    const value = JSON.parse(storage.getItem(SOUNDS_KEY) || 'null');
    if (value?.version !== 1 || !Array.isArray(value.sounds)) return [];
    const records = [];
    for (const item of value.sounds) {
      try { const record = soundRecord(item); distinctSound(records, record); records.push(record); }
      catch { /* One damaged entry must not hide the rest of the library. */ }
    }
    return records;
  } catch { return []; }
}
export function persistSounds(storage, sounds) {
  if (!Array.isArray(sounds)) throw new Error('사운드 목록을 확인할 수 없습니다.');
  const records = [];
  for (const item of sounds) { const record = soundRecord(item); distinctSound(records, record); records.push(record); }
  storage.setItem(SOUNDS_KEY, JSON.stringify({ version: 1, sounds: records }));
  return records;
}
