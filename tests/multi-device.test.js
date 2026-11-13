import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MultiDeviceController} from '../src/multi-device.js';
import {fixture} from './helpers/kt-fixture.js';
for(const count of [5,6])test(`auto detect ${count}, no writes on connection`,async()=>{
  const d=fixture(count),hid={requestDevice:async()=>[d],addEventListener(){}};
  const c=new MultiDeviceController({hid,SDK:{default:class{}},connectionMode:'manufacturer'});
  await c.connect();assert.equal(c.bandCount,count);assert.equal(c.connectedEq.freqs.length,count);
  assert.ok(d.writes.every(b=>b[4]===0x52));await c.disconnect();assert.equal(c.bandCount,null);
});
test('unknown six band fingerprint cannot cause writes',async()=>{
  const d=fixture(6,{chip:'OTHER'}),c=new MultiDeviceController({hid:{requestDevice:async()=>[d],addEventListener(){}},SDK:{default:class{}},connectionMode:'manufacturer'});
  await assert.rejects(c.connect());assert.equal(c.device,null);assert.ok(d.writes.every(b=>b[4]===0x52));
});
test('invalid sixth band retains raw diagnostic response after closing and never writes',async()=>{
  const d=fixture(6);d.memory.set(0x3f,(12000<<16)>>>0);
  const c=new MultiDeviceController({hid:{requestDevice:async()=>[d],addEventListener(){}},SDK:{default:class{}},connectionMode:'manufacturer'});
  await assert.rejects(c.connect(),/6번 주파수/);assert.equal(c.device,null);
  const failure=c.diagnostics().connectionFailure;
  assert.equal(failure.read.bands[5].frequencyWord,12000);assert.equal(failure.read.bands[5].frequencyHz,24000);
  assert.equal(failure.read.bands[5].addresses[0],0x3f);
  assert.equal(failure.trace.find(e=>e.address===0x3f).response,(12000<<16)>>>0);
  assert.ok(d.writes.every(b=>b[4]===0x52));assert.ok(!JSON.stringify(failure).includes(d.productName));
});
