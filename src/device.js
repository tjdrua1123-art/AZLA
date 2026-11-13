// Protocol bytes are generated exclusively by the original manufacturer SDK.
// The unmodified SDK is bundled from the user's latest GitHub main. Synthetic
// test fixtures are never imported by this module or included in distribution.
import { validateEq, cloneEq } from './eq.js';

export const TIMING = Object.freeze({ gap: 130, beforeFlash: 1100, afterFlash: 350, timeout: 8000 });
const RAM_COMMAND = Object.freeze([1, 10, 4, 0, 0, 255, 255]);
const FLASH_COMMAND = Object.freeze([1, 1, 0]);
export const TAG_READ_COMMAND = Object.freeze([128, 9, 0]);
// Original manufacturer search list plus the VID confirmed in the supplied KT firmware.
// Discovery grants no application write authorization and never opens a device.
export const DISCOVERY_VIDS = Object.freeze([0x3302, 0x0762, 0x35D8, 0x2FC6, 0x0104, 0xB44D, 0x0661, 0x0666, 0x0D8C, 0x0663, 0x31B2]);
export async function discoverDevice(hid) {
  if (!hid) throw new Error('장치 확인은 Windows Chrome 또는 Edge에서 사용할 수 있습니다.');
  const selected = await hid.requestDevice({ filters: DISCOVERY_VIDS.map(vendorId => ({ vendorId })) });
  if (!selected.length) return null;
  const d = selected[0];
  if (!DISCOVERY_VIDS.includes(d.vendorId)) throw new Error('제조사 검색 목록에 포함되지 않은 장치입니다.');
  return { name: String(d.productName || 'USB HID 장치').slice(0, 100), vendorId: d.vendorId, productId: d.productId, writeAuthorized: false };
}
export function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('USB 연결이 끊어졌습니다. 다시 연결해 주세요.')); return; }
    const onAbort = () => { clearTimeout(timer); reject(new Error('USB 연결이 끊어졌습니다. 다시 연결해 주세요.')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
export function supportedDevices(config) {
  if (!config || config.version !== 1 || !Array.isArray(config.devices)) return [];
  return config.devices.filter(d => Number.isInteger(d.vendorId) && d.vendorId > 0 && d.vendorId <= 65535 && Number.isInteger(d.productId) && d.productId >= 0 && d.productId <= 65535).map(d => ({ vendorId: d.vendorId, productId: d.productId, name: typeof d.name === 'string' ? d.name.slice(0, 80) : 'AZLA USB DAC' }));
}
export function isSupported(device, devices) { return devices.some(d => d.vendorId === device.vendorId && d.productId === device.productId); }
function bytesOf(data) {
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
  return new Uint8Array(data).slice();
}
function same(a, b) { return a.length === b.length && a.every((v, i) => v === b[i]); }

async function captureSdk(SDK, method, eq) {
  if (typeof SDK?.default !== 'function') throw new Error('제조사 SDK 파일이 필요합니다. 설정에서 준비 상태를 확인하세요.');
  const packets = [];
  let accepting = true;
  const mock = {
    opened: true, vendorId: 0, productId: 0,
    addEventListener() {}, removeEventListener() {},
    sendReport(reportId, payload) {
      if (accepting) packets.push({ reportId, bytes: Array.from(bytesOf(payload)) });
      return Promise.resolve();
    }
  };
  const instance = new SDK.default();
  try {
    await instance.init(mock, 'CB', { loggerEnabled: false });
    if (instance.getFilterIndexs?.().PK !== 2) throw new Error('제조사 SDK의 필터 형식이 일치하지 않습니다.');
    packets.length = 0;
    if (typeof instance[method] !== 'function') throw new Error(`제조사 SDK의 ${method} 기능을 확인할 수 없습니다.`);
    await instance[method](eq);
    // The previously supplied app uses synchronous SDK packet generation.
    // Yield one task so settled promise callbacks are captured as well.
    await new Promise(resolve => setTimeout(resolve, 0));
    return packets;
  } finally { accepting = false; instance.clearAllListeners?.(); }
}

export function validateRamPlan(packets, eq) {
  if (packets.length !== 11) throw new Error(`10밴드 전송 준비 실패: ${packets.length}/11 명령. SDK 버전을 확인해 주세요.`);
  for (let i = 0; i < 10; i++) {
    const p = packets[i];
    if (p.reportId !== 75 || p.bytes.length !== 36 || p.bytes[0] !== 1 || p.bytes[1] !== 9 || p.bytes[4] !== i || p.bytes[33] !== eq.filterTypes[i]) throw new Error(`${i + 1}번 밴드의 SDK 패킷 형식이 일치하지 않습니다.`);
  }
  const refresh = packets[10];
  if (refresh.reportId !== 75 || !same(refresh.bytes, RAM_COMMAND)) throw new Error('SDK의 메모리 반영 명령을 확인할 수 없습니다.');
  return packets;
}

export async function generateRamPlan(SDK, input) {
  const eq = { ...validateEq(input), offset: 0 };
  return validateRamPlan(await captureSdk(SDK, 'setEqInfo', eq), eq);
}
export async function generatePlan(SDK, input) {
  const eq = { ...validateEq(input), offset: 0 };
  const ram = await generateRamPlan(SDK, eq);
  const flash = await captureSdk(SDK, 'refereshToFlash');
  if (flash.length !== 1 || flash[0].reportId !== 75 || !same(flash[0].bytes, FLASH_COMMAND)) throw new Error('SDK의 Flash 저장 명령을 확인할 수 없습니다.');
  return { eq, ram, flash };
}

export function sdkGraphModel(packets, eq) {
  validateRamPlan(packets, eq);
  const coeffs = packets.slice(0, 10).map((p, i) => {
    const bytes = Uint8Array.from(p.bytes), view = new DataView(bytes.buffer);
    const scale = eq.filterTypes[i] === 3 ? 2 ** 27 : 2 ** 30;
    const c = Array.from({ length: 5 }, (_, j) => view.getInt32(7 + j * 4, true) / scale);
    // Vendor convention stores feedback coefficients with inverted signs.
    return [c[0], c[1], c[2], -c[3], -c[4]];
  });
  return { coeffs, sampleRate: 96000, source: 'sdk' };
}

export class DeviceController {
  constructor({ SDK, hid, devices = [], connectionMode = 'registered', timing = TIMING, wait = pause, onProgress = () => {} } = {}) {
    this.SDK = SDK; this.hid = hid; this.devices = devices;
    this.connectionMode = connectionMode === 'manufacturer' ? 'manufacturer' : 'registered';
    this.connecting = false;
    this.timing = timing; this.wait = wait; this.onProgress = onProgress;
    this.device = null; this.busy = false; this.requiresReconnect = false;
    this.sequence = 0; this.log = []; this.lastEvidence = null; this.lastPreviewEvidence = null; this.ramPackets = null; this.abort = null;
    this.lastTagRead = null;
    this.onDisconnect = null;
    this.disconnectListener = event => {
      if (event.device === this.device) {
        this.abort?.abort(); this.device = null; this.requiresReconnect = true; this.lastTagRead = null; this.ramPackets = null; this.lastPreviewEvidence = null;
        this.onDisconnect?.();
      }
    };
    hid?.addEventListener('disconnect', this.disconnectListener);
  }
  allows(device) {
    return isSupported(device, this.devices) || (this.connectionMode === 'manufacturer' && DISCOVERY_VIDS.includes(device.vendorId));
  }
  async connect() {
    if (this.busy || this.connecting) throw new Error('현재 연결 또는 저장이 진행 중입니다.');
    if (!this.hid) throw new Error('Windows Chrome 또는 Edge에서 실행해 주세요.');
    if (!this.SDK?.default) throw new Error('제조사 SDK 파일이 준비되지 않았습니다. 설정에서 확인해 주세요.');
    if (!this.devices.length && this.connectionMode !== 'manufacturer') throw new Error('지원 장치 등록이 필요합니다. 제조사에서 확인한 제품 ID를 등록해 주세요.');
    this.connecting = true;
    try {
      const filters = this.connectionMode === 'manufacturer' ? DISCOVERY_VIDS.map(vendorId => ({ vendorId })) : this.devices.map(({ vendorId, productId }) => ({ vendorId, productId }));
      const selected = await this.hid.requestDevice({ filters });
      if (!selected.length) return null;
      const device = selected[0];
      if (!this.allows(device)) throw new Error('지원되는 AZLA 장치가 아닙니다.');
      const hasOutput = collections => collections.some(c => c.outputReports?.some(r => r.reportId === 75) || hasOutput(c.children || []));
      if (Array.isArray(device.collections) && !hasOutput(device.collections)) throw new Error('EQ 제어 인터페이스가 아닙니다. 장치 선택 창에서 DAC의 EQ 인터페이스를 선택해 주세요.');
      await this.disconnect();
      try { if (!device.opened) await device.open(); }
      catch { throw new Error('장치를 열 수 없습니다. 다른 EQ 프로그램을 닫고 다시 연결해 주세요.'); }
      this.device = device; this.requiresReconnect = false; this.abort = new AbortController();
      this.lastEvidence = null; this.lastPreviewEvidence = null; this.ramPackets = null;
      return device;
    } finally { this.connecting = false; }
  }
  async disconnect() {
    this.abort?.abort();
    const old = this.device; this.device = null;
    if (old?.opened) await old.close().catch(() => {});
    this.requiresReconnect = false;
    this.lastTagRead = null;
    this.ramPackets = null; this.lastPreviewEvidence = null;
  }
  async readEqTag(timeout = 1800) {
    if (this.busy) throw new Error('저장이 끝난 뒤 현재 상태를 확인해 주세요.');
    const device = this.device;
    if (!device?.opened || this.requiresReconnect) throw new Error('먼저 AZLA 장치를 연결해 주세요.');
    if (typeof device.addEventListener !== 'function' || typeof device.removeEventListener !== 'function') throw new Error('이 장치에서는 현재 상태 응답을 받을 수 없습니다.');
    const signal = this.abort.signal;
    return new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        device.removeEventListener('inputreport', onReport);
      };
      const fail = error => { cleanup(); reject(error); };
      const onAbort = () => fail(new Error('USB 연결이 끊어졌습니다. 다시 연결해 주세요.'));
      const onReport = event => {
        if (event.device && event.device !== device) return;
        const data = event.data;
        if (!data?.buffer) return;
        const bytes = new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength ?? data.buffer.byteLength);
        if (bytes.length < 36 || bytes[1] !== 9) return;
        const result = { tag: bytes[35], time: new Date().toISOString(), source: 'device-tag' };
        this.lastTagRead = result; cleanup(); resolve(result);
      };
      device.addEventListener('inputreport', onReport);
      signal.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => fail(new Error('기기에서 EQ Tag 응답을 받지 못했습니다.')), timeout);
      Promise.resolve(device.sendReport(75, Uint8Array.from(TAG_READ_COMMAND))).catch(fail);
    });
  }
  async transmit(packet, phase, signal) {
    const device = this.device;
    if (signal.aborted || !device?.opened) throw new Error('USB 연결이 끊어졌습니다. 다시 연결해 주세요.');
    let timer;
    try {
      await Promise.race([
        device.sendReport(packet.reportId, Uint8Array.from(packet.bytes)),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('USB 응답 시간이 초과되었습니다. 다시 연결해 주세요.')), this.timing.timeout); })
      ]);
    } finally { clearTimeout(timer); }
    if (signal.aborted || this.device !== device || !device.opened) throw new Error('저장 중 USB 연결이 끊어졌습니다.');
    const entry = { sequence: ++this.sequence, phase, reportId: packet.reportId, bytes: [...packet.bytes], time: new Date().toISOString() };
    this.log.push(entry); if (this.log.length > 240) this.log.shift();
    await this.wait(this.timing.gap, signal);
    return entry;
  }
  async apply(input) {
    if (this.busy) throw new Error('현재 저장이 진행 중입니다.');
    if (!this.device?.opened || this.requiresReconnect) throw new Error('먼저 AZLA 장치를 연결해 주세요.');
    if (!this.allows(this.device)) throw new Error('지원되지 않는 장치입니다.');
    this.busy = true; this.lastEvidence = null;
    const signal = this.abort.signal;
    try {
      this.onProgress(0, '설정 확인 중');
      // Both phases must validate before the first physical write. No guessed packets.
      const plan = await generatePlan(this.SDK, cloneEq(input));
      if (signal.aborted) throw new Error('USB 연결이 끊어졌습니다.');
      const reports = [];
      for (let i = 0; i < plan.ram.length; i++) {
        reports.push(await this.transmit(plan.ram[i], i < 10 ? 'eq' : 'ram', signal));
        this.onProgress((i + 1) / 14, i < 10 ? `EQ 전송 중 · ${i + 1}/10` : '설정 반영 중');
      }
      this.onProgress(0.85, '장치에 저장 중 · USB를 분리하지 마세요');
      await this.wait(this.timing.beforeFlash, signal);
      reports.push(await this.transmit(plan.flash[0], 'flash', signal));
      await this.wait(this.timing.afterFlash, signal);
      if (signal.aborted || !this.device?.opened) throw new Error('저장 중 USB 연결이 끊어졌습니다.');
      this.lastEvidence = {
        version: '2.0.0', time: new Date().toISOString(), eq: plan.eq,
        device: { vendorId: this.device.vendorId, productId: this.device.productId },
        reports, result: 'flash-command-transmitted', persistenceVerified: false
      };
      this.ramPackets = plan.ram.slice(0, 10);
      this.lastPreviewEvidence = null;
      this.onProgress(1, 'Flash 저장 명령 전송 완료');
      return this.lastEvidence;
    } catch (error) {
      // A failed/timeout write may have changed RAM or Flash partially. Never
      // resume the transaction or claim success; require a clean reconnect.
      this.requiresReconnect = true;
      this.ramPackets = null; this.lastPreviewEvidence = null;
      this.onProgress(0, '저장 실패 · 다시 연결해 주세요');
      throw error;
    } finally { this.busy = false; }
  }
  async preview(input, { isCurrent = () => true } = {}) {
    if (this.busy) throw new Error('현재 기기 전송이 진행 중입니다.');
    if (!this.device?.opened || this.requiresReconnect) throw new Error('먼저 AZLA 장치를 연결해 주세요.');
    if (!this.allows(this.device)) throw new Error('지원되지 않는 장치입니다.');
    this.busy = true;
    const device = this.device, signal = this.abort.signal;
    try {
      const eq = cloneEq(input), packets = await generateRamPlan(this.SDK, eq);
      if (!isCurrent()) return { result: 'preview-skipped' };
      // Reuse only validated SDK bytes. A fresh connection receives all bands;
      // later edits send changed bands and the original RAM refresh, never Flash.
      const changed = packets.slice(0, 10).filter((p, i) => !this.ramPackets || !same(p.bytes, this.ramPackets[i].bytes));
      const reports = [];
      if (changed.length) {
        for (const packet of changed) reports.push(await this.transmit(packet, 'preview-eq', signal));
        reports.push(await this.transmit(packets[10], 'preview-ram', signal));
      }
      if (signal.aborted || this.device !== device) throw new Error('미리듣기 중 USB 연결이 끊어졌습니다.');
      this.ramPackets = packets.slice(0, 10);
      this.lastPreviewEvidence = {
        time: new Date().toISOString(), eq,
        device: { vendorId: device.vendorId, productId: device.productId },
        reports, result: 'ram-preview-transmitted', persistenceVerified: false
      };
      return this.lastPreviewEvidence;
    } catch (error) {
      // An old connection must not poison a newly opened connection.
      if (this.abort?.signal === signal && this.device === device) this.requiresReconnect = true;
      this.ramPackets = null; this.lastPreviewEvidence = null;
      throw error;
    } finally { this.busy = false; }
  }
  diagnostics() { return { version: '2.0.0', sdkPresent: !!this.SDK?.default, connectionMode: this.connectionMode, supportedDeviceCount: this.devices.length, requiresReconnect: this.requiresReconnect, lastTagRead: this.lastTagRead, lastEvidence: this.lastEvidence, lastPreviewEvidence: this.lastPreviewEvidence, recentReports: this.log }; }
}
