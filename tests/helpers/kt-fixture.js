import assert from 'node:assert/strict';
import {packet,encodeWords} from '../../src/kt.js';
import {presetsFor} from '../../src/eq.js';
export function fixture(count,{protocol=count===6?0x300:0x200,chip='0231',failAddress=null}={}){
  const memory=new Map([[1,protocol],[0x34,1]]),base=count===5?0x26:0x35;
  for(let i=0;i<4;i++){let word=0;for(let j=0;j<4;j++)word|=(chip.charCodeAt(i*4+j)||0)<<(j*8);memory.set(2+i,word>>>0);}
  const original=encodeWords(presetsFor(count)[0].eq,Array(count*2).fill(0xa5f00000));
  original.forEach((v,i)=>memory.set(base+i,v));
  const d=new EventTarget();Object.assign(d,{vendorId:0x31b2,productId:1234,productName:'MUST NOT DISPLAY',opened:false,writes:[],memory,
    collections:[{inputReports:[{reportId:75,items:[{reportSize:8,reportCount:10}]}],outputReports:[{reportId:75,items:[{reportSize:8,reportCount:10}]}]}],
    async open(){this.opened=true;},async close(){this.opened=false;},
    async sendReport(id,bytes){
      bytes=new Uint8Array(bytes);assert.equal(id,75);assert.equal(bytes.length,10);this.writes.push([...bytes]);
      const v=new DataView(bytes.buffer,bytes.byteOffset,10),a=v.getUint32(0,true),cmd=bytes[4];
      if(cmd===0x53)return;
      let result=cmd===0x52?(memory.get(a)||0):0x4f;
      if(cmd===0x57){
        if(a===failAddress)result=0x45;
        else {assert.ok(a>=base&&a<base+count*2||count===5&&a===0x24||count===6&&a===0x34,'No undocumented writes');memory.set(a,v.getUint32(6,true));}
      }
      const answer=packet(a,cmd,result);
      queueMicrotask(()=>{const e=new Event('inputreport');Object.assign(e,{reportId:75,device:d,data:new DataView(answer.buffer)});d.dispatchEvent(e);});
    }
  });return d;
}
