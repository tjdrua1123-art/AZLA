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

test('seven production sound modes use the requested bands, gains and shared 0.75 Q baseline',()=>{
  assert.equal(PRESETS.length,7);
  assert.deepEqual(PRESETS.map(entry=>entry.id),['flat','pubg-tactical','valorant','footstep','vocal','harman','cinema']);
  assert.equal(new Set(PRESETS.map(x=>x.id)).size,7);
  assert.equal(FREQUENCIES.length,BANDS);assert.equal(QS.length,BANDS);
  assert.deepEqual(FREQUENCIES,[31,63,125,250,500,1000,2000,4000,8000,11000]);
  assert.ok(QS.every(q=>q===.75));
  const expected={
    flat:[0,0,0,0,0,0,0,0,0,0],
    'pubg-tactical':[-7,-6,-3,-3,0,3,3,4,-2,2],
    valorant:[-4,-4,-1,0,2,0,3,4,-2,3],
    footstep:[-6,-5,-4,-2,3,3,3,4,-3,-3],
    vocal:[0,-2,-2,0,3,3,3,0,0,0],
    harman:[0,0,0,0,2,0,0,0,0,4],
    cinema:[2,2,1,-2,0,3,3,0,0,3]
  };
  for (const preset of PRESETS) {
    validateEq(preset.eq);
    assert.ok(Object.isFrozen(preset.eq.gains));
    assert.ok(peakResponse(buildAnalyticModel(preset.eq)).db<=6, preset.id);
    assert.ok(preset.eq.qs.every(q=>q===.75),preset.id);
    assert.ok(preset.eq.filterTypes.every(type=>type===2),preset.id);
    assert.deepEqual(preset.eq.gains,expected[preset.id]);
    if (preset.id!=='flat') {
      assert.match(preset.reference,/초록·주황 측정 그래프/);
      assert.ok(Math.max(...preset.eq.gains)-Math.min(...preset.eq.gains)>=3,preset.id);
    }
  }
  assert.ok(expected['pubg-tactical'][0]<0&&expected['pubg-tactical'][7]>0);
  assert.ok(expected.footstep.slice(0,3).every(gain=>gain<0)&&expected.footstep.slice(4,8).every(gain=>gain>0));
  assert.ok(expected.vocal.slice(4,7).every(gain=>gain>0));
  assert.ok(expected.harman[9]>0&&expected.cinema[9]>0);
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
