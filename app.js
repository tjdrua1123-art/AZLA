/* AZLA CB5100PRO EQ Test Studio — WalkPlay SDK 1.0.0 bridge.
   The SDK is shipped unmodified. All hardware writes use its public API.
   No firmware flashing, firmware binary uploading, or factory reset is performed. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const FREQUENCIES = [50, 125, 250, 500, 1000, 2000, 4000, 8000, 11000, 16000]; // Manufacturer WalkPlay 10-band UI reference
  const QS = [.65, .75, .60, .75, .75, .75, 1.20, .75, .75, .75]; // Manufacturer 10-band UI reference
  const BANDS = 10;
  const STORAGE_KEY = 'azla_cb5100_presets_v2';
  const OLD_STORAGE_KEY = 'azla_cb5100_presets_v1';
  const LAST_KEY = 'azla_cb5100_last_eq_v2';
  const OLD_LAST_KEY = 'azla_cb5100_last_eq_v1';
  const HID_GAP_MS = 130; // Vendor manual recommends >100 ms between device commands.
  const FILTERS = { 1:'LOW SHELF', 2:'PEAK', 3:'HIGH SHELF (실험)', 4:'LOW PASS', 5:'HIGH PASS' };
  const SAMPLE_RATE = 96000; // SDK CB EQ coefficient calculation default.
  const measurement = {off:null, on:null};
  const VID_LIST = [0x3302,0x0762,0x35D8,0x2FC6,0x0104,0xB44D,0x0661,0x0666,0x0D8C,0x0663];
  const SDK = window.WalkPlayWebEqSDK;
  const names = { fps:'FPS 게임', music:'일반 음악', flat:'FLAT', custom:'사용자 설정' };
  const descriptions = {
    fps:'10밴드 FPS 실험용: 300Hz +8dB / 3.2kHz +9dB. 주변 대역과 중첩되어 디지털 클리핑 위험이 있으니 낮은 볼륨으로 비교하세요.',
    music:'저역과 고역을 가볍게 보강한 음악 감상용 시작값입니다.',
    flat:'모든 밴드 게인이 0 dB인 EQ 비교 설정입니다.',
    custom:'주파수·Q·게인을 자유롭게 조절하세요.'
  };
  function makeEq(gains=Array(BANDS).fill(0), freqs=FREQUENCIES, qs=QS) {
    return { freqs:[...freqs], qs:[...qs], gains:[...gains], filterTypes:Array(BANDS).fill(2), tag:14 };
  }
  const factory = {
    flat:makeEq(),
    fps:makeEq([-5,-3,8,1,1.5,2.5,9,.5,0,-2], [50,125,300,500,1000,2000,3200,8000,11000,16000], [.75,.95,1.35,1.2,1.2,1.2,1.5,.9,.8,.8]),
    music:makeEq([1.2,1,.5,-.6,-.4,0,1,1.3,.8,.2]),
    custom:makeEq()
  };
  const tags = {fps:11,music:12,flat:13,custom:14};
  let activePreset = 'custom';
  let eq = clone(factory.custom);
  let saved = Object.create(null);
  let rawDevice = null;
  let transport = null;
  let sdk = null;
  let isBusy = false;
  let firmwareVersion = '미확인';
  let currentDeviceTag = null;
  let lastApplied = null;
  let lastFlashWrite = null;
  let graphScale = 24;
  let graphModel = null;
  let offlineSdk = null;
  let lastTxEvidence = null;
  const offlinePackets = []; // SDK is executed using a purely in-memory HID mock for graph modelling.
  const chart = $('responseChart');
  const ctx = chart.getContext('2d');

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }
  function cleanEq(value) {
    value = migrateLegacyEq(value);
    validate(value);
    return { freqs:[...value.freqs], qs:[...value.qs], gains:[...value.gains], filterTypes:[...value.filterTypes], tag:Number.isInteger(value.tag)?value.tag:14 };
  }
  // Legacy 8-band presets are preserved in slots 1–8 without changing their
  // frequency, Q or gain. Unused 9/10 are explicitly appended as 0 dB PEAK.
  // This is a compatibility conversion, not a remapping to the factory grid.
  function migrateLegacyEq(value) {
    if(!value || !Array.isArray(value.freqs) || value.freqs.length !== 8) return value;
    for(const field of ['qs','gains','filterTypes']) if(!Array.isArray(value[field]) || value[field].length!==8) return value;
    return {
      freqs:[...value.freqs,11000,16000],
      qs:[...value.qs,.75,.75],
      gains:[...value.gains,0,0],
      filterTypes:[...value.filterTypes,2,2],
      tag:Number.isInteger(value.tag)?value.tag:14
    };
  }
  function pause(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  function timeStamp() { return new Date().toLocaleTimeString('ko-KR', {hour12:false}); }
  function log(message, type='normal') {
    const row=document.createElement('div'); row.className='log-entry '+(type==='good'?'good':type==='bad'?'bad':'');
    const t=document.createElement('span');t.className='when';t.textContent=timeStamp();
    row.append(t,document.createTextNode(message)); $('eventLog').prepend(row);
    while($('eventLog').children.length>65) $('eventLog').lastElementChild.remove();
  }
  function feedback(message,type='normal') { const e=$('deviceFeedback');e.textContent=message;e.className='device-feedback '+(type==='normal'?'':type); }
  function validate(data) {
    if (!data || !Array.isArray(data.freqs) || !Array.isArray(data.qs) || !Array.isArray(data.gains) || !Array.isArray(data.filterTypes)) throw Error('EQ 데이터 배열이 없습니다.');
    for(const prop of ['freqs','qs','gains','filterTypes']) if(data[prop].length!==BANDS) throw Error('CB5100PRO 10밴드 EQ에는 각 배열 10개가 필요합니다.');
    for(let i=0;i<BANDS;i++){
      if(!Number.isFinite(data.freqs[i])||data.freqs[i]<20||data.freqs[i]>20000||!Number.isInteger(data.freqs[i]))throw Error(`${i+1}번 밴드 주파수는 20~20,000 Hz 정수로 지정하세요.`);
      if(!Number.isFinite(data.qs[i])||data.qs[i]<0.5||data.qs[i]>5)throw Error(`${i+1}번 밴드 Q는 0.5~5.0 범위입니다.`);
      if(!Number.isFinite(data.gains[i])||data.gains[i]<-12||data.gains[i]>12)throw Error(`${i+1}번 밴드 게인은 -12~+12 dB 범위입니다.`);
      if(!Object.hasOwn(FILTERS, data.filterTypes[i]))throw Error(`${i+1}번 밴드 필터 종류가 올바르지 않습니다.`);
    }
    return data;
  }
  function loadSaved() {
    try {
      const recent=localStorage.getItem(STORAGE_KEY);
      const old=localStorage.getItem(OLD_STORAGE_KEY);
      const parsed=JSON.parse(recent || old || '{}');
      if(parsed && typeof parsed==='object' && !Array.isArray(parsed)){
        for(const [key,value] of Object.entries(parsed)) {
          if(key.length<=36 && !['__proto__','constructor','prototype'].includes(key)){
            try{saved[key]=cleanEq(value);}catch{}
          }
        }
        if(!recent && old) {try{localStorage.setItem(STORAGE_KEY,JSON.stringify(saved));}catch{}}
      }
    }catch{}
    try {
      const newLast=localStorage.getItem(LAST_KEY);
      const oldLast=localStorage.getItem(OLD_LAST_KEY);
      const last=JSON.parse(newLast || oldLast || 'null');
      if(last && last.eq){eq=cleanEq(last.eq);activePreset='custom';}
      if(!newLast && oldLast) persistCurrent();
    }catch{}
  }
  function persistCurrent(){ try{localStorage.setItem(LAST_KEY,JSON.stringify({eq,activePreset:'custom'}));}catch{} }
  function formatFreq(v){return v>=1000?(v/1000).toFixed(v%1000===0?0:1)+'k':String(v)}
  function formatDb(v){return `${v>0?'+':''}${Number(v).toFixed(1)}`}
  // Unlike the v1.2 analytic-only graph, the graph now starts from the exact
  // 20-byte, quantized coefficients emitted by the unmodified vendor SDK.
  function getOfflineSdk() {
    if(offlineSdk) return offlineSdk;
    if(!SDK || !SDK.default) throw Error('WalkPlay SDK를 읽지 못했습니다.');
    const mockDevice = {
      addEventListener:()=>{}, removeEventListener:()=>{},
      sendReport:(id,data)=>{offlinePackets.push({id,payload:Uint8Array.from(data)});return Promise.resolve();}
    };
    offlineSdk = new SDK.default();
    offlineSdk.init(mockDevice,'CB',{loggerEnabled:false});
    return offlineSdk;
  }
  function generateModel(data=eq) {
    const deviceEq = {...cleanEq(data), offset:0};
    offlinePackets.length=0;
    getOfflineSdk().setEqInfo(deviceEq); // Simulated USB only; NEVER touches a real DAC.
    const reports=offlinePackets.filter(x=>x.id===75 && x.payload.length===36 && x.payload[0]===1 && x.payload[1]===9);
    if(reports.length!==BANDS) throw Error(`SDK가 ${reports.length}개 필터 패킷을 생성했습니다. 10개가 필요합니다.`);
    const coeffs = reports.map((r,i)=>{
      const v=new DataView(r.payload.buffer,r.payload.byteOffset,r.payload.byteLength);
      const expectedType=deviceEq.filterTypes[i];
      if(r.payload[33]!==expectedType || r.payload[4]!==i)throw Error(`밴드 ${i+1} 패킷 확인 실패`);
      const scale=(expectedType===3? 2**27:2**30);
      return Array.from({length:5},(_,j)=>v.getInt32(7+j*4,true)/scale);
    });
    return {coeffs, bytes:reports.map(r=>Array.from(r.payload)), eq:deviceEq};
  }
  function responseAt(freq, model=graphModel) {
    if(!model) return 0;
    const w=2*Math.PI*freq/SAMPLE_RATE, cos=Math.cos(w),sin=Math.sin(w),cos2=Math.cos(2*w),sin2=Math.sin(2*w);
    let db=0;
    for(const [b0,b1,b2,a1,a2] of model.coeffs){
      const nr=b0+b1*cos+b2*cos2, ni=-(b1*sin+b2*sin2);
      const dr=1-a1*cos-a2*cos2, di=a1*sin+a2*sin2;
      const num=nr*nr+ni*ni, den=dr*dr+di*di;
      db+=10*Math.log10(Math.max(num,1e-30)/Math.max(den,1e-30));
    }
    return db;
  }
  function refreshModel(){
    try{
      graphModel=generateModel(eq);
      const levels=Array.from({length:512},(_,i)=>responseAt(20*Math.pow(1000,i/511),graphModel));
      const peak=Math.max(...levels);
      $('graphNote').textContent=`제조사 SDK 정수 필터 계수 · 96kHz 기준 계산 · 예상 최대 ${peak>0?'+':''}${peak.toFixed(1)} dB · 실제 DAC 출력과 다를 수 있음`;
      const warn=$('peakWarning');
      if(warn){
        warn.textContent=peak>6?`주의: 10밴드 필터 중첩 예상 최대 +${peak.toFixed(1)} dB — 입력 음원이 크면 클리핑 위험이 있습니다. 자동 감쇄는 하지 않습니다.`:'참고: 자동 헤드룸/자동 게인 감쇄는 적용하지 않습니다.';
        warn.classList.toggle('peak-risk',peak>6);
      }
    }
    catch(err){graphModel=null;$('graphNote').textContent='곡선 계산 오류: '+err.message;log('SDK 계수 계산 오류: '+err.message,'bad');}
  }
  function measurementAt(freq, rows){
    if(!rows||rows.length<2||freq<rows[0].f||freq>rows.at(-1).f)return null;
    let lo=0,hi=rows.length-1;
    while(hi-lo>1){const m=(hi+lo)>>1;if(rows[m].f>freq)hi=m;else lo=m;}
    const a=rows[lo],b=rows[hi];
    if(a.f===freq)return a.db;
    const t=(Math.log(freq)-Math.log(a.f))/(Math.log(b.f)-Math.log(a.f));
    return a.db+t*(b.db-a.db);
  }
  function measuredDiff(freq){
    const a=measurementAt(freq,measurement.off),b=measurementAt(freq,measurement.on);
    return a===null||b===null?null:b-a;
  }
  function snapshot(data=eq){
    return JSON.stringify({freqs:data.freqs, qs:data.qs, gains:data.gains, filterTypes:data.filterTypes, tag:data.tag});
  }
  function refreshAppliedStatus(){
    const badge=$('applyState');if(!badge)return;
    if(!rawDevice){badge.textContent='미연결 · 설정 편집 중';badge.className='state-indicator';return;}
    if(!lastApplied){badge.textContent='연결됨 · 미적용';badge.className='state-indicator';return;}
    const same= snapshot(eq)===snapshot(lastApplied);
    if(!same){badge.textContent='편집값 변경됨 · DAC 재적용 필요';badge.className='state-indicator state-warn';return;}
    if(lastFlashWrite && snapshot(eq)===snapshot(lastFlashWrite)){
      badge.textContent='Flash 쓰기 명령 전송 · 영구 저장 미검증';badge.className='state-indicator state-flash';
    }else{badge.textContent='RAM 적용 명령 전송됨 · Flash 미저장';badge.className='state-indicator state-ok';}
  }
  function parseRew(content){
    // REW exports TXT/CSV in columns: frequency(Hz), SPL(dB), optionally phase etc.
    const rows=[];
    for(const line of content.split(/\r?\n/)){
      const t=line.trim();if(!t||/^[*#;%]/.test(t))continue;
      // Common REW CSV, TSV and whitespace-separated exports; decimal point only.
      const cols=t.replace(/\uFEFF/g,'').split(/[\t;,\s]+/).filter(Boolean);
      if(cols.length<2)continue;
      const f=Number(cols[0]),db=Number(cols[1]);
      if(Number.isFinite(f)&&f>=10&&f<=50000&&Number.isFinite(db)&&db>=-200&&db<=250)rows.push({f,db});
      if(rows.length>100000)throw Error('측정 파일이 너무 큽니다.');
    }
    rows.sort((a,b)=>a.f-b.f);
    const unique=rows.filter((r,i)=>i===0||r.f>rows[i-1].f);
    if(unique.length<10)throw Error('유효한 측정값을 10개 이상 찾지 못했습니다. 첫 2열이 주파수(Hz), SPL(dB)인지 확인하세요.');
    return unique;
  }
  async function readRewFile(kind,file){
    if(!file)return;
    try{
      if(file.size>5_000_000)throw Error('파일 크기는 5MB 이하여야 합니다.');
      const rows=parseRew(await file.text());
      measurement[kind]=rows;
      $(kind==='off'?'rewOffLabel':'rewOnLabel').textContent=`${file.name} · ${rows.length.toLocaleString()}행`;
      log(`REW ${kind==='off'?'EQ OFF':'EQ ON'} 측정 파일 로딩: ${rows.length}개 포인트`,'good');
      drawGraph();renderComparison();
    }catch(err){log('REW 읽기 실패: '+err.message,'bad');alert('측정 파일 읽기 실패: '+err.message);}
  }
  function renderComparison(){
    const tbody=$('comparisonRows');tbody.replaceChildren();
    const both=!!(measurement.off&&measurement.on);
    $('comparisonHint').textContent=both?'실측 변화량 = EQ ON SPL − EQ OFF SPL. 사진 판독값이 아닌 불러온 원본 파일 데이터입니다.':'REW에서 EQ 미적용(OFF)과 EQ 적용(ON) 응답을 각각 TXT/CSV로 내보내 불러오세요.';
    let errSum=0,count=0;
    eq.freqs.forEach((f,i)=>{
      const predicted=graphModel?responseAt(f):null;
      const measured=both?measuredDiff(f):null;
      const error=predicted!==null&&measured!==null?measured-predicted:null;
      const tr=document.createElement('tr');
      const vals=[String(i+1).padStart(2,'0'),f.toLocaleString('ko-KR'),predicted===null?'—':formatDb(predicted),measured===null?'—':formatDb(measured),error===null?'—':formatDb(error)];
      for(const v of vals){const td=document.createElement('td');td.textContent=v;tr.append(td);}
      tbody.append(tr);if(error!==null){errSum+=Math.abs(error);count++;}
    });
    $('errorSummary').textContent=count?`${BANDS}밴드 지점 평균 절대 차이: ${(errSum/count).toFixed(2)} dB (SDK 필터 계수 계산 대비)`:'두 측정 파일을 불러오면 오차를 계산합니다.';
  }
  function drawGraph() {
    const W=chart.width,H=chart.height, left=47,right=18,top=24,bottom=33,pW=W-left-right,pH=H-top-bottom;
    ctx.clearRect(0,0,W,H);
    const x=f=>left+(Math.log10(f)-Math.log10(20))/3*pW;
    // Filter-only response with a user-selected *fixed* vertical axis (no automatic graph resizing).
    const samples=Array.from({length:500},(_,i)=>{
      const freq=20*Math.pow(1000,i/499);
      return {freq,db:responseAt(freq)};
    });
    const range=graphScale;
    const y=db=>top+(range-db)/(2*range)*pH;
    ctx.save();ctx.lineWidth=1;ctx.font='12px Segoe UI, sans-serif';ctx.textBaseline='middle';
    for(const j of [-4,-2,0,2,4]){
      const db=j*range/4;
      ctx.strokeStyle=db===0?'#47546f':'#293345';ctx.beginPath();ctx.moveTo(left,y(db));ctx.lineTo(W-right,y(db));ctx.stroke();
      ctx.fillStyle='#8290a8';ctx.textAlign='right';ctx.fillText(`${db>0?'+':''}${db}`,left-12,y(db));
    }
    for(const freq of [20,50,100,200,500,1000,2000,5000,10000,20000]){
      const px=x(freq);ctx.strokeStyle='#253043';ctx.beginPath();ctx.moveTo(px,top);ctx.lineTo(px,H-bottom);ctx.stroke();
      ctx.fillStyle='#8290a8';ctx.textAlign='center';ctx.fillText(formatFreq(freq),px,H-bottom+17);
    }
    ctx.save();ctx.beginPath();ctx.rect(left,top,pW,pH);ctx.clip();
    const values=samples.map(s=>[x(s.freq),y(s.db)]);
    const fill=ctx.createLinearGradient(0,top,0,H-bottom);fill.addColorStop(0,'#8d79ff60');fill.addColorStop(1,'#8d79ff06');
    ctx.beginPath();ctx.moveTo(values[0][0],y(-range));for(const [px,py] of values)ctx.lineTo(px,py);ctx.lineTo(values.at(-1)[0],y(-range));ctx.closePath();ctx.fillStyle=fill;ctx.fill();
    ctx.beginPath();values.forEach(([px,py],i)=>i===0?ctx.moveTo(px,py):ctx.lineTo(px,py));ctx.strokeStyle='#a28eff';ctx.lineWidth=3.5;ctx.shadowColor='#9d88ff';ctx.shadowBlur=12;ctx.stroke();ctx.shadowBlur=0;
    if(measurement.off&&measurement.on){
      ctx.beginPath();let started=false;
      for(const s of samples){const delta=measuredDiff(s.freq);if(delta===null){started=false;continue;}
        if(!started){ctx.moveTo(x(s.freq),y(delta));started=true;}else ctx.lineTo(x(s.freq),y(delta));
      }
      ctx.strokeStyle='#5bdfcb';ctx.lineWidth=2.3;ctx.setLineDash([7,5]);ctx.shadowBlur=0;ctx.stroke();ctx.setLineDash([]);
    }
    for(let i=0;i<BANDS;i++) {
      const bx=x(eq.freqs[i]),by=y(responseAt(eq.freqs[i]));
      ctx.beginPath();ctx.arc(bx,by,4.5,0,2*Math.PI);ctx.fillStyle='#e8dcff';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#9277e9';ctx.stroke();
    }
    ctx.restore();
    ctx.restore();
  }
  function renderBands(){
    const frag=document.createDocumentFragment();
    for(let i=0;i<BANDS;i++) {
      const row=document.createElement('div');row.className='band-row';row.dataset.index=i;
      row.innerHTML=`<span class="band-num"><i class="band-color" style="opacity:${1-i*.085}"></i>${String(i+1).padStart(2,'0')}</span>
        <input aria-label="밴드 ${i+1} 주파수 Hz" class="num-input freq-input" type="number" min="20" max="20000" step="1" value="${eq.freqs[i]}">
        <input aria-label="밴드 ${i+1} 게인 dB" class="num-input gain-input" type="number" min="-12" max="12" step="0.1" value="${eq.gains[i]}">
        <input aria-label="밴드 ${i+1} 게인 슬라이더" class="gain-slider" type="range" min="-12" max="12" step="0.1" value="${eq.gains[i]}">
        <input aria-label="밴드 ${i+1} Q값" class="num-input q-input" type="number" min="0.5" max="5" step="0.05" value="${eq.qs[i]}">
        <select class="filter-select" aria-label="밴드 ${i+1} 필터">${Object.entries(FILTERS).map(([v,n])=>`<option value="${v}" ${Number(v)===eq.filterTypes[i]?'selected':''}>${n}</option>`).join('')}</select>`;
      frag.appendChild(row);
    }
    $('bandRows').replaceChildren(frag);
  }
  function setModeVisual() {
    document.querySelectorAll('[data-preset]').forEach(button=>button.classList.toggle('active',button.dataset.preset===activePreset));
    $('currentProfile').textContent=names[activePreset];$('profileDescription').textContent=descriptions[activePreset];
  }
  function updateEqView(){renderBands();refreshModel();drawGraph();renderComparison();setModeVisual();refreshAppliedStatus();}
  function applyMode(mode) {if(!factory[mode])return;activePreset=mode;eq=clone(factory[mode]);eq.tag=tags[mode];updateEqView();persistCurrent();log(`${names[mode]} 프리셋을 불러왔습니다. DAC에 적용하려면 임시 적용 버튼을 누르세요.`);}
  function updatedBand(i,prop,val) {
    if(!Number.isFinite(val))return;
    const lim=prop==='freqs'?[20,20000]:prop==='qs'?[.5,5]:[-12,12];
    eq[prop][i]=Math.min(lim[1],Math.max(lim[0],prop==='freqs'?Math.round(val):Math.round(val*100)/100));
    activePreset='custom';eq.tag=14;setModeVisual();refreshModel();drawGraph();renderComparison();refreshAppliedStatus();persistCurrent();
  }
  function renderSaved() {
    $('savedCount').textContent=`${Object.keys(saved).length}개`;
    const root=$('savedPresets');root.replaceChildren();
    if(Object.keys(saved).length===0){const p=document.createElement('p');p.className='empty';p.textContent='저장한 프리셋이 없습니다.';root.append(p);return;}
    for(const name of Object.keys(saved).sort((a,b)=>a.localeCompare(b,'ko'))){
      const row=document.createElement('div');row.className='saved-item';
      const load=document.createElement('button');load.className='saved-load';load.textContent=name;load.title='프리셋 불러오기';load.addEventListener('click',()=>{eq=cleanEq(saved[name]);activePreset='custom';eq.tag=14;updateEqView();persistCurrent();log(`${name} 불러오기 완료`);});
      const del=document.createElement('button');del.className='saved-delete';del.textContent='×';del.title='삭제';del.addEventListener('click',()=>{if(confirm(`"${name}" 프리셋을 삭제할까요?`)){delete saved[name];saveSaved();renderSaved();}});
      row.append(load,del);root.append(row);
    }
  }
  function saveSaved(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(saved));}catch{alert('저장소를 사용할 수 없습니다.');}}
  function busyUI(flag){isBusy=flag;$('connectBtn').disabled=flag||!!rawDevice;$('connectVidBtn').disabled=flag;$('disconnectBtn').disabled=flag||!rawDevice;$('previewBtn').disabled=flag||!rawDevice;$('flashBtn').disabled=flag||!rawDevice;$('readDeviceBtn').disabled=flag||!rawDevice;}
  function setDeviceDisplay() {
    const ok=!!rawDevice;const el=$('connectionStatus');el.classList.toggle('connected',ok);el.querySelector('span:last-child').textContent=ok?'DAC 연결됨':'DAC 미연결';
    $('deviceName').textContent=ok?(rawDevice.productName||'USB HID Audio Device'):'CB5100PRO';
    $('deviceDetail').textContent=ok?'WebHID 연결 · CB 프로토콜 선택':'장치 연결 대기';
    $('deviceVidPid').textContent=ok?`${rawDevice.vendorId.toString(16).toUpperCase().padStart(4,'0')} / ${rawDevice.productId.toString(16).toUpperCase().padStart(4,'0')}`:'— / —';
    $('firmwareVersion').textContent=firmwareVersion;
    $('deviceTag').textContent=currentDeviceTag===null?'미확인':String(currentDeviceTag);
    busyUI(isBusy);refreshAppliedStatus();
  }
  // Keep the vendor SDK unmodified, but serialize its non-awaited HID packet calls.
  // The source SDK's CB implementation invokes async sendReport calls without awaiting
  // each packet and invokes Flash independently; this adapter guarantees order.
  function makeSerialTransport(device) {
    let chain=Promise.resolve();let firstError=null;let sent=0;const listeners=[];const reportLog=[];
    return {
      facade: {
        addEventListener:(event,fn)=>{device.addEventListener(event,fn);listeners.push([event,fn]);},
        removeEventListener:(...args)=>device.removeEventListener(...args),
        sendReport:(reportId,data)=>{
          const payload=new Uint8Array(data);
          chain=chain.then(async()=>{
            if(firstError)throw firstError;
            if(!device.opened)throw Error('USB DAC 연결이 끊겼습니다.');
            await device.sendReport(reportId,payload);sent++;
            reportLog.push({reportId, bytes:Array.from(payload), index:payload[4], command:payload[1], timestamp:new Date().toISOString()});
            if(reportLog.length>240)reportLog.shift();
            await pause(HID_GAP_MS);
          }).catch(err=>{firstError??=err;});
          return chain;
        }
      },
      flush:async()=>{await chain;if(firstError){const e=firstError;firstError=null;throw e;}},
      detach:()=>{for(const [ev,fn] of listeners)device.removeEventListener(ev,fn);listeners.length=0;},
      sentCount:()=>sent,
      reports:()=>reportLog.slice()
    };
  }
  async function attachDevice(device) {
    if(rawDevice) await disconnect();
    rawDevice=device;
    if(!device.opened) await device.open();
    transport=makeSerialTransport(device);
    if(!SDK||!SDK.default)throw Error('제공된 WalkPlay SDK를 불러오지 못했습니다.');
    sdk=new SDK.default();sdk.init(transport.facade,'CB',{loggerEnabled:false});
    sdk.addEventLister(SDK.EventKeys.ReadDeviceVersion,(v)=>{firmwareVersion=v||'응답 없음';setDeviceDisplay();log(`펌웨어 버전 응답: ${v||'빈 값'}`,'good');});
    sdk.addEventLister(SDK.EventKeys.ReadEqTagId,(tag)=>{currentDeviceTag=tag;setDeviceDisplay();log(`기기 EQ Tag 응답: ${tag}`,'good');});
    if(sdk.getFilterIndexs().PK!==2)throw Error('CB PEAK 필터 프로토콜이 일치하지 않습니다.');
    firmwareVersion='읽는 중';currentDeviceTag=null;setDeviceDisplay();
    log(`연결됨: ${device.productName||'USB DAC'} (VID ${device.vendorId.toString(16)}, PID ${device.productId.toString(16)})`,'good');
    feedback('연결되었습니다. 장치가 CB5100PRO인지 확인한 다음 임시 적용을 진행하세요.','ok');
    await readDeviceInfo();
  }
  async function connect(customVid=null) {
    if(!navigator.hid){alert('이 브라우저는 WebHID를 지원하지 않습니다. Windows Chrome/Edge와 localhost 환경에서 실행하세요.');return;}
    try{
      busyUI(true);
      const filters=customVid!==null?[{vendorId:customVid}]:VID_LIST.map(v=>({vendorId:v}));
      const list=await navigator.hid.requestDevice({filters});
      if(!list.length){log('장치 선택이 취소되었습니다.');return;}
      await attachDevice(list[0]);
    }catch(err){log(`연결 실패: ${err.message}`,'bad');feedback(`연결 실패: ${err.message}`,'error');await disconnect();}
    finally{busyUI(false);}
  }
  async function disconnect(){
    try{if(transport)await transport.flush();}catch{}
    try{if(sdk)sdk.clearAllListeners();}catch{}
    try{if(transport)transport.detach();}catch{}
    try{if(rawDevice&&rawDevice.opened)await rawDevice.close();}catch{}
    rawDevice=null;transport=null;sdk=null;lastTxEvidence=null;$('packetState').textContent='HID 전송 대기 · 10밴드';firmwareVersion='미확인';currentDeviceTag=null;lastApplied=null;lastFlashWrite=null;setDeviceDisplay();refreshAppliedStatus();log('DAC 연결이 해제되었습니다.');feedback('USB DAC를 연결하세요.');
  }
  async function operation(action) {
    if(!rawDevice||!sdk||isBusy)return;
    busyUI(true);
    try{await action();}
    catch(err){log(`USB 작업 오류: ${err.message}`,'bad');feedback(`작업 실패: ${err.message}`,'error');}
    finally{busyUI(false);}
  }
  async function readDeviceInfo(){
    if(!sdk||!transport)return;
    try{sdk.readDeviceVersion();await transport.flush();await pause(160);sdk.readEqTagId();await transport.flush();}
    catch(err){log(`정보 읽기 명령 오류: ${err.message}`,'bad');feedback('기기 응답을 확인할 수 없습니다. 장치와 펌웨어의 WebHID 지원 여부를 확인하세요.','warn');}
  }
  function buildDeviceEq(){
    const data=clone(validate(eq));
    // All 10 band filter coefficients are sent. This does not update the device's global DAC offset.
    data.tag=tags[activePreset]??14;
    data.offset=0; // EQ packet field only; does not call setDacOffset (global DAC gain).
    return data;
  }
  async function writeRam(data){
    // Model validates 10 coefficient packets; use the original vendor SDK unchanged.
    const model=generateModel(data);
    const before=transport.reports().length;
    sdk.setEqInfo(data); // 10 CB bands + one memory refresh; no Flash command.
    await transport.flush();
    const writes=transport.reports().slice(before);
    const eqWrites=writes.filter(r=>r.reportId===75 && r.bytes.length===36 && r.bytes[0]===1 && r.bytes[1]===9);
    const indices=eqWrites.map(r=>r.index);
    const valid=eqWrites.length===BANDS && indices.every((v,i)=>v===i);
    if(!valid || writes.length!==BANDS+1)throw Error(`10밴드 전송 검증 실패: EQ ${eqWrites.length}/10, 명령 ${writes.length}/11, 인덱스 ${indices.join(',')}`);
    const refresh=writes.at(-1);
    if(!refresh || (refresh.bytes[0]===1 && refresh.bytes[1]===9))throw Error('메모리 반영 명령을 확인하지 못했습니다.');
    lastTxEvidence={version:'v1.4',time:new Date().toISOString(),chipType:'CB',bandCount:BANDS,expectedBandIndices:Array.from({length:BANDS},(_,i)=>i),bandIndices:indices,eq:clone(data),coefficientPackets:model.bytes,transmittedReports:writes};
    $('packetState').textContent=`HID EQ ${BANDS}/${BANDS} · 밴드 번호 0~9 확인 · 반영 명령 전송`;
    log(`10밴드 패킷 확인 완료: ${indices.join(', ')} + RAM 반영 명령`,'good');
    await pause(180);
  }
  async function preview() {await operation(async()=>{
    const data=buildDeviceEq();feedback('임시 EQ 전송 중...');await writeRam(data);lastApplied=clone(data);
    lastFlashWrite=null;refreshAppliedStatus();
    log(`${names[activePreset]} EQ RAM 임시 적용 명령 전송 완료 (Flash 미기록)`,'good');feedback('임시 적용 명령을 USB로 전송했습니다. 청음으로 실제 변화를 확인하세요. Flash에는 저장되지 않았습니다.','ok');
  });}
  async function flash(){
    $('confirmProfile').textContent=names[activePreset];$('confirmCheckbox').checked=false;$('confirmFlashBtn').disabled=true;$('confirmModal').hidden=false;
  }
  async function executeFlash(){
    $('confirmModal').hidden=true;
    await operation(async()=>{
      const data=buildDeviceEq();feedback('Flash 저장: EQ 전송 및 쓰기 준비 중...','warn');
      await writeRam(data);
      await pause(1100); // Vendor saveEqInfo uses 1000ms before Flash command.
      const beforeFlash=transport.reports().length;
      sdk.refereshToFlash();
      await transport.flush();
      const flashReports=transport.reports().slice(beforeFlash);
      if(flashReports.length!==1)throw Error(`Flash 명령 전송 확인 실패 (${flashReports.length}개)`);
      if(lastTxEvidence)lastTxEvidence.flashCommandReports=flashReports;
      await pause(300);
      lastApplied=clone(data);lastFlashWrite=clone(data);refreshAppliedStatus();
      log(`${names[activePreset]} 10밴드 EQ Flash 기록 명령 전송 완료 · tag=${data.tag}`,'good');
      feedback('Flash 쓰기 명령 전송 완료. 실제 비휘발성 보존 여부는 USB를 재연결한 후 청음 또는 계측으로 확인하세요.','ok');
      await pause(250);
      try{sdk.readEqTagId();await transport.flush();}catch(err){log(`저장 후 Tag 읽기 실패: ${err.message}`,'bad');}
    });
  }
  function saveUserPreset(){
    const name=$('presetName').value.trim();if(!name){$('presetName').focus();return;}
    if(name.length>36||['__proto__','constructor','prototype'].includes(name)){alert('사용할 수 없는 프리셋 이름입니다.');return;}
    try{validate(eq);}catch(err){alert(err.message);return;}
    if(saved[name]&&!confirm(`"${name}" 프리셋을 덮어쓸까요?`))return;
    saved[name]=cleanEq(eq);saved[name].tag=14;saveSaved();renderSaved();log(`"${name}" 프리셋을 브라우저에 저장했습니다.`,'good');$('presetName').value='';
  }
  function exportConfig(){
    const data={format:'azla-cb5100-eq-v2',bands:10,chipType:'CB',exportedAt:new Date().toISOString(),presets:saved,current:eq};
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='AZLA_CB5100_10Band_EQ_presets.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function importConfig(file){
    if(!file)return;
    try{
      if(file.size>200000)throw Error('프리셋 파일 크기가 너무 큽니다.');
      const parsed=JSON.parse(await file.text());if(!['azla-cb5100-eq-v1','azla-cb5100-eq-v2'].includes(parsed.format)||!parsed.presets||typeof parsed.presets!=='object'||Array.isArray(parsed.presets))throw Error('지원하지 않는 JSON 형식입니다.');
      let count=0;for(const [name,preset] of Object.entries(parsed.presets)){
        if(typeof name!=='string'||name.length>36||['__proto__','constructor','prototype'].includes(name))continue;
        try{saved[name]=cleanEq(preset);count++;}catch{}
      }
      if(parsed.current){try{eq=cleanEq(parsed.current);activePreset='custom';updateEqView();persistCurrent();}catch{}}
      saveSaved();renderSaved();log(`프리셋 ${count}개를 가져왔습니다. 구버전 8밴드는 원본 8개 유지 + 신규 2개 0dB로 변환합니다.`,'good');
    }catch(err){alert(`가져오기 실패: ${err.message}`);}
    finally{$('importInput').value='';}
  }
  function exportHidLog(){
    if(!lastTxEvidence){alert('먼저 DAC에 RAM 임시 적용 또는 Flash 저장을 실행하세요.');return;}
    const blob=new Blob([JSON.stringify(lastTxEvidence,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='AZLA_CB5100_10Band_HID_Log.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    log('10밴드 HID 전송 검증 로그를 내보냈습니다.','good');
  }
  function bindEvents(){
    document.querySelectorAll('[data-preset]').forEach(btn=>btn.addEventListener('click',()=>applyMode(btn.dataset.preset)));
    $('bandRows').addEventListener('input',ev=>{
      const input=ev.target, row=input.closest('.band-row');if(!row)return;
      const i=Number(row.dataset.index);
      if(input.classList.contains('gain-slider')){
        updatedBand(i,'gains',Number(input.value));row.querySelector('.gain-input').value=eq.gains[i];
      }else if(input.classList.contains('gain-input')){if(input.value==='')return;updatedBand(i,'gains',Number(input.value));row.querySelector('.gain-slider').value=eq.gains[i];}
      else if(input.classList.contains('freq-input')){if(input.value==='')return;updatedBand(i,'freqs',Number(input.value));}
      else if(input.classList.contains('q-input')){if(input.value==='')return;updatedBand(i,'qs',Number(input.value));}
      else if(input.classList.contains('filter-select')){eq.filterTypes[i]=Number(input.value);activePreset='custom';eq.tag=14;setModeVisual();refreshModel();drawGraph();renderComparison();refreshAppliedStatus();persistCurrent();}
    });
    $('bandRows').addEventListener('change',ev=>{
      const inp=ev.target,row=inp.closest('.band-row');if(!row)return;const i=Number(row.dataset.index);
      if(inp.classList.contains('freq-input'))inp.value=eq.freqs[i];
      if(inp.classList.contains('q-input'))inp.value=eq.qs[i];
      if(inp.classList.contains('gain-input'))inp.value=eq.gains[i];
      if(inp.classList.contains('filter-select')){eq.filterTypes[i]=Number(inp.value);activePreset='custom';eq.tag=14;setModeVisual();refreshModel();drawGraph();renderComparison();refreshAppliedStatus();persistCurrent();}
    });
    $('graphScaleSelect').addEventListener('change',ev=>{graphScale=Number(ev.target.value);drawGraph();});
    $('rewOffInput').addEventListener('change',ev=>readRewFile('off',ev.target.files[0]));
    $('rewOnInput').addEventListener('change',ev=>readRewFile('on',ev.target.files[0]));
    $('clearRewBtn').addEventListener('click',()=>{measurement.off=null;measurement.on=null;for(const id of ['rewOffInput','rewOnInput'])$(id).value='';$('rewOffLabel').textContent='미불러옴';$('rewOnLabel').textContent='미불러옴';drawGraph();renderComparison();});
    $('resetGainsBtn').addEventListener('click',()=>{eq.gains.fill(0);activePreset='custom';eq.tag=14;updateEqView();persistCurrent();});
    $('resetCustomBtn').addEventListener('click',()=>applyMode('custom'));
    $('savePresetBtn').addEventListener('click',saveUserPreset);
    $('presetName').addEventListener('keydown',e=>{if(e.key==='Enter')saveUserPreset();});
    $('exportBtn').addEventListener('click',exportConfig);
    $('importBtn').addEventListener('click',()=>$('importInput').click());
    $('importInput').addEventListener('change',ev=>importConfig(ev.target.files[0]));
    $('connectBtn').addEventListener('click',()=>connect());
    $('connectVidBtn').addEventListener('click',()=>{
      let text=$('customVid').value.trim().replace(/^0x/i,'');
      if(!/^[0-9a-f]{1,4}$/i.test(text)){alert('USB VID를 16진수 1~4자리로 입력하세요.');return;}
      connect(parseInt(text,16));
    });
    $('disconnectBtn').addEventListener('click',disconnect);
    $('previewBtn').addEventListener('click',preview);
    $('flashBtn').addEventListener('click',flash);
    $('readDeviceBtn').addEventListener('click',()=>operation(readDeviceInfo));
    $('confirmCheckbox').addEventListener('change',e=>$('confirmFlashBtn').disabled=!e.target.checked);
    $('confirmFlashBtn').addEventListener('click',executeFlash);
    $('cancelFlashBtn').addEventListener('click',()=>$('confirmModal').hidden=true);
    $('showHelpBtn').addEventListener('click',()=>$('helpModal').hidden=false);
    $('closeHelpBtn').addEventListener('click',()=>$('helpModal').hidden=true);
    $('clearLogBtn').addEventListener('click',()=>$('eventLog').replaceChildren());
    $('exportHidLogBtn').addEventListener('click',exportHidLog);
    for(const id of ['confirmModal','helpModal'])$(id).addEventListener('click',ev=>{if(ev.target===ev.currentTarget)ev.currentTarget.hidden=true;});
    document.addEventListener('keydown',ev=>{if(ev.key==='Escape'){$('confirmModal').hidden=true;$('helpModal').hidden=true;}});
    if(navigator.hid)navigator.hid.addEventListener('disconnect',ev=>{if(rawDevice&&ev.device===rawDevice)disconnect();});
  }
  loadSaved();bindEvents();updateEqView();renderSaved();setDeviceDisplay();
  if(!window.isSecureContext||!navigator.hid){feedback('WebHID를 사용할 수 없습니다. Chrome/Edge에서 http://localhost:8768 로 실행하세요.','warn');}
  log('v1.4 시작 — CB 타입 10밴드 / SDK 계수 기반 그래프 / 순차 HID 130ms / 8밴드 프리셋 변환');
})();
