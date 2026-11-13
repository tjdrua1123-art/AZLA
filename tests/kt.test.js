import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RegisterPipe,KtSession,packet,encodeWords,decodeWords} from '../src/kt.js';
import {presetsFor} from '../src/eq.js';

import {fixture} from './helpers/kt-fixture.js';
test('Android packet has a separate report ID and signed LE payload',()=>{
  assert.deepEqual([...packet(0x26,0x57,0xfff6)],[38,0,0,0,87,0,246,255,0,0]);
  const eq=presetsFor(5)[0].eq;eq.gains[0]=-3.7;
  const words=encodeWords(eq,Array(10).fill(0xabc00000));
  assert.equal(words[0]>>>16,30);assert.equal(words[0]&65535,0xffdb);assert.equal(words[1]>>>20,0xabc);
  assert.deepEqual(decodeWords(words,5),{...eq,tag:14});
});
for(const count of [5,6])test(`${count} bands: read, RAM, bypass, save have separate effects`,async()=>{
  const d=fixture(count);await d.open();const pipe=new RegisterPipe(d,new AbortController().signal),s=new KtSession(pipe,count);
  const initial=await s.readEq();assert.equal(initial.freqs.length,count);
  assert.ok(d.writes.every(b=>b[4]===0x52));
  const eq=presetsFor(count)[1].eq;await s.apply(eq);
  assert.ok(!d.writes.some(b=>b[4]===0x53));assert.deepEqual(decodeWords(s.words,count,s.global),{...eq,tag:14});
  if(count===5)assert.ok(d.writes.some(b=>b[0]===0x24&&b[4]===0x57));
  else assert.ok(!d.writes.some(b=>[22,36].includes(b[0])&&b[4]===0x57));
  await s.apply({...eq,enabled:false});assert.equal(decodeWords(s.words,count,s.global).enabled,false);
  const result=await s.save(eq);assert.equal(result.persistenceVerified,false);assert.equal(result.requiresReconnect,true);
  assert.equal(d.writes.filter(b=>b[4]===0x53).length,1);
});
test('external RAM edits prevent further writes',async()=>{
  const d=fixture(5),s=new KtSession(new RegisterPipe(d,new AbortController().signal),5);await s.readEq();
  d.memory.set(0x26,1);const n=d.writes.length;await assert.rejects(s.apply(presetsFor(5)[1].eq));
  assert.ok(d.writes.slice(n).every(b=>b[4]===0x52));
});
test('wrong report or address ignored; timeout poisons connection',async()=>{
  const d=new EventTarget();d.sendReport=async()=>{const e=new Event('inputreport');Object.assign(e,{reportId:76,data:new DataView(packet(1,0x52,1).buffer)});d.dispatchEvent(e);};
  const pipe=new RegisterPipe(d,new AbortController().signal,20);await assert.rejects(pipe.read(1));await assert.rejects(pipe.read(1));
});
test('odd frequency and wrong band count rejected before write',()=>{
  const eq=presetsFor(5)[0].eq;eq.freqs[0]=61;assert.throws(()=>encodeWords(eq,Array(10).fill(0)));
  assert.throws(()=>encodeWords(presetsFor(6)[0].eq,Array(10).fill(0)));
});
test('rejected RAM ACK stops save before Flash and requires a fresh session',async()=>{
  const d=fixture(6,{failAddress:53}),s=new KtSession(new RegisterPipe(d,new AbortController().signal),6);await s.readEq();
  await assert.rejects(s.save(presetsFor(6)[1].eq));assert.equal(s.ready,false);assert.ok(!d.writes.some(b=>b[4]===0x53));
});
test('Flash transmission failure is never reported as saved',async()=>{
  const d=fixture(5),send=d.sendReport;d.sendReport=async function(id,data){if(data[4]===0x53)throw new Error('USB removed');return send.call(this,id,data);};
  const s=new KtSession(new RegisterPipe(d,new AbortController().signal),5);await s.readEq();await assert.rejects(s.save(presetsFor(5)[0].eq));
});
test('a stalled Flash USB send has a bounded failure and disables the session',async()=>{
  const d=fixture(5),send=d.sendReport;d.sendReport=async function(id,data){if(data[4]===0x53)return new Promise(()=>{});return send.call(this,id,data);};
  const s=new KtSession(new RegisterPipe(d,new AbortController().signal,20),5);await s.readEq();await assert.rejects(s.save(presetsFor(5)[0].eq));assert.equal(s.ready,false);
});
