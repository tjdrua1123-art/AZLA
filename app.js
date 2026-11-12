import { BANDS, FILTERS, PRESETS, PRESET_REFERENCE, cloneEq, validateEq, signature, buildAnalyticModel, responseAt, peakResponse, parseRew, interpolate, comparison } from './src/eq.js';
import { DeviceController, supportedDevices, generateRamPlan, sdkGraphModel, discoverDevice } from './src/device.js';
import { PreviewQueue } from './src/preview.js';
import { restore, persist, persistDeviceSnapshot, restoreDeviceSnapshot, restoreSounds, persistSounds, soundName } from './src/storage.js';

const $ = id => document.getElementById(id);
const AUDIO_DEVICE_GUIDANCE = '오디오 기기마다 소리 특성이 다르므로, 사용하는 오디오 기기에 맞게 EQ를 조절해 주세요.';
const SDK = window.WalkPlayWebEqSDK;
const safeStorage = {
  getItem: key => { try { return localStorage.getItem(key); } catch { return null; } },
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: key => { try { localStorage.removeItem(key); } catch { /* storage may be unavailable */ } }
};
const previous = restore(safeStorage);
const state = { eq: previous.current, selected: previous.selected, baseSelected: previous.selected, baseEq: cloneEq(previous.current), advanced: previous.advanced, sounds: restoreSounds(safeStorage), deviceSnapshot: restoreDeviceSnapshot(safeStorage), lastApplied: null, activeBand: 4, busy: false, off: null, on: null, model: null, peak: null, error: null, deviceTag: null, deviceTagStatus: 'disconnected', connectionBusy: false };
let devices = [], controller, discoveredDevice = null, chartFrame = null, modelToken = 0, chartGeometry = null, toastTimer, sdkTimer, livePreview;
const canvas = $('responseChart');
const ctx = canvas.getContext('2d');
const colors = Array(BANDS).fill('#FF5B24');
const formatDb = value => `${value > 0 ? '+' : ''}${Number(value).toFixed(1)}`;
const freqLabel = value => value >= 1000 ? `${Number((value / 1000).toFixed(1))}k` : String(Math.round(value));
const icons = {
  flat: '<path d="M3 12h18M5 8v8M19 8v8"/>',
  crosshair: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>',
  gamepad: '<path d="M8 7h8c3 0 5 9 3 11-1 1-4-3-4-3H9s-3 4-4 3C3 16 5 7 8 7Z"/><path d="M7 11h4m-2-2v4m6-2h.01M17 13h.01"/>',
  footsteps: '<path d="M8 3c2 0 3 2 3 4s-1 4-3 4-3-2-3-4 1-4 3-4Zm8 10c2 0 3 2 3 4s-1 4-3 4-3-2-3-4 1-4 3-4Z"/>',
  mic: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M6 11v1a6 6 0 0 0 12 0v-1m-6 7v3m-3 0h6"/>',
  music: '<path d="M9 17V5l11-2v12M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>',
  film: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14m10-14v14M3 9h4m10 0h4M3 15h4m10 0h4"/>',
  sliders: '<path d="M5 3v5m0 4v9m7-18v10m0 4v4m7-18v2m0 4v12M2 8h6m1 9h6m1-12h6"/>'
};
function toast(message, error = false) {
  const node = $('toast'); node.textContent = message; node.hidden = false; node.classList.toggle('error', error);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { node.hidden = true; }, error ? 6500 : 3600);
}
function saveLocal() { try { persist(safeStorage, state); } catch { toast('화면 설정을 저장할 수 없습니다.', true); } }
function download(name, value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function currentSound() {
  return state.sounds.find(item => `sound:${item.id}` === state.baseSelected);
}
function canSaveToDevice() { return !!controller?.device?.opened && !controller.requiresReconnect; }
function selectedProfile() {
  const sound = currentSound();
  if (sound) return { ...sound, description: signature(sound.eq) === signature(state.eq) ? '저장한 사운드입니다. 원하는 대로 조절해 보세요.' : '사운드를 조절 중입니다. 마음에 들면 변경사항 적용을 눌러 주세요.' };
  if (state.selected === 'manual') return { name: '직접 조절', description: '선택한 사운드를 슬라이더로 직접 조절한 상태입니다.', eq: state.eq, reference: '현재 세션의 임시 조절값' };
  return PRESETS.find(p => p.id === state.selected) || PRESETS[0];
}
function loadSound(sound) {
  if (state.busy) return;
  state.eq = cloneEq(sound.eq); state.baseEq = cloneEq(sound.eq);
  state.selected = `sound:${sound.id}`; state.baseSelected = state.selected; state.error = null;
  refresh(true, true);
}
function renderPresets() {
  const root = $('presetList'), scrollTop = root.scrollTop, scrollLeft = root.scrollLeft;
  const active = root.contains(document.activeElement) ? document.activeElement.dataset : null;
  const focusSelector = active?.preset ? `[data-preset="${active.preset}"]` : active?.sound ? `[data-sound="${active.sound}"]`
    : active?.soundAction ? `[data-sound-action="${active.soundAction}"][data-sound-id="${active.soundId}"]` : null;
  root.replaceChildren();
  for (const profile of PRESETS) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'preset-item';
    button.dataset.preset = profile.id; button.setAttribute('aria-pressed', String(profile.id === state.selected)); button.disabled = state.busy;
    const symbol = document.createElement('span'); symbol.className = 'preset-icon';
    symbol.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[profile.icon] || icons.sliders}</svg>`;
    const copy = document.createElement('span'); copy.className = 'preset-copy';
    const name = document.createElement('span'); name.className = 'preset-name'; name.textContent = profile.name;
    const category = document.createElement('span'); category.className = 'preset-caption'; category.textContent = profile.category;
    copy.append(name, category);
    const dot = document.createElement('span'); dot.className = 'preset-active-mark'; dot.setAttribute('aria-hidden', 'true');
    button.append(symbol, copy, dot);
    button.addEventListener('click', () => {
      if (state.busy) return;
      state.eq = cloneEq(profile.eq); state.baseEq = cloneEq(profile.eq); state.selected = profile.id; state.baseSelected = profile.id; state.error = null;
      refresh(true, true); saveLocal();
    });
    root.append(button);
  }
  for (const sound of state.sounds) {
    const row = document.createElement('div'); row.className = 'user-sound-row';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'preset-item user-sound';
    button.dataset.sound = sound.id; button.disabled = state.busy;
    button.setAttribute('aria-pressed', String(currentSound()?.id === sound.id));
    const name = document.createElement('span'); name.className = 'preset-name'; name.textContent = sound.name;
    button.title = sound.name; button.append(name); button.addEventListener('click', () => loadSound(sound));
    row.append(button);
    const manage = document.createElement('button'); manage.type = 'button'; manage.className = 'sound-manage';
    manage.dataset.soundAction = 'menu'; manage.dataset.soundId = sound.id; manage.textContent = '⋯';
    manage.setAttribute('aria-label', `${sound.name} 관리`); manage.setAttribute('aria-haspopup', 'menu'); manage.disabled = state.busy;
    manage.addEventListener('click', () => openSoundMenu(sound, manage)); row.append(manage);
    root.append(row);
  }
  document.querySelector('.library-count').textContent = `${String(PRESETS.length + state.sounds.length).padStart(2, '0')} MODES`;
  root.scrollTop = scrollTop; root.scrollLeft = scrollLeft;
  if (focusSelector) root.querySelector(focusSelector)?.focus({ preventScroll: true });
}
let soundDraft = null, deletingSoundId = null, menuSoundId = null, menuAnchorPosition = null;
function closeSoundMenu() { if ($('soundMenu').matches(':popover-open')) $('soundMenu').hidePopover(); }
function openSoundMenu(sound, anchor) {
  if (state.busy) return;
  if (menuSoundId === sound.id && $('soundMenu').matches(':popover-open')) { closeSoundMenu(); return; }
  menuSoundId = sound.id;
  const menu = $('soundMenu'); menu.showPopover();
  const rect = anchor.getBoundingClientRect(), gap = 8;
  menuAnchorPosition = { top: rect.top, left: rect.left, width: innerWidth, height: innerHeight };
  menu.style.left = `${Math.max(gap, Math.min(rect.right - menu.offsetWidth, innerWidth - menu.offsetWidth - gap))}px`;
  menu.style.top = `${Math.max(gap, Math.min(rect.bottom + gap, innerHeight - menu.offsetHeight - gap))}px`;
  menu.querySelector('button').focus();
}
function updateSaveDialogHelp() {
  if (!soundDraft) return;
  $('soundDialogHelp').textContent = soundDraft.mode === 'rename' ? '이름만 변경합니다. 저장한 EQ 값은 유지됩니다.'
    : '이름을 입력하면 왼쪽 목록에 보관합니다. 기기에 저장하려면 EQ 적용을 눌러 주세요.';
}
function openSoundDialog(mode = 'create', sound = null) {
  if (state.busy || state.connectionBusy || $('bandControls').querySelector('[aria-invalid="true"]')) return;
  closeSoundMenu();
  const eq = mode === 'copy' && currentSound()?.id !== sound.id ? sound.eq : state.eq;
  soundDraft = { id: mode === 'rename' ? sound.id : crypto.randomUUID(), eq: cloneEq(eq), mode };
  $('soundDialogTitle').textContent = mode === 'rename' ? '이름 변경' : mode === 'copy' ? '사운드 복제' : '사운드 생성';
  $('soundName').value = mode === 'rename' ? sound.name : '';
  $('soundFormError').textContent = ''; $('soundSubmit').textContent = mode === 'rename' ? '변경' : '생성';
  updateSaveDialogHelp(); $('soundDialog').showModal(); $('soundName').focus();
  if (mode === 'rename') $('soundName').select();
}
function openDeleteSound(sound) {
  if (state.busy) return;
  closeSoundMenu(); deletingSoundId = sound.id; $('deleteSoundName').textContent = sound.name;
  $('deleteSoundError').textContent = ''; $('deleteSoundDialog').showModal();
}
function storeSoundChanges(sounds, errorId = null) {
  try { state.sounds = persistSounds(safeStorage, sounds); return true; }
  catch (error) {
    const message = error.name === 'QuotaExceededError' ? '저장 공간이 부족합니다. 사용하지 않는 사운드를 삭제해 주세요.'
      : error.name === 'SecurityError' ? '이 브라우저에서 저장을 허용해 주세요.' : error.message;
    if (errorId) $(errorId).textContent = message;
    else toast(message, true);
    return false;
  }
}
function saveSoundRecord(record, errorId = null) {
  if (state.busy || state.connectionBusy) return;
  const existing = state.sounds.some(item => item.id === record.id);
  const sounds = existing ? state.sounds.map(item => item.id === record.id ? record : item) : [...state.sounds, record];
  // Named sounds belong to this browser; this action never writes device Flash.
  if (!storeSoundChanges(sounds, errorId)) return;
  if (signature(record.eq) === signature(state.eq)) {
    state.baseEq = cloneEq(record.eq);
    state.selected = `sound:${record.id}`; state.baseSelected = state.selected;
  }
  if ($('soundDialog').open) $('soundDialog').close();
  refresh(true);
  if (!existing) $('presetList').lastElementChild?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  toast(existing ? '사운드에 변경사항을 적용했습니다. 기기에 저장하려면 EQ 적용을 눌러 주세요.' : '사운드를 생성했습니다. 기기에 저장하려면 EQ 적용을 눌러 주세요.');
}
function submitSound(event) {
  event.preventDefault();
  if (!soundDraft || state.busy || state.connectionBusy) return;
  let name;
  try { name = soundName($('soundName').value); }
  catch (error) { $('soundFormError').textContent = error.message; return; }
  const existing = state.sounds.find(item => item.id === soundDraft.id);
  if (soundDraft.mode === 'rename') {
    if (!existing) return;
    if (!storeSoundChanges(state.sounds.map(item => item.id === existing.id ? { ...item, name } : item), 'soundFormError')) return;
    $('soundDialog').close(); refresh(true); toast('이름을 변경했습니다.');
  } else {
    void saveSoundRecord({ id: soundDraft.id, name, eq: cloneEq(soundDraft.eq) }, 'soundFormError');
  }
}
function deleteSound(event) {
  event.preventDefault();
  if (!deletingSoundId || state.busy) return;
  const selected = `sound:${deletingSoundId}`;
  if (!storeSoundChanges(state.sounds.filter(item => item.id !== deletingSoundId), 'deleteSoundError')) return;
  if (state.selected === selected) state.selected = 'manual';
  if (state.baseSelected === selected) state.baseSelected = 'manual';
  $('deleteSoundDialog').close(); refresh(true); toast('사운드를 삭제했습니다. 현재 EQ와 기기 설정은 유지됩니다.');
  $('createSoundBtn').focus();
}

function numberInput(label, value, min, max, step, prop, i) {
  const input = document.createElement('input'); input.type = 'number'; input.value = value; input.min = min; input.max = max; input.step = step;
  input.setAttribute('aria-label', `${i + 1}번 밴드 ${label}`); input.dataset.prop = prop; input.dataset.band = i;
  input.addEventListener('focus', () => selectBand(i));
  input.addEventListener('input', () => {
    if (input.value === '' || !Number.isFinite(input.valueAsNumber) || !input.checkValidity()) { input.setAttribute('aria-invalid', 'true'); livePreview?.cancel(); updateApplyState(); return; }
    input.removeAttribute('aria-invalid'); editBand(i, prop, input.valueAsNumber);
  });
  input.addEventListener('change', () => {
    if (!input.checkValidity() || input.value === '') { input.value = state.eq[prop][i]; input.removeAttribute('aria-invalid'); toast('입력 범위를 확인해 주세요.', true); scheduleLivePreview(); }
    updateApplyState();
  });
  return input;
}
function renderBands() {
  const root = $('bandControls'); root.replaceChildren(); root.classList.toggle('advanced-visible', state.advanced);
  for (let i = 0; i < BANDS; i++) {
    const column = document.createElement('div'); column.className = 'band-column'; column.dataset.band = i;
    column.classList.toggle('selected', i === state.activeBand);
    const selectColumn = () => { if (!state.busy) selectBand(i); };
    column.addEventListener('click', selectColumn);
    column.addEventListener('focusin', selectColumn);
    const num = document.createElement('span'); num.className = 'band-number'; num.textContent = String(i + 1).padStart(2, '0');
    const freq = document.createElement('label'); freq.className = 'band-frequency';
    freq.append(numberInput('주파수 Hz', state.eq.freqs[i], 20, 20000, 1, 'freqs', i));
    const hz = document.createElement('small'); hz.textContent = 'Hz'; freq.append(hz);
    const gain = document.createElement('label'); gain.className = 'band-gain';
    gain.append(numberInput('게인 dB', state.eq.gains[i], -12, 12, .1, 'gains', i));
    const db = document.createElement('small'); db.textContent = 'dB'; gain.append(db);
    const shell = document.createElement('div'); shell.className = 'slider-shell';
    const slider = document.createElement('input'); slider.type = 'range'; slider.className = 'gain-slider'; slider.min = -12; slider.max = 12; slider.step = .1; slider.value = state.eq.gains[i];
    updateSlider(slider, state.eq.gains[i]);
    slider.dataset.band = i; slider.setAttribute('aria-label', `${i + 1}번 밴드 게인 슬라이더`); slider.setAttribute('aria-orientation', 'vertical');
    slider.addEventListener('input', () => { selectBand(i); editBand(i, 'gains', Number(slider.value)); });
    slider.addEventListener('dblclick', () => editBand(i, 'gains', 0));
    shell.append(slider);
    const q = document.createElement('label'); q.className = 'band-q band-advanced'; q.textContent = 'Q';
    q.append(numberInput('Q값', state.eq.qs[i], .5, 5, 'any', 'qs', i));
    const filter = document.createElement('label'); filter.className = 'band-filter band-advanced';
    const select = document.createElement('select'); select.setAttribute('aria-label', `${i + 1}번 밴드 필터`); select.dataset.band = i;
    for (const [value, label] of Object.entries(FILTERS)) { const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option); }
    select.value = state.eq.filterTypes[i]; select.addEventListener('change', () => editBand(i, 'filterTypes', Number(select.value)));
    filter.append(select); column.append(num, freq, gain, shell, q, filter); root.append(column);
  }
}
function selectBand(i) {
  state.activeBand = i;
  $('bandControls').querySelectorAll('.band-column').forEach((el, j) => el.classList.toggle('selected', i === j));
  scheduleDraw();
}
function updateSlider(slider, gain) {
  slider.value = gain;
  // Range thumbs travel within the track, inset by half their 13px height.
  const ratio = (12 - gain) / 24;
  slider.style.setProperty('--gain-stop', `calc(${ratio * 100}% + ${(0.5 - ratio) * 13}px)`);
}
function editBand(i, prop, value) {
  if (state.busy) return;
  const next = cloneEq(state.eq); next[prop][i] = value; next.tag = 14;
  try { state.eq = validateEq(next); } catch (error) { toast(error.message, true); return; }
  state.selected = 'manual'; state.error = null; selectBand(i);
  const column = $('bandControls').children[i];
  const controls = { freqs: '.band-frequency input', gains: '.band-gain input', qs: '.band-q input' };
  for (const [key, selector] of Object.entries(controls)) {
    const input = column.querySelector(selector);
    if (document.activeElement !== input) { input.value = state.eq[key][i]; input.removeAttribute('aria-invalid'); }
  }
  updateSlider(column.querySelector('.gain-slider'), state.eq.gains[i]);
  column.querySelector('select').value = state.eq.filterTypes[i];
  refresh(false, true); saveLocal();
}
function refresh(rebuild = false, listen = false) {
  if (rebuild) { renderPresets(); renderBands(); }
  else {
    $('presetList').querySelectorAll('[data-preset]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.preset === state.selected)));
    $('presetList').querySelectorAll('[data-sound]').forEach(el => el.setAttribute('aria-pressed', String(currentSound()?.id === el.dataset.sound)));
  }
  const profile = selectedProfile();
  $('profileName').textContent = profile.name;
  $('profileDescription').textContent = profile.description;
  $('profileDescription').title = profile.reference || PRESET_REFERENCE;
  state.model = buildAnalyticModel(state.eq); state.peak = peakResponse(state.model);
  updateGraphLabels(); scheduleDraw(); renderComparison(); updateApplyState();
  const token = ++modelToken;
  clearTimeout(sdkTimer);
  if (SDK?.default) sdkTimer = setTimeout(async () => {
    try {
      const eq = cloneEq(state.eq), packets = await generateRamPlan(SDK, eq);
      if (token !== modelToken) return;
      state.model = sdkGraphModel(packets, eq); state.model.freqs = eq.freqs;
      state.peak = peakResponse(state.model); updateGraphLabels(); scheduleDraw(); renderComparison();
      if (listen) scheduleLivePreview();
    } catch { if (token === modelToken) $('modelLabel').textContent = AUDIO_DEVICE_GUIDANCE; }
  }, 90);
  if (listen) scheduleLivePreview();
}
function updateGraphLabels() {
  $('modelLabel').textContent = AUDIO_DEVICE_GUIDANCE;
  $('peakLabel').replaceChildren(document.createTextNode('최대 변화 '));
  const number = document.createElement('b'); number.textContent = `${formatDb(state.peak.db)} dB`; $('peakLabel').append(number);
  $('peakLabel').title = '양의 게인에는 클리핑 가능성이 있습니다. 전체 출력은 자동으로 줄이지 않습니다.';
}
function scheduleLivePreview() {
  if (!livePreview || state.busy || state.connectionBusy || !controller?.device?.opened || controller.requiresReconnect) return;
  if ($('bandControls').querySelector('[aria-invalid="true"]')) { livePreview.cancel(); return; }
  livePreview.enqueue(state.eq);
}
function updateApplyState() {
  const linked = !!controller?.device, needsReconnect = controller?.requiresReconnect;
  const invalid = !!$('bandControls').querySelector('[aria-invalid="true"]');
  const sig = signature(state.eq);
  $('connectBtn').disabled = state.busy || state.connectionBusy;
  $('connectBtn').querySelector('span').textContent = linked ? '연결 해제' : needsReconnect ? '다시 연결' : '기기 연결';
  $('connectionLabel').replaceChildren();
  const dot = document.createElement('i'); dot.className = 'status-dot'; dot.classList.toggle('connected', linked);
  $('connectionLabel').append(dot, document.createTextNode(linked ? 'USB 연결됨' : '연결 대기'));
  $('deviceName').textContent = linked ? devices.find(d => d.vendorId === controller.device.vendorId && d.productId === controller.device.productId)?.name || 'AZLA USB DAC' : 'AZLA USB DAC';
  $('applyBtn').disabled = state.busy || state.connectionBusy || !canSaveToDevice() || invalid;
  $('applyBtn').querySelector('span').textContent = state.busy ? '적용 중' : 'EQ 적용';
  $('saveSoundBtn').hidden = !currentSound();
  $('saveSoundBtn').disabled = state.busy || state.connectionBusy || invalid;
  $('createSoundBtn').disabled = state.busy || state.connectionBusy || invalid;
  $('viewSavedEqBtn').disabled = state.busy || state.connectionBusy;
  $('soundMenu').querySelectorAll('button').forEach(button => { button.disabled = state.busy; });
  updateSaveDialogHelp();
  if (state.busy) return;
  $('applyProgress').hidden = true;
  if (state.connectionBusy) { $('applyStatus').textContent = '기기 상태 확인 중'; $('applyDetail').textContent = '연결 후 조절하면 소리를 미리 들을 수 있습니다.'; }
  else if (state.error) { $('applyStatus').textContent = '기기 반영을 확인해 주세요'; $('applyDetail').textContent = state.error; }
  else if (!linked) {
    const saved = currentSound() && signature(currentSound().eq) === sig;
    $('applyStatus').textContent = saved ? '내 사운드에 보관됨' : '나만의 사운드를 만들어 보세요';
    $('applyDetail').textContent = saved ? '기기를 연결하고 EQ 적용을 누르면 기기에 저장됩니다.' : '왼쪽 사운드 생성에서 원하는 이름으로 보관할 수 있습니다.';
  }
  else if (needsReconnect) { $('applyStatus').textContent = '기기 재연결이 필요합니다'; $('applyDetail').textContent = '연결을 해제한 뒤 다시 연결해 주세요.'; }
  else if (invalid) { $('applyStatus').textContent = '입력값을 확인해 주세요'; $('applyDetail').textContent = '유효한 값을 입력하면 미리듣기를 다시 반영합니다.'; }
  else if (livePreview?.busy) { $('applyStatus').textContent = '미리듣기 반영 중'; $('applyDetail').textContent = '변경 중에도 조절할 수 있습니다. 아직 기기에 저장하지 않았습니다.'; }
  else if (state.lastApplied === sig && (!controller.lastPreviewEvidence || signature(controller.lastPreviewEvidence.eq) === sig)) { $('applyStatus').textContent = '설정 전송 완료'; $('applyDetail').textContent = '전원 재연결 후 설정 유지 여부를 확인해 주세요.'; }
  else if (controller.lastPreviewEvidence && signature(controller.lastPreviewEvidence.eq) === sig) { $('applyStatus').textContent = '미리듣기 중 · 기기 저장 전'; $('applyDetail').textContent = currentSound() ? '변경사항 적용은 내 사운드에, EQ 적용은 기기에 저장합니다.' : '사운드 생성은 왼쪽에서, 기기 저장은 EQ 적용을 눌러 주세요.'; }
  else { $('applyStatus').textContent = '조절하면 바로 미리듣기'; $('applyDetail').textContent = currentSound() ? '변경사항 적용으로 보관하거나, EQ 적용으로 기기에 저장하세요.' : '왼쪽에서 사운드를 생성하거나, EQ 적용으로 기기에 저장하세요.'; }
  $('applyDetail').title = $('applyDetail').textContent;
}
function lockUI(flag) {
  state.busy = flag;
  for (const node of document.querySelectorAll('#bandControls input, #bandControls select, #presetList button, #advancedToggle, #resetBtn, #flatBtn, #saveSoundBtn, #createSoundBtn, #viewSavedEqBtn')) node.disabled = flag;
  updateApplyState();
}
async function apply() {
  if (state.busy || state.connectionBusy || !controller?.device) return;
  const current = cloneEq(state.eq), currentSignature = signature(current);
  state.error = null; lockUI(true);
  livePreview.cancel();
  $('applyProgress').hidden = false;
  try {
    // Finish an in-flight RAM transaction before committing this frozen snapshot.
    await livePreview.idle();
    const evidence = await controller.apply(current); state.lastApplied = currentSignature;
    state.deviceSnapshot = { ...evidence.device, eq: cloneEq(evidence.eq), tag: evidence.eq.tag, savedAt: evidence.time };
    let recorded = true;
    try { state.deviceSnapshot = persistDeviceSnapshot(safeStorage, evidence); }
    catch { recorded = false; /* Keep this session's record available even if browser storage fails. */ }
    try { const read = await controller.readEqTag(); state.deviceTag = read.tag; state.deviceTagStatus = 'known'; }
    catch { state.deviceTag = null; state.deviceTagStatus = 'error'; }
    renderPresets();
    toast(recorded ? 'EQ를 기기에 적용하고 저장했습니다.' : 'EQ는 기기에 저장했지만 이 브라우저에 기록을 보관하지 못했습니다.');
  } catch (error) { state.lastApplied = null; state.error = `기기 적용을 확인하지 못했습니다. ${error.message}`; toast(state.error, true); }
  finally { lockUI(false); }
}
function requestSoundSave() {
  if (state.busy || state.connectionBusy || $('bandControls').querySelector('[aria-invalid="true"]')) return;
  const sound = currentSound();
  if (sound) void saveSoundRecord({ ...sound, eq: cloneEq(state.eq) });
}
function requestApply() {
  if (state.busy || state.connectionBusy || !canSaveToDevice() || $('bandControls').querySelector('[aria-invalid="true"]')) return;
  void apply();
}

function savedEqRecord() {
  const snapshot = state.deviceSnapshot, device = controller?.device;
  if (!snapshot) return { message: '기기에 저장한 EQ 기록이 없습니다. EQ 적용 후 다시 확인해 주세요.' };
  if (device && (snapshot.vendorId !== device.vendorId || snapshot.productId !== device.productId)) {
    return { message: '연결한 기기에 저장한 EQ 기록이 없습니다. EQ 적용 후 다시 확인해 주세요.' };
  }
  if (device && state.deviceTagStatus === 'known' && state.deviceTag !== snapshot.tag) {
    return { message: '기기 설정이 저장 기록과 달라 확인할 수 없습니다. 원하는 EQ를 적용한 뒤 다시 확인해 주세요.' };
  }
  return { snapshot };
}
function showSavedEq() {
  if (state.busy || state.connectionBusy) return;
  const { snapshot, message } = savedEqRecord(), grid = $('savedEqBands');
  grid.replaceChildren(); $('savedEqMessage').textContent = message || '이 프로그램에서 마지막으로 기기에 적용한 설정입니다. 다른 프로그램에서 변경한 값은 반영되지 않습니다.';
  $('savedEqTime').textContent = '';
  if (snapshot) {
    const date = new Date(snapshot.savedAt);
    if (Number.isFinite(date.getTime())) $('savedEqTime').textContent = `저장 기록 · ${new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(date)}`;
    snapshot.eq.freqs.forEach((freq, i) => {
      const band = document.createElement('div'); band.className = 'saved-eq-band';
      const frequency = document.createElement('strong'); frequency.textContent = `${freq} Hz`;
      const gain = document.createElement('span'); gain.textContent = `${formatDb(snapshot.eq.gains[i])} dB`;
      const details = document.createElement('small'); details.textContent = `${FILTERS[snapshot.eq.filterTypes[i]]} · Q ${snapshot.eq.qs[i]}`;
      band.append(frequency, gain, details); grid.append(band);
    });
  }
  $('savedEqDialog').showModal();
}

function scheduleDraw() { if (chartFrame === null) chartFrame = requestAnimationFrame(() => { chartFrame = null; drawGraph(); }); }
function drawGraph() {
  const rect = canvas.getBoundingClientRect(), w = rect.width, h = rect.height;
  if (!w || !h || !state.model) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const styles = getComputedStyle(canvas);
  const color = (name, fallback) => styles.getPropertyValue(`--chart-${name}`).trim() || fallback;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  const left = 34, right = 14, top = 20, bottom = 27;
  // Include cuts as well as boosts, with 1 dB of room for the curve and markers.
  const extent = Math.max(Math.abs(state.peak.db), Math.abs(state.peak.minDb));
  const range = Math.max(12, Math.ceil((extent + 1) / 12) * 12);
  const x = f => left + Math.log10(f / 20) / 3 * (w - left - right), y = db => top + (range - db) / (range * 2) * (h - top - bottom);
  chartGeometry = { left, right, top, bottom, w, h, range, x, y };
  ctx.font = '600 11px "Segoe UI", sans-serif'; ctx.lineWidth = 1;
  for (const level of [-range, -range / 2, 0, range / 2, range]) {
    ctx.setLineDash(level === 0 ? [] : [2, 5]); ctx.strokeStyle = level === 0 ? color('zero', '#c4c9d0') : color('grid', '#e6e8ec');
    ctx.beginPath(); ctx.moveTo(left, y(level)); ctx.lineTo(w - right, y(level)); ctx.stroke();
    ctx.fillStyle = color('axis', '#69737e'); ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(`${level > 0 ? '+' : ''}${level}`, left - 10, y(level));
  }
  ctx.setLineDash([]);
  const ticks = w < 480 ? [20, 100, 500, 2000, 10000, 20000] : [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  for (const f of ticks) {
    ctx.strokeStyle = color('grid', '#e6e8ec'); ctx.beginPath(); ctx.moveTo(x(f), top); ctx.lineTo(x(f), h - bottom); ctx.stroke();
    ctx.fillStyle = color('axis', '#69737e'); ctx.textAlign = 'center'; ctx.fillText(freqLabel(f), x(f), h - 9);
  }
  ctx.save(); ctx.beginPath(); ctx.rect(left - 3, top - 5, w - left - right + 6, h - top - bottom + 10); ctx.clip();
  const points = Array.from({ length: 650 }, (_, i) => { const f = 20 * 1000 ** (i / 649); return { f, x: x(f), y: y(responseAt(f, state.model)) }; });
  ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  const stroke = ctx.createLinearGradient(left, 0, w - right, 0); stroke.addColorStop(0, color('line-start', '#5e9fcd')); stroke.addColorStop(.5, color('line-mid', '#438bc4')); stroke.addColorStop(1, color('line-end', '#7a94be'));
  ctx.strokeStyle = stroke; ctx.lineWidth = 2.3; ctx.shadowBlur = 0; ctx.stroke();
  if (state.off && state.on) {
    ctx.beginPath(); let started = false;
    for (const p of points) {
      const a = interpolate(p.f, state.off), b = interpolate(p.f, state.on);
      if (a === null || b === null) { started = false; continue; }
      if (!started) { ctx.moveTo(p.x, y(b - a)); started = true; } else ctx.lineTo(p.x, y(b - a));
    }
    ctx.strokeStyle = color('measured', '#28877b'); ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]); ctx.stroke(); ctx.setLineDash([]);
  }
  state.eq.freqs.forEach((f, i) => {
    const px = x(f), py = y(responseAt(f, state.model)), active = i === state.activeBand;
    if (active) { ctx.beginPath(); ctx.arc(px, py, 10, 0, Math.PI * 2); ctx.fillStyle = color('halo', '#438bc41a'); ctx.fill(); }
    ctx.beginPath(); ctx.arc(px, py, active ? 4.5 : 3, 0, Math.PI * 2); ctx.fillStyle = color('marker', '#ffffff'); ctx.fill(); ctx.strokeStyle = colors[i]; ctx.lineWidth = active ? 2 : 1.4; ctx.stroke();
    if (active) { ctx.fillStyle = color('label', '#49647d'); ctx.textAlign = 'center'; ctx.font = '600 11px "Segoe UI", sans-serif'; ctx.fillText(`${freqLabel(f)} Hz  ${formatDb(state.eq.gains[i])} dB`, Math.max(left + 48, Math.min(w - right - 48, px)), Math.max(top + 8, py - 19)); }
  });
  ctx.restore();
}
let dragging = null;
canvas.addEventListener('pointerdown', event => {
  if (state.busy || !chartGeometry) return;
  const r = canvas.getBoundingClientRect(), px = event.clientX - r.left, py = event.clientY - r.top;
  const g = chartGeometry;
  const hit = state.eq.freqs.map((f, i) => ({ i, distance: Math.hypot(px - g.x(f), py - g.y(responseAt(f, state.model))) })).sort((a, b) => a.distance - b.distance)[0];
  if (hit.distance > 24) return;
  selectBand(hit.i); dragging = { i: hit.i, y: py, gain: state.eq.gains[hit.i], range: g.range };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', event => {
  if (!dragging || state.busy) return;
  const rect = canvas.getBoundingClientRect(), g = chartGeometry;
  const px = Math.max(g.left, Math.min(g.w - g.right, event.clientX - rect.left));
  const freq = Math.round(20 * 1000 ** ((px - g.left) / (g.w - g.left - g.right)));
  const gain = Math.round(Math.max(-12, Math.min(12, dragging.gain + (dragging.y - (event.clientY - rect.top)) * dragging.range * 2 / (g.h - g.top - g.bottom))) * 10) / 10;
  editBand(dragging.i, 'freqs', freq); editBand(dragging.i, 'gains', gain);
});
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(event, () => { dragging = null; });

function renderComparison() {
  const result = comparison(state.eq, state.model, state.off, state.on);
  $('comparisonRows').replaceChildren();
  for (const row of result.rows) {
    const tr = document.createElement('tr');
    for (const v of [row.band, row.freq, row.predicted, row.measured, row.error]) {
      const td = document.createElement('td'); td.textContent = v === null ? '—' : typeof v === 'number' && td.cellIndex >= 2 ? formatDb(v) : String(v); tr.append(td);
    }
    // Explicit formatting after cells are attached (cellIndex before append is -1).
    [row.predicted, row.measured, row.error].forEach((v, i) => { tr.cells[i + 2].textContent = v === null ? '—' : formatDb(v); });
    $('comparisonRows').append(tr);
  }
  $('measurementLegend').hidden = !(state.off && state.on);
  $('rewSummary').textContent = result.count ? `${result.count}/10개 밴드 비교 · 평균 절대 차이 ${result.meanAbsoluteError.toFixed(2)} dB (${state.model.source === 'sdk' ? 'SDK 예상' : '수학적 예상'} 기준)` : 'EQ OFF와 EQ ON 파일을 모두 불러오면 차이를 계산합니다.';
}
async function loadMeasurement(kind, file) {
  if (!file) return;
  try {
    if (file.size > 5_000_000) throw new Error('측정 파일은 5 MB 이하여야 합니다.');
    state[kind] = parseRew(await file.text()); scheduleDraw(); renderComparison(); toast(`${kind === 'off' ? 'EQ OFF' : 'EQ ON'} 측정 ${state[kind].length}개를 불러왔습니다.`);
  } catch (error) { toast(error.message, true); }
}

$('soundMenu').addEventListener('click', event => {
  const action = event.target.closest('[data-menu-action]')?.dataset.menuAction;
  const sound = state.sounds.find(item => item.id === menuSoundId);
  if (!sound || !action || state.busy) return;
  if (action === 'delete') openDeleteSound(sound);
  else openSoundDialog(action, sound);
});
function closeMovedSoundMenu() {
  if (!$('soundMenu').matches(':popover-open') || !menuAnchorPosition) return;
  const anchor = $('presetList').querySelector(`[data-sound-id="${menuSoundId}"]`), rect = anchor?.getBoundingClientRect();
  if (!rect || Math.abs(rect.top - menuAnchorPosition.top) > 1 || Math.abs(rect.left - menuAnchorPosition.left) > 1
    || innerWidth !== menuAnchorPosition.width || innerHeight !== menuAnchorPosition.height) closeSoundMenu();
}
document.addEventListener('scroll', closeMovedSoundMenu, true);
window.addEventListener('resize', closeMovedSoundMenu);
$('soundMenu').addEventListener('keydown', event => {
  const buttons = [...$('soundMenu').querySelectorAll('button')];
  const index = buttons.indexOf(document.activeElement);
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
  }
});
$('soundForm').addEventListener('submit', submitSound);
$('deleteSoundForm').addEventListener('submit', deleteSound);
for (const [dialog, cancel] of [['soundDialog', 'cancelSoundBtn'], ['deleteSoundDialog', 'cancelDeleteSoundBtn']]) {
  $(cancel).addEventListener('click', () => $(dialog).close());
  $(dialog).addEventListener('close', () => { soundDraft = null; deletingSoundId = null; });
}
$('advancedToggle').checked = state.advanced;
$('advancedToggle').addEventListener('change', event => { state.advanced = event.target.checked; $('bandControls').classList.toggle('advanced-visible', state.advanced); saveLocal(); scheduleDraw(); });
$('resetBtn').addEventListener('click', () => { state.eq = cloneEq(state.baseEq); state.selected = state.baseSelected; state.error = null; refresh(true, true); saveLocal(); });
$('flatBtn').addEventListener('click', () => { const flat = PRESETS.find(profile => profile.id === 'flat').eq; state.eq = cloneEq(flat); state.baseEq = cloneEq(flat); state.selected = 'flat'; state.baseSelected = 'flat'; state.error = null; refresh(true, true); saveLocal(); toast('기본 모드 기준값으로 초기화했습니다.'); });
$('closeSettingsBtn').addEventListener('click', () => $('settingsDialog').close());
$('exportLogBtn').addEventListener('click', () => download('AZLA-Diagnostics.json', { ...controller.diagnostics(), discoveredDevice, preview: state.eq, model: state.model.source, presetReference: PRESET_REFERENCE }));
$('rewOffInput').addEventListener('change', e => loadMeasurement('off', e.target.files[0]));
$('rewOnInput').addEventListener('change', e => loadMeasurement('on', e.target.files[0]));
$('clearRewBtn').addEventListener('click', () => { state.off = null; state.on = null; $('rewOffInput').value = ''; $('rewOnInput').value = ''; renderComparison(); scheduleDraw(); });
$('createSoundBtn').addEventListener('click', () => openSoundDialog());
$('viewSavedEqBtn').addEventListener('click', showSavedEq);
$('closeSavedEqBtn').addEventListener('click', () => $('savedEqDialog').close());
$('saveSoundBtn').addEventListener('click', requestSoundSave);
$('applyBtn').addEventListener('click', requestApply);
window.addEventListener('beforeunload', event => { if (state.busy) { event.preventDefault(); event.returnValue = ''; } });

async function initialize() {
  let configError = false, connectionMode = 'registered';
  try { const response = await fetch('device-config.json', { cache: 'no-store' }); if (!response.ok) throw new Error(); const config = await response.json(); devices = supportedDevices(config); connectionMode = config.connectionMode === 'manufacturer' ? 'manufacturer' : 'registered'; } catch { configError = true; }
  controller = new DeviceController({ SDK, hid: navigator.hid, devices, connectionMode, onProgress: (value, label) => {
    $('applyProgress').value = value * 100; $('applyStatus').textContent = value === 1 ? '설정 전송 완료' : label; $('applyDetail').textContent = '장치 저장이 끝날 때까지 USB를 연결해 두세요.';
  } });
  livePreview = new PreviewQueue({
    send: (eq, isCurrent) => controller.preview(eq, { isCurrent }),
    onError: error => { state.error = `미리듣기를 반영하지 못했습니다. ${error.message}`; toast(state.error, true); },
    onChange: () => { renderPresets(); updateApplyState(); }
  });
  controller.onDisconnect = () => {
    livePreview.cancel();
    state.lastApplied = null; state.deviceTag = null; state.deviceTagStatus = 'disconnected';
    state.error = 'USB 연결이 끊어졌습니다. 장치를 다시 연결해 주세요.';
    renderPresets(); updateApplyState(); toast(state.error, true);
  };
  $('connectBtn').addEventListener('click', async () => {
    if (state.busy || state.connectionBusy) return;
    state.connectionBusy = true;
    const revisionAtConnect = modelToken;
    livePreview.cancel();
    updateApplyState();
    try {
      if (controller.device) {
        await controller.disconnect(); await livePreview.idle();
        state.lastApplied = null; state.deviceTag = null; state.deviceTagStatus = 'disconnected'; state.error = null; renderPresets();
      } else {
        await livePreview.idle();
        const device = await controller.connect();
        if (device) {
          state.lastApplied = null; state.error = null; state.deviceTag = null; state.deviceTagStatus = 'reading'; renderPresets();
          try { const read = await controller.readEqTag(); state.deviceTag = read.tag; state.deviceTagStatus = 'known'; }
          catch { state.deviceTagStatus = 'error'; }
          renderPresets(); toast('AZLA 기기가 연결되었습니다. 볼륨을 낮춘 뒤 조절해 주세요.');
        }
      }
    } catch (error) { toast(error.message, true); $('settingsDialog').showModal(); }
    finally {
      state.connectionBusy = false; updateApplyState();
      if (controller.device && modelToken !== revisionAtConnect) scheduleLivePreview();
    }
  });
  $('supportStatus').textContent = window.isSecureContext && navigator.hid ? 'WebHID 지원' : 'Windows Chrome / Edge 필요';
  $('sdkStatus').textContent = SDK?.default ? '원본 SDK 준비됨' : '제조사 SDK 본체 추가 필요';
  $('connectionHelp').textContent = [!SDK?.default ? '제조사 SDK 본체가 아직 포함되지 않았습니다.' : '', connectionMode === 'manufacturer' ? '기존 프로그램과 같은 장치 검색 방식을 사용합니다. 사용 중인 AZLA DAC를 선택해 주세요.' : !devices.length ? '최종 제품의 USB 식별 정보 등록이 필요합니다.' : '', configError ? '장치 설정 파일을 읽을 수 없습니다.' : '', '조절하면 실시간으로 미리 듣고, EQ 적용을 눌러야 기기에 저장합니다.'].filter(Boolean).join(' ');
  const note = document.createElement('p'); note.className = 'help-text preset-reference-note'; note.textContent = `${PRESET_REFERENCE}. FPS는 제공된 설정의 강조 비율을 유지하도록 조정했으며, 모든 모드는 오디오 기기에 맞게 조절할 수 있는 시작값입니다. 사용하는 오디오 기기에 맞게 조절해 주세요.`;
  $('settingsDialog').querySelector('.settings-section').append(note);
  const discoverRow = document.createElement('div'); discoverRow.className = 'discovery-row';
  const inspect = document.createElement('button'); inspect.type = 'button'; inspect.id = 'inspectDeviceBtn'; inspect.className = 'secondary-button'; inspect.textContent = '연결된 장치 확인';
  const result = document.createElement('p'); result.id = 'discoveredDevice'; result.className = 'help-text'; result.textContent = '제조사 예제의 검색 방식으로 장치 정보를 읽습니다. EQ는 쓰지 않습니다.';
  inspect.addEventListener('click', async () => {
    if (state.busy) { toast('저장이 끝난 뒤 장치를 확인해 주세요.'); return; }
    inspect.disabled = true;
    try {
      const info = await discoverDevice(navigator.hid);
      if (info) {
        discoveredDevice = info;
        result.textContent = `${info.name} · VID 0x${info.vendorId.toString(16).toUpperCase().padStart(4, '0')} / PID 0x${info.productId.toString(16).toUpperCase().padStart(4, '0')} · 기록 저장으로 내보낼 수 있습니다.`;
      }
    } catch (error) { toast(error.message, true); }
    finally { inspect.disabled = false; }
  });
  discoverRow.append(inspect, result); $('settingsDialog').querySelector('.settings-section').append(discoverRow);
  refresh(true); new ResizeObserver(scheduleDraw).observe(canvas.parentElement);
}
initialize().catch(error => { toast(`초기화 오류: ${error.message}`, true); console.error(error); });
