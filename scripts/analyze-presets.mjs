/** Reproduce the stock preset response audit using the bundled, unmodified SDK.
 * Software frequency responses only; no physical device or audio is measured.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createContext, runInContext } from 'node:vm';
import { PRESETS, cloneEq, buildAnalyticModel, responseAt } from '../src/eq.js';
import { generateRamPlan, sdkGraphModel } from '../src/device.js';

const source = readFileSync(new URL('../sdk/walk-play-web-eq-sdk.umd.js', import.meta.url), 'utf8');
const quiet = Object.fromEntries(['log', 'debug', 'info', 'warn', 'error'].map(name => [name, () => {}]));
const context = createContext({ console: quiet, setTimeout, clearTimeout });
runInContext(source, context);
const intervals = 65536;
const report = {
  scope: 'Software response audit, not an acoustic or clipping measurement',
  sdkSha256: createHash('sha256').update(source).digest('hex'),
  grid: { minHz: 20, maxHz: 20000, logSamples: intervals + 1 },
  presets: []
};
const csv = ['preset,frequency_hz,sdk_db,analytic_db'];

for (const preset of PRESETS) {
  const eq = cloneEq(preset.eq);
  const sdk = sdkGraphModel(await generateRamPlan(context.WalkPlayWebEqSDK, eq), eq);
  const analytic = buildAnalyticModel(eq);
  const stages = sdk.coeffs.map((_, index) => ({ ...sdk, coeffs: sdk.coeffs.slice(0, index + 1) }));
  const result = {
    id: preset.id, name: preset.name, eq, sampleRate: sdk.sampleRate,
    min: { db: Infinity, hz: 0 }, max: { db: -Infinity, hz: 0 },
    maxAnalyticDeviationDb: 0,
    stageMaxDb: Array(10).fill(-Infinity)
  };
  for (let i = 0; i <= intervals; i++) {
    const hz = 20 * 1000 ** (i / intervals);
    const db = responseAt(hz, sdk), expected = responseAt(hz, analytic);
    if (db < result.min.db) result.min = { db, hz };
    if (db > result.max.db) result.max = { db, hz };
    result.maxAnalyticDeviationDb = Math.max(result.maxAnalyticDeviationDb, Math.abs(db - expected));
    stages.forEach((stage, index) => {
      result.stageMaxDb[index] = Math.max(result.stageMaxDb[index], responseAt(hz, stage));
    });
    if (i % 64 === 0) csv.push(`${preset.id},${hz},${db},${expected}`);
  }
  if (preset.id === 'fps' && result.min.db < -6) throw new Error('FPS low-frequency cut exceeds design envelope');
  if (result.maxAnalyticDeviationDb > 0.03) throw new Error(`${preset.id}: preview disagrees with SDK`);
  report.presets.push(result);
  console.log(`${preset.name}: ${result.min.db.toFixed(3)} to +${result.max.db.toFixed(3)} dB; max stage +${Math.max(...result.stageMaxDb).toFixed(3)} dB`);
}
writeFileSync(new URL('../docs/preset-response-audit.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
writeFileSync(new URL('../docs/preset-response-curves.csv', import.meta.url), csv.join('\n') + '\n');
