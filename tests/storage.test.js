import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, cloneEq } from '../src/eq.js';
import { restore, persist, restoreDeviceSnapshot, persistDeviceSnapshot, restoreSounds, persistSounds, soundName } from '../src/storage.js';

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

test('a fresh launch always starts from the shared 기본 모드 and Q 1.4 baseline',()=>{
  const storage=memoryStorage(),result=restore(storage);
  assert.equal(result.selected,'flat');assert.equal(result.advanced,false);
  assert.deepEqual(result.current,flat());
  assert.ok(result.current.gains.every(gain=>gain===0));
  assert.ok(result.current.qs.every(q=>q===1.4));
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

test('blocked or malformed storage still returns 기본 모드 without exposing old saves',()=>{
  const malformed=memoryStorage({azla_equalizer_v5:'{"advanced":'}),first=restore(malformed);
  assert.deepEqual(first.current,flat());assert.equal(first.selected,'flat');assert.equal(first.advanced,false);
  const denied=restore({getItem(){throw new Error('blocked');},removeItem(){throw new Error('blocked');}});
  assert.deepEqual(denied.current,flat());assert.equal(denied.selected,'flat');
});

test('last successful Flash transmission is stored separately from user presets',()=>{
  const storage=memoryStorage(),eq=flat();eq.gains[0]=2.5;eq.tag=14;
  const evidence={result:'flash-command-transmitted',time:'2026-11-06T00:00:00.000Z',device:{vendorId:0x3302,productId:0x1234},eq};
  const saved=persistDeviceSnapshot(storage,evidence);
  assert.equal(saved.tag,14);assert.equal(saved.eq.gains[0],2.5);
  assert.deepEqual(storage.writes.map(entry=>entry.key),['azla_equalizer_device_state_v1']);
  const restored=restoreDeviceSnapshot(storage);
  assert.deepEqual(restored,saved);
  restored.eq.gains[0]=9;
  assert.equal(restoreDeviceSnapshot(storage).eq.gains[0],2.5);
});

test('device snapshot rejects malformed records and incomplete Flash evidence',()=>{
  const storage=memoryStorage({azla_equalizer_device_state_v1:JSON.stringify({version:1,vendorId:1,productId:2,tag:9,savedAt:'now',eq:flat()})});
  assert.equal(restoreDeviceSnapshot(storage),null,'record tag must match EQ tag');
  assert.throws(()=>persistDeviceSnapshot(storage,{result:'ram-only',device:{vendorId:1,productId:2},eq:flat()}),/Flash/);
});


test('named sounds preserve full independent EQ snapshots across edits and deletion',()=>{
  const storage=memoryStorage(),eq=flat();eq.freqs[0]=70;eq.qs[0]=0.9;eq.gains[0]=-3;eq.filterTypes[0]=3;
  persistSounds(storage,[{id:'one',name:' 내 영화 ',eq}]);eq.gains[0]=9;
  let sounds=restoreSounds(storage);assert.equal(sounds[0].name,'내 영화');assert.equal(sounds[0].eq.gains[0],-3);
  assert.equal(sounds[0].eq.freqs[0],70);assert.equal(sounds[0].eq.qs[0],0.9);assert.equal(sounds[0].eq.filterTypes[0],3);
  sounds[0].name='이름 변경';sounds.push({id:'two',name:'다른 설정',eq:flat()});persistSounds(storage,sounds);
  assert.deepEqual(restoreSounds(storage).map(s=>s.name),['이름 변경','다른 설정']);
  persistSounds(storage,sounds.filter(s=>s.id!=='one'));assert.deepEqual(restoreSounds(storage).map(s=>s.id),['two']);
  assert.equal(restore(storage).selected,'flat','named sounds do not replace startup EQ');
  assert.equal(restoreSounds(storage).length,1,'UI preference migration must preserve named sounds');
});
test('invalid and duplicate names cannot corrupt the existing library',()=>{
  const storage=memoryStorage(),entry={id:'one',name:'My Sound',eq:flat()};persistSounds(storage,[entry]);
  const before=storage.getItem('azla_equalizer_sounds_v1');
  for(const name of ['', '   ', 'x'.repeat(41), 'a\nb'])assert.throws(()=>soundName(name));
  assert.throws(()=>persistSounds(storage,[entry,{...entry,id:'two',name:' my sound ' }]),/이미 사용/);
  assert.throws(()=>persistSounds(storage,[{...entry,eq:{gains:[2]}}]));
  assert.equal(storage.getItem('azla_equalizer_sounds_v1'),before);
  assert.throws(()=>persistSounds({setItem(){throw new Error('denied');}},[entry]),/denied/);
});
test('a corrupt or unavailable named-sound store fails safely, retaining valid entries',()=>{
  const good={id:'good',name:'정상',eq:flat()};
  const storage=memoryStorage({azla_equalizer_sounds_v1:JSON.stringify({version:1,sounds:[null,{...good,eq:{}},good,{...good,id:'duplicate'}]})});
  assert.deepEqual(restoreSounds(storage),[good]);
  assert.deepEqual(restoreSounds(memoryStorage({azla_equalizer_sounds_v1:'broken'})),[]);
  assert.deepEqual(restoreSounds({getItem(){throw new Error('denied');}}),[]);
});
