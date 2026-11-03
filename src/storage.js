import { cloneEq, PRESETS } from './eq.js';

const KEY = 'azla_equalizer_v5';
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
 * v5 deliberately removes named user sounds and previous EQ snapshots.
 * Only the advanced-controls visibility preference survives a restart.
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
  } catch { /* use a fresh FLAT screen */ }

  for (const key of OBSOLETE_KEYS) {
    try { storage.removeItem?.(key); } catch { /* never restore removed save formats */ }
  }
  return { current: flat(), selected: 'flat', advanced };
}

export function persist(storage, state) {
  storage.setItem(KEY, JSON.stringify({ version: 5, advanced: state.advanced === true }));
}
