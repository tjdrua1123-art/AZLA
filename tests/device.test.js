/**
 * Synthetic SDK and HID fixtures test the application transaction contract only.
 * They are not vendor implementation, firmware emulation, or hardware validation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TIMING, DeviceController, generatePlan, generateRamPlan,
  supportedDevices, isSupported, sdkGraphModel, discoverDevice, DISCOVERY_VIDS
} from '../src/device.js';
import { PRESETS, cloneEq } from '../src/eq.js';

test('manufacturer discovery reads identity without opening or writing and grants no write authorization', async () => {
  let openCalls = 0, writes = 0;
  const hid = { requestDevice: async ({ filters }) => {
    assert.deepEqual(filters.map(f => f.vendorId), DISCOVERY_VIDS);
    return [{ vendorId: 0x3302, productId: 1234, productName: 'Discovery only', open() { openCalls++; }, sendReport() { writes++; } }];
  } };
  const info = await discoverDevice(hid);
  assert.deepEqual(info, { name: 'Discovery only', vendorId: 0x3302, productId: 1234, writeAuthorized: false });
  assert.equal(openCalls, 0); assert.equal(writes, 0);
  assert.equal(isSupported(info, []), false);
  await assert.rejects(discoverDevice({ requestDevice: async () => [{ vendorId: 0xffff }] }));
  assert.equal(await discoverDevice({ requestDevice: async () => [] }), null);
});

const flat=()=>cloneEq(PRESETS.find(entry=>entry.id==='flat').eq);
const identity={vendorId:0x1234,productId:0x5678,name:'Synthetic AZLA test device'};

function fixtureSDK({bandCount=10, duplicateBand=false, wrongFilter=false, badRefresh=false, badFlash=false, failGenerate=false}={}) {
  return {default:class FixtureSDK {
    init(device,type) { assert.equal(type,'CB');this.device=device; }
    getFilterIndexs() {return {PK:2};}
    setEqInfo(eq) {
      if (failGenerate) throw new Error('Synthetic SDK generation failure');
      for(let index=0;index<bandCount;index++) {
        const payload=new Uint8Array(36);
        payload[0]=1;payload[1]=9;payload[4]=duplicateBand?0:index;
        payload[33]=wrongFilter?5:eq.filterTypes[index];
        new DataView(payload.buffer).setInt32(7,2**30,true);
        this.device.sendReport(75,payload);
      }
      this.device.sendReport(75,Uint8Array.from(badRefresh?[1,9,0,0,0,0,0]:[1,10,4,0,0,255,255]));
    }
    refereshToFlash() {
      this.device.sendReport(75,Uint8Array.from(badFlash?[1,10,4,0,0,255,255]:[1,1,0]));
    }
    clearAllListeners() {}
    setDacOffset() {throw new Error('Global DAC gain must never be changed');}
    saveEqInfo() {throw new Error('Unserialized SDK shortcut must never be called');}
  }};
}

function fixtureDevice({vendorId=identity.vendorId,productId=identity.productId,failAt=null,neverResolve=false}={}) {
  return {
    vendorId,productId,productName:identity.name,opened:false,openCalls:0,closeCalls:0,writes:[],
    async open(){this.opened=true;this.openCalls++;},
    async close(){this.opened=false;this.closeCalls++;},
    async sendReport(reportId,payload){
      const index=this.writes.length;
      this.writes.push({reportId,bytes:[...payload]});
      if(index===failAt)throw new Error('Synthetic HID write rejection');
      if(neverResolve)return new Promise(()=>{});
    }
  };
}

function fixtureHid(device) {
  const listeners=new Map();
  return {
    filters:null,
    addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},
    removeEventListener(name,fn){listeners.get(name)?.delete(fn);},
    async requestDevice({filters}){this.filters=filters;return [device];},
    emitDisconnect(){device.opened=false;for(const fn of listeners.get('disconnect')||[])fn({device});}
  };
}

async function connected({SDK=fixtureSDK(),device=fixtureDevice(),wait,timing=TIMING}={}) {
  const hid=fixtureHid(device),waits=[],progress=[];
  const controller=new DeviceController({
    SDK,hid,devices:[identity],timing,
    wait:wait|| (async(ms,signal)=>{assert.ok(signal);waits.push(ms);if(signal.aborted)throw new Error('Aborted');}),
    onProgress:(fraction,label)=>progress.push({fraction,label})
  });
  await controller.connect();
  return {controller,hid,device,waits,progress};
}

test('Flash apply sends every flat band, RAM refresh, waits, and one Flash command in order',async()=>{
  const {controller,device,hid,waits,progress}=await connected();
  const result=await controller.apply(flat());
  assert.deepEqual(hid.filters,[{vendorId:identity.vendorId,productId:identity.productId}]);
  assert.equal(device.writes.length,12);
  assert.deepEqual(result.reports.map(entry=>entry.phase),[...Array(10).fill('eq'),'ram','flash']);
  assert.deepEqual(device.writes.slice(0,10).map(entry=>entry.bytes[4]),[0,1,2,3,4,5,6,7,8,9]);
  assert.ok(device.writes.slice(0,10).every(entry=>entry.reportId===75&&entry.bytes.length===36));
  assert.deepEqual(device.writes.slice(10).map(entry=>entry.bytes[1]),[10,1]);
  assert.deepEqual(waits,[...Array(11).fill(130),1100,130,350]);
  assert.equal(result.result,'flash-command-transmitted');
  assert.equal(result.persistenceVerified,false);
  assert.equal(progress.at(-1).label,'Flash 저장 명령 전송 완료');
  assert.equal(progress.at(-1).fraction,1);
  assert.equal(controller.busy,false);assert.equal(controller.requiresReconnect,false);
});

test('incomplete, duplicate, wrong-filter and invalid Flash SDK plans cause no physical writes',async()=>{
  for(const options of [
    {bandCount:8},{duplicateBand:true},{wrongFilter:true},
    {badRefresh:true},{badFlash:true},{failGenerate:true}
  ]) {
    const {controller,device}=await connected({SDK:fixtureSDK(options)});
    await assert.rejects(controller.apply(flat()));
    assert.equal(device.writes.length,0,JSON.stringify(options));
    assert.equal(controller.lastEvidence,null);
    assert.equal(controller.requiresReconnect,true);
  }
});

test('invalid settings and missing SDK are rejected without physical writes',async()=>{
  const {controller,device}=await connected();
  const eq=flat();eq.gains[0]=13;
  await assert.rejects(controller.apply(eq),/게인/);
  assert.equal(device.writes.length,0);
  await assert.rejects(generatePlan(undefined,flat()),/SDK/);
});

test('a mismatched product ID is rejected before opening or sending to the device',async()=>{
  const device=fixtureDevice({productId:identity.productId+1});
  const controller=new DeviceController({SDK:fixtureSDK(),hid:fixtureHid(device),devices:[identity]});
  await assert.rejects(controller.connect(),/지원되는 AZLA 장치가 아닙니다/);
  assert.equal(device.openCalls,0);assert.equal(device.writes.length,0);
  assert.equal(isSupported(device,[identity]),false);
});

test('empty device configuration blocks the picker and config validation preserves exact pairs',async()=>{
  const device=fixtureDevice(),hid=fixtureHid(device);
  const controller=new DeviceController({SDK:fixtureSDK(),hid,devices:[]});
  await assert.rejects(controller.connect(),/지원 장치 등록/);
  assert.equal(hid.filters,null);
  const result=supportedDevices({version:1,devices:[identity,{vendorId:1},{vendorId:0,productId:3},{vendorId:65536,productId:3},{vendorId:2,productId:-1}]});
  assert.deepEqual(result,[identity]);
  assert.deepEqual(supportedDevices({version:2,devices:[identity]}),[]);
});

test('a second apply is rejected while the first transaction is active',async()=>{
  const {controller,device}=await connected();
  const first=controller.apply(flat());
  await assert.rejects(controller.apply(flat()),/저장이 진행 중/);
  await first;
  assert.equal(device.writes.length,12);
});

test('a write rejection stops the transaction, prevents Flash, and requires reconnect',async()=>{
  const {controller,device}=await connected({device:fixtureDevice({failAt:3})});
  await assert.rejects(controller.apply(flat()),/Synthetic HID write rejection/);
  assert.equal(device.writes.length,4);
  assert.ok(device.writes.every(entry=>entry.bytes[1]!==1));
  assert.equal(controller.lastEvidence,null);
  assert.equal(controller.requiresReconnect,true);
  assert.equal(controller.busy,false);
  await assert.rejects(controller.apply(flat()),/먼저 AZLA 장치를 연결/);
  await controller.connect();
  assert.equal(controller.requiresReconnect,false);
});

test('USB disconnect during the pre-Flash wait aborts the save without a Flash write',async()=>{
  let hid;
  const {controller,device,hid:chosenHid}=await connected({wait:async(ms)=>{if(ms===TIMING.beforeFlash)hid.emitDisconnect();}});
  hid=chosenHid;
  await assert.rejects(controller.apply(flat()),/연결이 끊어/);
  assert.equal(device.writes.length,11);
  assert.ok(device.writes.every(entry=>entry.bytes[1]!==1));
  assert.equal(controller.device,null);
  assert.equal(controller.requiresReconnect,true);
  assert.equal(controller.lastEvidence,null);
});

test('a timed-out HID write prevents further writes and never sends Flash',async()=>{
  const timing={...TIMING,timeout:8};
  const {controller,device}=await connected({timing,device:fixtureDevice({neverResolve:true})});
  await assert.rejects(controller.apply(flat()),/응답 시간이 초과/);
  assert.equal(device.writes.length,1);
  assert.equal(controller.requiresReconnect,true);
  assert.equal(controller.lastEvidence,null);
  assert.equal(controller.busy,false);
});

test('more than 40 consecutive saves retain complete monotonic evidence after the 240-report cap',async()=>{
  const {controller,device}=await connected();
  let previous=0;
  for(let run=0;run<42;run++) {
    const evidence=await controller.apply(flat());
    assert.equal(evidence.reports.length,12,`run ${run}`);
    assert.deepEqual(evidence.reports.map(entry=>entry.sequence),Array.from({length:12},(_,i)=>previous+i+1));
    previous=evidence.reports.at(-1).sequence;
    assert.equal(evidence.persistenceVerified,false);
  }
  assert.equal(device.writes.length,42*12);
  assert.equal(controller.log.length,240);
  assert.equal(controller.sequence,42*12);
  assert.equal(controller.log.at(-1).sequence,42*12);
  assert.equal(controller.log[0].sequence,42*12-239);
  assert.equal(controller.diagnostics().lastEvidence.reports.length,12);
});

test('SDK graph conversion preserves fixed-point values and flips vendor feedback signs',async()=>{
  const eq=flat();
  const packets=await generateRamPlan(fixtureSDK(),eq);
  const bytes=Uint8Array.from(packets[0].bytes),view=new DataView(bytes.buffer);
  view.setInt32(7,2**30,true);view.setInt32(11,-(2**28),true);
  view.setInt32(15,2**27,true);view.setInt32(19,2**29,true);view.setInt32(23,-(2**28),true);
  packets[0].bytes=[...bytes];
  const model=sdkGraphModel(packets,eq);
  assert.deepEqual(model.coeffs[0],[1,-.25,.125,-.5,.25]);
  assert.equal(model.source,'sdk');assert.equal(model.sampleRate,96000);
});
