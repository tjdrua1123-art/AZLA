import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, cloneEq } from '../src/eq.js';
import { normalizePresets, restore, persist, importBackup, exportBackup } from '../src/storage.js';

const flat=()=>cloneEq(PRESETS.find(entry=>entry.id==='flat').eq);
const legacy=()=>({
  freqs:[31,80,190,450,900,2100,5100,12000], qs:[.5,.6,.7,.8,.9,1,1.1,1.2],
  gains:[-1,2,3,-4,5,-6,1,0],filterTypes:[1,2,2,2,2,2,3,4],tag:21
});
function memoryStorage(initial={}) {
  const entries=new Map(Object.entries(initial));
  return {
    entries,writes:[],
    getItem(key){return entries.get(key)??null;},
    setItem(key,value){this.writes.push({key,value});entries.set(key,value);}
  };
}

test('legacy local settings retain every original band and append two neutral bands',()=>{
  const eq=legacy();
  const originalPresets=JSON.stringify({'나의 이전 프리셋':eq});
  const originalLast=JSON.stringify({eq,activePreset:'custom'});
  const storage=memoryStorage({azla_cb5100_presets_v1:originalPresets,azla_cb5100_last_eq_v1:originalLast});
  const result=restore(storage);
  assert.equal(result.presets.length,1);assert.equal(result.selected,'custom');
  for(const field of ['freqs','qs','gains','filterTypes']) {
    assert.deepEqual(result.current[field].slice(0,8),eq[field]);
    assert.deepEqual(result.presets[0].eq[field].slice(0,8),eq[field]);
  }
  assert.deepEqual(result.current.freqs.slice(8),[11000,16000]);
  assert.deepEqual(result.current.gains.slice(8),[0,0]);
  assert.equal(result.current.tag,21);
  assert.equal(storage.getItem('azla_cb5100_presets_v1'),originalPresets);
  assert.equal(storage.getItem('azla_cb5100_last_eq_v1'),originalLast);
  assert.deepEqual(storage.writes,[],'restoring settings must not rewrite legacy storage');
});

test('malformed or inaccessible storage yields a usable fresh fallback without rewriting user data',()=>{
  const corrupt=memoryStorage({azla_equalizer_v4:'{"current":'});
  const first=restore(corrupt),second=restore(corrupt);
  assert.equal(first.selected,'flat');assert.equal(first.current.freqs.length,10);
  assert.ok(first.current.gains.every(gain=>gain===0));
  assert.ok(first.current.qs.every(q=>q===.75));
  assert.deepEqual(first.presets,[]);assert.equal(first.advanced,false);
  assert.deepEqual(corrupt.writes,[]);
  assert.equal(corrupt.getItem('azla_equalizer_v4'),'{"current":');
  first.current.gains[0]=12;
  assert.notEqual(second.current.gains[0],12,'fallback settings must not share arrays');
  const denied=restore({getItem(){throw new Error('Storage is blocked');}});
  assert.equal(denied.current.freqs.length,10);
});

test('reserved names, blank names and oversized names are discarded',()=>{
  const result=normalizePresets([
    {name:'__proto__',eq:flat()},{name:'constructor',eq:flat()},{name:'prototype',eq:flat()},
    {name:'  ',eq:flat()},{name:'x'.repeat(37),eq:flat()},
    {name:' 정상 프리셋 ',eq:flat()}
  ]);
  assert.deepEqual(result.map(entry=>entry.name),['정상 프리셋']);
  assert.equal({}.polluted,undefined);
});

test('one corrupt or out-of-range preset does not destroy valid presets',()=>{
  const outOfRange=flat();outOfRange.gains[1]=13;
  const missingBand=flat();missingBand.freqs.pop();
  const result=normalizePresets({
    valid:flat(),invalidGain:outOfRange,invalidShape:missingBand,invalidObject:null,validOld:legacy()
  });
  assert.deepEqual(result.map(entry=>entry.name),['valid','validOld']);
  assert.equal(result[1].eq.freqs.length,10);
});

test('v4 persist and restore keep independent snapshots and leave old keys untouched',()=>{
  const original='old user-owned value';
  const storage=memoryStorage({azla_cb5100_presets_v1:original});
  const state={eq:flat(),selected:'custom',advanced:true,presets:[{name:'내 설정',eq:flat()}]};
  state.eq.gains[0]=-2;state.presets[0].eq.gains[1]=1;
  persist(storage,state);
  state.eq.gains[0]=11;state.presets[0].eq.gains[1]=12;
  const saved=restore(storage),again=restore(storage);
  assert.equal(saved.current.gains[0],-2);assert.equal(saved.presets[0].eq.gains[1],1);
  assert.equal(saved.selected,'custom');assert.equal(saved.advanced,true);
  saved.current.gains[0]=9;saved.presets[0].eq.gains[1]=9;
  assert.equal(again.current.gains[0],-2);assert.equal(again.presets[0].eq.gains[1],1);
  assert.equal(storage.getItem('azla_cb5100_presets_v1'),original);
  assert.deepEqual(storage.writes.map(entry=>entry.key),['azla_equalizer_v4']);
});

test('v3 upgrade starts once from FLAT while preserving named sounds and view preference',()=>{
  const previous=flat();previous.gains[0]=6;previous.qs[0]=1.8;
  const named=flat();named.gains[4]=2;
  const raw=JSON.stringify({version:3,current:previous,selected:'custom',advanced:true,presets:[{name:'기존 사운드',eq:named}]});
  const storage=memoryStorage({azla_equalizer_v3:raw});
  const result=restore(storage);
  assert.equal(result.selected,'flat');assert.ok(result.current.gains.every(gain=>gain===0));
  assert.ok(result.current.qs.every(q=>q===.75));assert.equal(result.advanced,true);
  assert.equal(result.presets.length,1);assert.equal(result.presets[0].name,'기존 사운드');
  assert.equal(result.presets[0].eq.gains[4],2);
  assert.equal(storage.getItem('azla_equalizer_v3'),raw);assert.deepEqual(storage.writes,[]);
});

test('backup import rejects unrelated formats, empty backups, oversized files and broken JSON',()=>{
  assert.throws(()=>importBackup(JSON.stringify({format:'other-app',current:flat()})),/AZLA/);
  assert.throws(()=>importBackup(JSON.stringify({format:'azla-equalizer-v3',presets:[]})),/불러올 수 있는/);
  assert.throws(()=>importBackup('x'.repeat(200001)),/200 KB/);
  assert.throws(()=>importBackup('{broken'));
  assert.throws(()=>importBackup(null),/200 KB/);
});

test('legacy backup imports migrate current and named EQs without changing original data',()=>{
  for(const format of ['azla-cb5100-eq-v1','azla-cb5100-eq-v2']) {
    const source={format,presets:{'내 8밴드':legacy()},current:legacy()};
    const text=JSON.stringify(source),loaded=importBackup(text);
    assert.equal(loaded.current.freqs.length,10);assert.equal(loaded.presets[0].eq.freqs.length,10);
    assert.deepEqual(loaded.current.freqs.slice(0,8),source.current.freqs);
    assert.deepEqual(loaded.presets[0].eq.gains.slice(0,8),source.presets['내 8밴드'].gains);
    assert.equal(JSON.stringify(source),text);
  }
});

test('v3 backup imports preserve valid entries and safely discard malformed entries',()=>{
  const invalid=flat();invalid.qs[0]=0;
  const result=importBackup(JSON.stringify({
    format:'azla-equalizer-v3',presets:[{name:'유효한 설정',eq:flat()},{name:'불량 설정',eq:invalid}],current:flat()
  }));
  assert.equal(result.presets.length,1);assert.equal(result.presets[0].name,'유효한 설정');
  assert.deepEqual(result.current.freqs,[50,125,250,500,850,1800,3100,7000,8500,15000]);
});

test('export contains only EQ backups, not device credentials, reports or incidental application state',()=>{
  const eq=flat();eq.secret='should-not-be-exported';
  const state={
    eq,selected:'custom',advanced:true,presets:[{name:'보관할 설정',eq:{...flat(),credential:'never-copy-me'},device:{serial:'secret-serial'}}],
    token:'synthetic-test-secret',device:{serial:'secret-serial'},lastEvidence:{reports:[{bytes:[1,2,3]}]},
    recentReports:[{bytes:[4,5,6]}]
  };
  const backup=exportBackup(state),text=JSON.stringify(backup);
  assert.equal(backup.format,'azla-equalizer-v3');assert.equal(backup.bands,10);
  assert.equal(backup.current.freqs.length,10);assert.equal(backup.presets.length,1);
  assert.ok(Number.isFinite(Date.parse(backup.exportedAt)));
  for(const forbidden of ['synthetic-test-secret','secret-serial','should-not-be-exported','never-copy-me','reports','lastEvidence','token','device']) assert.ok(!text.includes(forbidden),forbidden);
  const imported=importBackup(text);
  assert.deepEqual(imported.current,flat());assert.equal(imported.presets[0].name,'보관할 설정');
});
