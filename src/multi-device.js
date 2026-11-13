import {DeviceController} from './device.js';
import {RegisterPipe,KtSession,reportBytes} from './kt.js';
import {cloneEq} from './eq.js';

/** Read-only identification precedes all EQ writes; shared Report ID is not identity. */
export class MultiDeviceController extends DeviceController {
  constructor(options){super(options);this.bandCount=null;this.session=null;this.connectedEq=null;this.savedEq=null;this.expectingReset=false;this.connectionFailure=null;}
  async connect(){
    this.session=null;this.bandCount=null;this.connectedEq=null;this.savedEq=null;this.expectingReset=false;
    this.connectionFailure=null;
    const device=await super.connect();if(!device)return null;
    let pipe=null,session=null,protocol=null;
    try {
      const input=reportBytes(device,'input'),output=reportBytes(device,'output');
      if(input===10&&output===10){
        pipe=new RegisterPipe(device,this.abort.signal);
        protocol=await pipe.read(1);
        let count=5;
        if(protocol===0x300){
          const chars=[];for(let a=2;a<6;a++){const word=await pipe.read(a);for(let i=0;i<4;i++)chars.push((word>>>(8*i))&255);}
          if(String.fromCharCode(...chars).replace(/\0.*$/s,'')!=='0231')throw new Error('지원되는 EQ 기기를 확인할 수 없습니다.');
          count=6;
        }
        session=new KtSession(pipe,count);
        const eq=await session.readEq();
        this.session=session;this.bandCount=count;this.connectedEq=eq;this.savedEq=cloneEq(eq);
      }else if(input>=36&&output>=36){
        await super.readEqTag();this.bandCount=10;
      }else throw new Error('지원되는 EQ 제어 인터페이스를 선택해 주세요.');
      return device;
    }catch(error){
      this.connectionFailure={version:1,time:new Date().toISOString(),stage:'read-only-connection',error:error.message,inputBytes:reportBytes(device,'input'),outputBytes:reportBytes(device,'output'),protocol,read:session?.lastRead||null,trace:pipe?.trace.map(entry=>({...entry}))||[]};
      await this.disconnect();throw error;
    }
  }
  async disconnect(){await super.disconnect();this.session=null;this.bandCount=null;this.connectedEq=null;this.savedEq=null;}
  diagnostics(){return {...super.diagnostics(),connectionFailure:this.connectionFailure};}
  assertCount(input){if(input.freqs.length!==this.bandCount)throw new Error('연결된 기기와 사운드의 밴드 수가 다릅니다.');}
  async readEqTag(timeout){
    if(this.session)return {tag:14,source:'full-eq',time:new Date().toISOString()};
    return super.readEqTag(timeout);
  }
  async preview(input,options={}){
    this.assertCount(input);
    if(!this.session)return super.preview(this.effectiveCb(input),options);
    if(this.busy||this.requiresReconnect||!this.device?.opened)throw new Error('기기를 다시 연결해 주세요.');
    if(options.isCurrent&&!options.isCurrent())return {result:'preview-skipped'};
    this.busy=true;
    try{
      const eq=await this.session.apply(input);
      return this.lastPreviewEvidence={eq,time:new Date().toISOString(),result:'ram-preview-transmitted',persistenceVerified:false};
    }catch(e){this.requiresReconnect=true;throw e;}finally{this.busy=false;}
  }
  effectiveCb(input){
    const eq=cloneEq(input);
    // CB exposes coefficients, not a bypass bit. Identity PEAK filters bypass all EQ.
    if(eq.enabled===false){eq.gains.fill(0);eq.filterTypes.fill(2);}
    return eq;
  }
  async apply(input){
    this.assertCount(input);
    if(!this.session)return super.apply(this.effectiveCb(input));
    if(this.busy||this.requiresReconnect||!this.device?.opened)throw new Error('기기를 다시 연결해 주세요.');
    this.busy=true;const device=this.device;
    try{
      this.onProgress(.1,'설정을 확인하고 있습니다');
      const result=await this.session.save(input,()=>{this.expectingReset=true;});
      this.requiresReconnect=true;
      this.lastEvidence={...result,time:new Date().toISOString(),device:{vendorId:device.vendorId,productId:device.productId}};
      this.onProgress(1,'저장 명령 전송 완료 · 다시 연결해 확인해 주세요');return this.lastEvidence;
    }catch(e){this.requiresReconnect=true;throw e;}finally{this.busy=false;}
  }
}
