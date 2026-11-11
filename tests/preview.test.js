import test from 'node:test';
import assert from 'node:assert/strict';
import { PreviewQueue } from '../src/preview.js';
import { PRESETS, cloneEq } from '../src/eq.js';
const eq = gain => { const value=cloneEq(PRESETS[0].eq);value.gains[4]=gain;return value; };
const tick = () => new Promise(resolve=>setTimeout(resolve,8));
const deferred = () => {let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};

test('rapid changes send only the latest immutable snapshot',async()=>{
  const sent=[];const queue=new PreviewQueue({delay:0,send:async value=>sent.push(value)});
  const value=eq(1);queue.enqueue(value);queue.enqueue(eq(2));value.gains[4]=9;
  await tick();await queue.idle();
  assert.deepEqual(sent.map(x=>x.gains[4]),[2]);
  assert.equal(queue.busy,false);
});

test('continuous input cannot indefinitely postpone audition until the drag ends',async()=>{
  const sent=[];
  const queue=new PreviewQueue({delay:500,maxWait:20,send:async value=>sent.push(value.gains[4])});
  for(let i=0;i<6;i++){queue.enqueue(eq(i));await tick();}
  assert.ok(sent.length>0,'an update must be sent while input events are still arriving');
  await new Promise(resolve=>setTimeout(resolve,30));await queue.idle();
  assert.equal(sent.at(-1),5);
  assert.equal(queue.busy,false);
});

test('one active transaction plus one latest pending edit; cancel and idle form a save barrier',async()=>{
  const gate=deferred(),sent=[],results=[];
  const queue=new PreviewQueue({delay:0,send:async value=>{sent.push(value.gains[4]);if(sent.length===1)await gate.promise;return value;},onResult:r=>results.push(r)});
  queue.enqueue(eq(1));await tick();queue.enqueue(eq(2));queue.enqueue(eq(3));await tick();
  assert.deepEqual(sent,[1]);gate.resolve();await queue.idle();
  assert.deepEqual(sent,[1,3]);assert.equal(results.length,2);
  queue.enqueue(eq(4));queue.cancel();await tick();await queue.idle();assert.deepEqual(sent,[1,3]);
});

test('cancellation during preparation invalidates the job and ignores its stale result',async()=>{
  const gate=deferred(),results=[];let current;
  const queue=new PreviewQueue({delay:0,send:async(value,isCurrent)=>{current=isCurrent;await gate.promise;return value;},onResult:r=>results.push(r)});
  queue.enqueue(eq(1));await tick();queue.cancel();assert.equal(current(),false);
  let idle=false;const drain=queue.idle().then(()=>{idle=true;});await tick();assert.equal(idle,false);
  gate.resolve();await drain;assert.deepEqual(results,[]);assert.equal(queue.busy,false);
});

test('transport failure discards pending edits and reports a single error',async()=>{
  const gate=deferred(),sent=[],errors=[];
  const queue=new PreviewQueue({delay:0,send:async value=>{sent.push(value);await gate.promise;throw new Error('USB failed');},onError:e=>errors.push(e.message)});
  queue.enqueue(eq(1));await tick();queue.enqueue(eq(2));await tick();gate.resolve();await queue.idle();await tick();
  assert.equal(sent.length,1);assert.deepEqual(errors,['USB failed']);assert.equal(queue.busy,false);
});
