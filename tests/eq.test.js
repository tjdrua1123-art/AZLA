import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BANDS, FREQUENCIES, QS, PRESETS, cloneEq, validateEq, signature,
  buildAnalyticModel, responseAt, peakResponse, parseRew, interpolate, comparison
} from '../src/eq.js';

const flat=()=>cloneEq(PRESETS.find(x=>x.id==='flat').eq);
const near=(actual,expected,tolerance=1e-6)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} vs ${expected}`);

test('flat preview is exactly flat throughout the audible range',()=>{
  const model=buildAnalyticModel(flat());
  for (const freq of [20,50,125,800,1000,3100,8500,16000,20000]) near(responseAt(freq,model),0);
  near(peakResponse(model).db,0);
});

test('one peak filter reaches its specified gain at its centre for boost and cut',()=>{
  for (const gain of [-12,-3,3,12]) {
    const eq=flat();eq.freqs[4]=850;eq.qs[4]=1.1;eq.gains[4]=gain;
    const model=buildAnalyticModel(eq);
    near(responseAt(850,model),gain);
    assert.ok(Math.abs(responseAt(20,model))<Math.abs(gain)*.01);
  }
});

test('cascaded filter response adds gains in dB',()=>{
  const eq=flat();eq.freqs[2]=1000;eq.freqs[4]=1000;eq.gains[2]=2;eq.gains[4]=3;
  near(responseAt(1000,buildAnalyticModel(eq)),5);
});

test('pass filters are not disabled by zero gain',()=>{
  const lp=flat();lp.freqs[4]=1000;lp.qs[4]=Math.SQRT1_2;lp.filterTypes[4]=4;
  const hp=flat();hp.freqs[4]=1000;hp.qs[4]=Math.SQRT1_2;hp.filterTypes[4]=5;
  const lowModel=buildAnalyticModel(lp),highModel=buildAnalyticModel(hp);
  near(responseAt(1000,lowModel),-3.01029995664);
  near(responseAt(1000,highModel),-3.01029995664);
  assert.ok(responseAt(10000,lowModel)<-35);
  assert.ok(responseAt(50,highModel)<-45);
});

test('shelves approach requested gain on the intended side and ignore Q in preview',()=>{
  const eq=flat();eq.freqs[4]=1000;eq.gains[4]=6;eq.filterTypes[4]=1;
  near(responseAt(20,buildAnalyticModel(eq)),6,.001);
  near(responseAt(20000,buildAnalyticModel(eq)),0,.001);
  eq.filterTypes[4]=3;
  near(responseAt(20000,buildAnalyticModel(eq)),6,.001);
  near(responseAt(20,buildAnalyticModel(eq)),0,.001);
  const initial=buildAnalyticModel(eq);eq.qs[4]=5;
  assert.deepEqual(initial.coeffs,buildAnalyticModel(eq).coeffs);
});

test('EQ validation rejects unsupported dimensions, unsafe values and coercions',()=>{
  const variants=[
    e=>e.freqs.pop(), e=>e.freqs[0]=19, e=>e.freqs[0]=20001, e=>e.freqs[0]=50.5,
    e=>e.freqs[0]='50', e=>e.qs[0]=.49, e=>e.qs[0]=5.01, e=>e.qs[0]=NaN,
    e=>e.gains[0]=12.1, e=>e.gains[0]=-12.1, e=>e.gains[0]=Infinity,
    e=>e.filterTypes[0]=0, e=>e.filterTypes[0]='2', e=>e.tag=256, e=>e.tag=-1, e=>e.offset=-3
  ];
  for (const alter of variants) {const eq=flat();alter(eq);assert.throws(()=>validateEq(eq));}
});

test('clones are independent and identity ignores incidental metadata',()=>{
  const eq=flat(),copy=cloneEq(eq);copy.gains[0]=1;
  assert.equal(eq.gains[0],0);
  assert.equal(signature(eq),signature({...eq,exportedAt:'ignored',uiState:'ignored'}));
  assert.notEqual(signature(eq),signature(copy));
});

test('five production sound modes use the requested bands, gains and shared 1.4 Q baseline',()=>{
  assert.equal(PRESETS.length,5);
  assert.deepEqual(PRESETS.map(entry=>entry.id),['flat','fps','vocal','music-balanced','cinema']);
  assert.equal(new Set(PRESETS.map(x=>x.id)).size,5);
  assert.equal(FREQUENCIES.length,BANDS);assert.equal(QS.length,BANDS);
  assert.deepEqual(FREQUENCIES,[32,63,125,250,500,1000,2000,4000,8000,16000]);
  assert.ok(QS.every(q=>q===1.4));
  const expected={
    flat:[0,0,0,0,0,0,0,0,0,0],
    fps:[-1.5,-1.5,1.5,0,-1,2,3,4,2,0],
    vocal:[-0.5,-0.5,0,-0.5,0,2,4,3,0,0],
    'music-balanced':[2,3,1,0,-0.5,0,0,1.5,2.5,1.5],
    cinema:[3,4.5,2,0,-1,0.5,2.5,2.5,1,0]
  };
  for (const preset of PRESETS) {
    validateEq(preset.eq);
    assert.ok(Object.isFrozen(preset.eq.gains));
    assert.deepEqual(preset.eq.freqs,preset.id==='fps'?[32,63,125,250,500,1000,2000,4000,6000,16000]:[32,63,125,250,500,1000,2000,4000,8000,16000]);
    assert.ok(peakResponse(buildAnalyticModel(preset.eq)).db<=5.5,`${preset.id}: keep combined boost at most 5.5 dB, below the 6 dB warning`);
    assert.ok(preset.eq.qs.every(q=>q===1.4),preset.id);
    assert.ok(preset.eq.filterTypes.every(type=>type===2),preset.id);
    assert.deepEqual(preset.eq.gains,expected[preset.id]);
    if (preset.id!=='flat') {
      assert.match(preset.reference,preset.id==='fps'?/PUBG·VALORANT 공개 게임 음향 분석/:/공개 음향 자료 기반 자체 설계/);
      assert.ok(preset.eq.gains.some(gain=>gain>0),`${preset.id}: listening modes must include actual positive gain`);
      assert.ok(peakResponse(buildAnalyticModel(preset.eq)).db>=3,`${preset.id}: keep the requested stronger boost`);
      assert.ok(preset.eq.gains.every(gain=>gain>=-12 && gain<=12),preset.id);
    }
  }
  const fpsPeak = peakResponse(buildAnalyticModel(PRESETS.find(p=>p.id==='fps').eq));
  assert.ok(fpsPeak.minDb >= -3, 'FPS must preserve low-end body instead of the old deep cut');
  assert.ok(expected.fps[0]<0 && expected.fps[6]>0);
  assert.ok(peakResponse(buildAnalyticModel(PRESETS.find(p=>p.id==='music-balanced').eq)).db<4);
  assert.ok(expected.vocal[6]>0 && expected.vocal[7]>0);
  assert.ok(expected['music-balanced'][0]>0 && expected.cinema[1]>0);
});

test('REW parser accepts normal CSV/TXT headers, sorts and removes duplicates',()=>{
  const text='\uFEFF* REW export\nFrequency,SPL,Phase\n'+Array.from({length:12},(_,i)=>`${(12-i)*100},${90+i},0`).join('\n')+'\n100,55\n# note\ninvalid';
  const rows=parseRew(text);
  assert.equal(rows.length,12);assert.equal(rows[0].f,100);assert.equal(rows.at(-1).f,1200);
  assert.throws(()=>parseRew('100 20\n200 30'),/10개/);
  assert.throws(()=>parseRew('x'.repeat(5_000_001)),/5 MB/);
});

test('log frequency interpolation returns null outside range and accurate midpoints',()=>{
  const rows=[{f:100,db:80},{f:1000,db:100}];
  near(interpolate(Math.sqrt(100*1000),rows),90);
  near(interpolate(100,rows),80);near(interpolate(1000,rows),100);
  assert.equal(interpolate(99,rows),null);assert.equal(interpolate(1001,rows),null);
});

test('measurement comparison reports ON minus OFF and counts only overlap',()=>{
  const eq=flat(),model=buildAnalyticModel(eq);
  const off=[{f:20,db:100},{f:20000,db:100}],on=[{f:20,db:102},{f:20000,db:102}];
  const result=comparison(eq,model,off,on);
  assert.equal(result.count,10);near(result.meanAbsoluteError,2);
  for (const row of result.rows){near(row.measured,2);near(row.error,2);near(row.predicted,0);}
  const limited=comparison(eq,model,[{f:100,db:100},{f:1000,db:100}],[{f:100,db:99},{f:1000,db:99}]);
  assert.equal(limited.count,4);near(limited.meanAbsoluteError,1);
  assert.equal(limited.rows[0].measured,null);
  assert.equal(comparison(eq,model,null,null).meanAbsoluteError,null);
});

// Regression: overlapping -12 dB bands can put the combined response below -12 dB.
test('response extrema include deep cuts without changing the positive peak',()=>{
  const eq=flat();eq.gains=[-12,-12,-12,0,2,0,0,0,0,4];
  const model=buildAnalyticModel(eq),peak=peakResponse(model);
  assert.ok(peak.minDb < -12);
  assert.ok(peak.db > 0 && peak.db < 6);
  for(let i=0;i<=2048;i++){
    const db=responseAt(20*1000**(i/2048),model);
    assert.ok(db>=peak.minDb-1e-9 && db<=peak.db+1e-9);
  }
  assert.equal(peakResponse(buildAnalyticModel(flat())).minDb,0);
});
