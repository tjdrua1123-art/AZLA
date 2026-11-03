import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, cloneEq } from '../src/eq.js';
import { restore, persist } from '../src/storage.js';

const flat=()=>cloneEq(PRESETS.find(entry=>entry.id==='flat').eq);
const OLD_KEYS=[
  'azla_equalizer_v4','azla_equalizer_v3','azla_cb5100_presets_v2',
  'azla_cb5100_presets_v1','azla_cb5100_last_eq_v2','azla_cb5100_last_eq_v1'
];

function memoryStorage(initial={}) {
  const entries=new Map(Object.entries(initial));
  return {
    entries,writes:[],deletes:[],
    getItem(key){return entries.get(key)??null;},
    setItem(key,value){this.writes.push({key,value});entries.set(key,value);},
    removeItem(key){this.deletes.push(key);entries.delete(key);}
  };
}

test('a fresh launch always starts from the shared FLAT and Q 0.75 baseline',()=>{
  const storage=memoryStorage(),result=restore(storage);
  assert.equal(result.selected,'flat');assert.equal(result.advanced,false);
  assert.deepEqual(result.current,flat());
  assert.ok(result.current.gains.every(gain=>gain===0));
  assert.ok(result.current.qs.every(q=>q===.75));
  assert.deepEqual(storage.writes,[]);
});

test('v5 ignores EQ snapshots and named sounds while preserving only advanced visibility',()=>{
  const altered=flat();altered.gains[0]=9;
  const storage=memoryStorage({azla_equalizer_v5:JSON.stringify({version:5,advanced:true,current:altered,selected:'user:old',presets:[{name:'삭제 대상',eq:altered}]})});
  const result=restore(storage);
  assert.equal(result.selected,'flat');assert.equal(result.advanced,true);
  assert.deepEqual(result.current,flat());
  assert.ok(!Object.hasOwn(result,'presets'));
  assert.ok(storage.getItem('azla_equalizer_v5'));
});

test('all known previous user-save keys are physically removed and never restored',()=>{
  const prior={version:4,advanced:true,current:{gains:[12]},selected:'user:old',presets:[{name:'예전 사용자 저장'}]};
  const initial=Object.fromEntries(OLD_KEYS.map(key=>[key,key==='azla_equalizer_v4'?JSON.stringify(prior):JSON.stringify({saved:'old'})]));
  const storage=memoryStorage(initial),result=restore(storage);
  assert.equal(result.selected,'flat');assert.equal(result.advanced,true);
  assert.deepEqual(storage.deletes,OLD_KEYS);
  for(const key of OLD_KEYS) assert.equal(storage.getItem(key),null,key);
  assert.ok(!JSON.stringify(result).includes('예전 사용자 저장'));
});

test('persist writes only the v5 UI preference and excludes EQ, names and device data',()=>{
  const storage=memoryStorage();
  persist(storage,{advanced:true,eq:{...flat(),secret:'do-not-save'},selected:'manual',presets:[{name:'삭제 대상'}],device:{serial:'private'}});
  assert.deepEqual(storage.writes.map(entry=>entry.key),['azla_equalizer_v5']);
  assert.deepEqual(JSON.parse(storage.getItem('azla_equalizer_v5')),{version:5,advanced:true});
  for(const forbidden of ['current','selected','presets','삭제 대상','secret','serial','device']) assert.ok(!storage.getItem('azla_equalizer_v5').includes(forbidden),forbidden);
});

test('blocked or malformed storage still returns FLAT without exposing old saves',()=>{
  const malformed=memoryStorage({azla_equalizer_v5:'{"advanced":'}),first=restore(malformed);
  assert.deepEqual(first.current,flat());assert.equal(first.selected,'flat');assert.equal(first.advanced,false);
  const denied=restore({getItem(){throw new Error('blocked');},removeItem(){throw new Error('blocked');}});
  assert.deepEqual(denied.current,flat());assert.equal(denied.selected,'flat');
});
