/**
 * Integration tests against the unmodified manufacturer UMD SDK restored from
 * the user's GitHub repository. HID is mocked: these checks do not establish
 * physical DAC behavior, acoustic performance, or nonvolatile retention.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { createHash } from 'node:crypto';
import {
  generateRamPlan, generatePlan, sdkGraphModel, DeviceController, TIMING, DISCOVERY_VIDS
} from '../src/device.js';
import { PRESETS, cloneEq, buildAnalyticModel, responseAt, peakResponse } from '../src/eq.js';

const source = readFileSync(new URL('../sdk/walk-play-web-eq-sdk.umd.js', import.meta.url), 'utf8');
const quiet = Object.fromEntries(['log','debug','warn','error','info'].map(method => [method, () => {}]));
const context = createContext({ console: quiet, setTimeout, clearTimeout });
runInContext(source, context, { filename: 'walk-play-web-eq-sdk.umd.js' });
const SDK = context.WalkPlayWebEqSDK;
const flat = () => cloneEq(PRESETS.find(p => p.id === 'flat').eq);
const RAM = [1, 10, 4, 0, 0, 255, 255];
const FLASH = [1, 1, 0];

function mockConnection(options = {}) {
  const device = {
    vendorId: 0x3302, productId: 0x1234,
    productName: 'SDK integration mock', opened: false, writes: [],
    async open() { this.opened = true; },
    async close() { this.opened = false; },
    async sendReport(reportId, payload) { this.writes.push({ reportId, bytes: [...payload] }); }
  };
  const hid = { filters: null, addEventListener() {}, async requestDevice({ filters }) { this.filters = filters; return [device]; } };
  const waits = [];
  const controller = new DeviceController({
    SDK, hid, devices: [{ vendorId: device.vendorId, productId: device.productId }],
    wait: async (ms, signal) => { assert.equal(signal.aborted, false); waits.push(ms); },
    ...options
  });
  return { device, hid, controller, waits };
}

test('manufacturer UMD exposes the original CB API without patching SDK source', () => {
  assert.equal(typeof SDK.default, 'function');
  assert.equal(typeof SDK.ChipTypes.CB, 'function');
  assert.equal(typeof SDK.EventKeys.ReadEqTagId, 'string');
  // Pin the exact manufacturer source restored from the user's main branch;
  // an SDK upgrade requires reviewing the byte contract and updating this pin.
  assert.equal(createHash('sha256').update(source).digest('hex'), '9a096081ab1f48e295ddb0f8dcca45bfa629082cacacf550d1af848559d4e579');
  const device = { addEventListener() {}, removeEventListener() {}, sendReport() { throw new Error('init must not write'); } };
  const instance = new SDK.default();
  instance.init(device, 'CB', { loggerEnabled: false });
  assert.equal(instance.getFilterIndexs().PK, 2);
  assert.equal(instance.getDeviceTypeNo(), 'CB');
  instance.clearAllListeners();
});

test('real CB SDK emits all ten zero-gain bands plus the exact RAM refresh', async () => {
  const eq = flat(), packets = await generateRamPlan(SDK, eq);
  assert.equal(packets.length, 11);
  for (let index = 0; index < 10; index++) {
    const p = packets[index];
    assert.equal(p.reportId, 75);
    assert.equal(p.bytes.length, 36);
    assert.deepEqual(p.bytes.slice(0, 7), [1, 9, 24, 0, index, 0, 0]);
    const v = new DataView(Uint8Array.from(p.bytes).buffer);
    assert.equal(v.getUint16(27, true), eq.freqs[index]);
    assert.equal(v.getUint16(29, true), Math.round(eq.qs[index] * 256));
    assert.equal(v.getInt16(31, true), 0);
    assert.equal(p.bytes[33], 2); assert.equal(p.bytes[34], 0); assert.equal(p.bytes[35], eq.tag);
  }
  assert.deepEqual(packets[10], { reportId: 75, bytes: RAM });
});

test('real CB Flash command is three bytes, distinct from seven-byte RAM refresh', async () => {
  const plan = await generatePlan(SDK, flat());
  assert.equal(plan.ram.length, 11);
  assert.deepEqual(plan.ram.at(-1).bytes, RAM);
  assert.deepEqual(plan.flash, [{ reportId: 75, bytes: FLASH }]);
  assert.equal(plan.flash[0].bytes.length, 3);
});

test('real quantized PEAK filters reach the requested gain at their 96kHz center', async () => {
  for (const center of [50, 850, 3100, 16000]) {
    for (const gain of [-6, 6]) {
      const eq = flat(); eq.freqs[0] = center; eq.gains[0] = gain; eq.qs[0] = .75;
      const model = sdkGraphModel(await generateRamPlan(SDK, eq), eq);
      assert.equal(model.sampleRate, 96000);
      const value = responseAt(center, model);
      assert.ok(Math.abs(value - gain) < .02, `${center}Hz ${gain}dB -> ${value}`);
      const analytic = buildAnalyticModel(eq);
      for (const f of [20, 100, 500, 1000, 3000, 8000, 16000, 20000]) {
        const expected = responseAt(f, analytic), actual = responseAt(f, model);
        assert.ok(Math.abs(actual - expected) < .025, `${center}Hz at ${f}Hz quantization mismatch ${actual - expected}`);
      }
    }
  }
});

test('all five production modes produce finite real-SDK models agreeing with PEAK preview', async () => {
  assert.equal(PRESETS.length, 5);
  for (const preset of PRESETS) {
    const eq = cloneEq(preset.eq);
    const packets = await generateRamPlan(SDK, eq);
    const actual = sdkGraphModel(packets, eq), analytic = buildAnalyticModel(eq);
    assert.ok(peakResponse(actual).db <= 4.5, `${preset.id}: SDK response must stay at most 4.5 dB with margin below the warning`);
    for (let i = 0; i <= 128; i++) {
      const f = 20 * 1000 ** (i / 128);
      const value = responseAt(f, actual);
      assert.ok(Number.isFinite(value), `${preset.id} ${f}Hz`);
      assert.ok(Math.abs(value - responseAt(f, analytic)) < .03, `${preset.id} at ${f}Hz`);
    }
  }
});

test('real SDK fixed-point decoding uses 30 bits, or 27 bits for high shelf', async () => {
  const eq = flat();
  eq.filterTypes = [1, 2, 3, 4, 5, 1, 2, 3, 4, 5];
  eq.gains = [1, 2, 3, 0, 0, -1, -2, -3, 0, 0];
  const packets = await generateRamPlan(SDK, eq);
  const model = sdkGraphModel(packets, eq);
  model.coeffs.forEach((coefficients, i) => {
    const view = new DataView(Uint8Array.from(packets[i].bytes).buffer);
    const scale = 2 ** (eq.filterTypes[i] === 3 ? 27 : 30);
    const expected = Array.from({ length: 5 }, (_, j) => view.getInt32(7 + j * 4, true) / scale);
    expected[3] *= -1; expected[4] *= -1;
    assert.deepEqual(coefficients, expected);
    assert.ok(coefficients.every(Number.isFinite));
  });
});

test('app transmits real SDK 10-band, RAM and Flash bytes in order and preserves required waits', async () => {
  const { controller, device, waits } = mockConnection();
  await controller.connect();
  const eq = cloneEq(PRESETS.find(p => p.id === 'vocal').eq);
  const plan = await generatePlan(SDK, eq);
  const evidence = await controller.apply(eq);
  assert.deepEqual(device.writes, [...plan.ram, ...plan.flash]);
  assert.deepEqual(waits, [...Array(11).fill(TIMING.gap), TIMING.beforeFlash, TIMING.gap, TIMING.afterFlash]);
  assert.equal(evidence.reports.length, 12);
  assert.equal(evidence.reports.at(-1).phase, 'flash');
  assert.equal(evidence.result, 'flash-command-transmitted');
  assert.equal(evidence.persistenceVerified, false);
});

test('35 consecutive real-SDK mock-device saves still retain complete transactions after log rotation', async () => {
  const { controller, device } = mockConnection();
  await controller.connect();
  for (let i = 0; i < 35; i++) {
    const eq = flat(); eq.gains[0] = i % 2 ? 2 : -2;
    const evidence = await controller.apply(eq);
    assert.equal(evidence.reports.length, 12);
    assert.equal(evidence.reports[0].sequence, i * 12 + 1);
    assert.equal(evidence.reports.at(-1).sequence, (i + 1) * 12);
    assert.deepEqual(evidence.reports.at(-1).bytes, FLASH);
    assert.equal(evidence.eq.gains[0], eq.gains[0]);
    assert.equal(evidence.persistenceVerified, false);
  }
  assert.equal(device.writes.length, 35 * 12);
  assert.equal(controller.log.length, 240);
  assert.equal(controller.sequence, 420);
  assert.equal(controller.requiresReconnect, false);
});

test('manufacturer mode restores original VID picker and applies real SDK bytes to the explicitly selected EQ interface', async () => {
  const { controller, device, hid } = mockConnection({ devices: [], connectionMode: 'manufacturer' });
  device.productId = 0xf00d; // No product-ID registration is required in this mode.
  device.collections = [{ children: [{ outputReports: [{ reportId: 75 }] }] }];
  assert.equal(await controller.connect(), device);
  assert.deepEqual(hid.filters, DISCOVERY_VIDS.map(vendorId => ({ vendorId })));
  assert.equal(controller.devices.length, 0);
  const evidence = await controller.apply(flat());
  assert.equal(device.writes.length, 12);
  assert.deepEqual(device.writes.at(-1), { reportId: 75, bytes: FLASH });
  assert.equal(evidence.device.productId, 0xf00d);
  assert.equal(evidence.persistenceVerified, false);
});

test('manufacturer mode rejects an unlisted vendor before opening or writing', async () => {
  const { controller, device } = mockConnection({ devices: [], connectionMode: 'manufacturer' });
  device.vendorId = 0xffff;
  device.collections = [{ outputReports: [{ reportId: 75 }] }];
  await assert.rejects(controller.connect(), /지원되는 AZLA 장치가 아닙니다/);
  assert.equal(device.opened, false);
  assert.equal(device.writes.length, 0);
  assert.equal(controller.device, null);
});

test('manufacturer mode rejects a selected interface without output Report ID 75', async () => {
  const { controller, device } = mockConnection({ devices: [], connectionMode: 'manufacturer' });
  device.collections = [{ outputReports: [{ reportId: 1 }], children: [{ inputReports: [{ reportId: 75 }] }] }];
  await assert.rejects(controller.connect(), /EQ 제어 인터페이스/);
  assert.equal(device.opened, false);
  assert.equal(device.writes.length, 0);
  assert.equal(controller.device, null);
});
