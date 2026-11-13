// WebHID port of the supplied Android register implementation. See docs/다중밴드_통신.md.
import {validateEq, cloneEq} from './eq.js';
export const REPORT_ID=0x4b;
const TO_WIRE={1:3,2:0,3:4,4:1,5:2};
const FROM_WIRE={0:2,1:4,2:5,3:1,4:3};
export function packet(address,command,value=0) {
  const bytes=new Uint8Array(10), view=new DataView(bytes.buffer);
  view.setUint32(0,address,true); bytes[4]=command; view.setUint32(6,value>>>0,true); return bytes;
}
export function reportBytes(device, direction) {
  let bits=0;
  const visit=collections=>{for(const c of collections||[]) {
    for(const r of c[direction+'Reports']||[]) if(r.reportId===REPORT_ID) for(const item of r.items||[]) bits+=item.reportSize*item.reportCount;
    visit(c.children);
  }}; visit(device.collections); return bits/8;
}
export class RegisterPipe {
  constructor(device,signal,timeout=1800) {this.device=device;this.signal=signal;this.timeout=timeout;this.active=false;this.poisoned=false;}
  async request(address,command,value=0) {
    if(this.active||this.poisoned||this.signal.aborted) throw new Error('기기를 다시 연결해 주세요.');
    this.active=true;
    try {return await new Promise((resolve,reject)=>{
      let timer;
      const cleanup=()=>{clearTimeout(timer);this.device.removeEventListener('inputreport',receive);this.signal.removeEventListener('abort',abort);};
      const fail=()=>{cleanup();this.poisoned=true;reject(new Error('기기 응답을 확인할 수 없습니다. 다시 연결해 주세요.'));};
      const abort=()=>fail();
      const receive=e=>{
        if(e.reportId!==REPORT_ID || (e.device && e.device!==this.device))return;
        const d=e.data;if(!d||d.byteLength!==10)return;
        const v=new DataView(d.buffer,d.byteOffset,10);
        if(v.getUint32(0,true)!==address||v.getUint8(4)!==command||v.getUint8(5)!==0)return;
        cleanup();resolve(v.getUint32(6,true));
      };
      this.device.addEventListener('inputreport',receive);this.signal.addEventListener('abort',abort,{once:true});
      timer=setTimeout(fail,this.timeout);
      Promise.resolve(this.device.sendReport(REPORT_ID,packet(address,command,value))).catch(fail);
    });} finally {this.active=false;}
  }
  read(a){return this.request(a,0x52);}
  async write(a,v){const ack=await this.request(a,0x57,v);if(ack!==0x4f&&ack!==3)throw new Error('기기가 설정을 승인하지 않았습니다. 다시 연결해 주세요.');}
}
export function decodeWords(words,count,globalEnabled=1) {
  const eq={freqs:[],gains:[],qs:[],filterTypes:[],tag:14,offset:0,enabled:false};
  for(let i=0;i<count;i++) {
    const a=words[i*2]>>>0,b=words[i*2+1]>>>0;
    const raw=a&65535;
    eq.freqs.push((a>>>16)*2);eq.gains.push((raw>=32768?raw-65536:raw)/10);
    eq.qs.push((b&65535)/1000);eq.filterTypes.push(FROM_WIRE[(b>>>16)&7]);
    eq.enabled ||= !!(b&0x80000);
  }
  eq.enabled &&= !!globalEnabled;
  return validateEq(eq);
}
export function encodeWords(eq,original) {
  eq=validateEq(eq);
  if(eq.freqs.length*2!==original.length)throw new Error('연결된 기기와 밴드 수가 다릅니다.');
  return eq.freqs.flatMap((hz,i)=>{
    if(i && hz<eq.freqs[i-1])throw new Error('주파수는 낮은 밴드부터 순서대로 설정해 주세요.');
    if(hz%2)throw new Error('주파수는 2 Hz 단위로 조절해 주세요.');
    return [(((hz/2)<<16)|(Math.round(eq.gains[i]*10)&65535))>>>0,
      ((original[2*i+1]&0xfff00000)|(eq.enabled===false?0:0x80000)|(TO_WIRE[eq.filterTypes[i]]<<16)|Math.round(eq.qs[i]*1000))>>>0];
  });
}
export class KtSession {
  constructor(pipe,count){this.pipe=pipe;this.count=count;this.base=count===5?0x26:0x35;this.words=null;this.global=1;this.ready=false;}
  async readEq(){
    this.ready=false;
    if(this.count===6)this.global=await this.pipe.read(0x34);
    const words=[];for(let i=0;i<this.count*2;i++)words.push(await this.pipe.read(this.base+i));
    const eq=decodeWords(words,this.count,this.global);this.words=words;this.ready=true;return eq;
  }
  async compare(words,global=this.global){
    if(this.count===6 && await this.pipe.read(0x34)!==global)throw new Error('기기 설정이 변경되었습니다. 다시 연결해 주세요.');
    for(let i=0;i<words.length;i++)if(await this.pipe.read(this.base+i)!==words[i])throw new Error('기기 설정이 변경되었습니다. 다시 연결해 주세요.');
  }
  async apply(input) {
    if(!this.ready)throw new Error('기기를 다시 연결해 주세요.');
    const eq=cloneEq(input),next=encodeWords(eq,this.words),old=[...this.words],global=this.global;
    await this.compare(old);let started=false;
    try {
      for(let i=0;i<next.length;i++)if(next[i]!==old[i]){started=true;await this.pipe.write(this.base+i,next[i]);}
      // KT0231 firmware updates playback coefficients on each playback register write.
      // It explicitly rejects the old SDK's tag/0x24 writes, so never send those.
      if(this.count===5&&started)await this.pipe.write(0x24,1);
      const newGlobal=this.count===6?(eq.enabled===false?0:1):global;
      if(this.count===6&&newGlobal!==global){started=true;await this.pipe.write(0x34,newGlobal);}
      await this.compare(next,newGlobal);this.words=next;this.global=newGlobal;
      return eq;
    } catch(error){
      this.ready=false;
      if(started && !this.pipe.poisoned)try{
        for(let i=0;i<old.length;i++)await this.pipe.write(this.base+i,old[i]);
        if(this.count===5)await this.pipe.write(0x24,1);else await this.pipe.write(0x34,global);
        await this.compare(old,global);
      }catch{/* Reconnect remains mandatory even if rollback succeeds. */}
      throw error;
    }
  }
  async save(eq,onBeforeFlash=()=>{}){
    await this.apply(eq);
    // No ACK assumed. Both firmwares may reset after this send.
    this.ready=false;onBeforeFlash();
    let timer;
    try { await Promise.race([this.pipe.device.sendReport(REPORT_ID,packet(0,0x53)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('저장 명령 전송을 확인하지 못했습니다. 다시 연결해 주세요.')),this.pipe.timeout);})]); }
    finally {clearTimeout(timer);}
    return {result:'flash-command-transmitted',persistenceVerified:false,eq:cloneEq(eq),requiresReconnect:true};
  }
}
