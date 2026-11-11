/**
 * AZLA EQ data and offline response model.
 * Analytic curves are previews, not vendor coefficients or acoustic measurements.
 * Distinct listening presets informed by primary audio references.
 * Exact gains are design choices, not measured corrections or universal optima.
 * Research and SDK response checks: docs/사운드_라이브러리_튜닝.md.
 */
export const BANDS = 10;
export const FREQUENCIES = Object.freeze([32, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]);
export const FPS_FREQUENCIES = Object.freeze([31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]);
export const QS = Object.freeze(Array(BANDS).fill(1.4));
export const SAMPLE_RATE = 96000;
export const FILTERS = Object.freeze({
  1: 'LOW SHELF', 2: 'PEAK', 3: 'HIGH SHELF', 4: 'LOW PASS', 5: 'HIGH PASS'
});
export const PRESET_REFERENCE = '공개 음향 자료 기반 자체 설계(2026-11-10) · Q 1.4 · 오디오 기기별 조절 필요';

function makeEq(gains = Array(BANDS).fill(0), options = {}) {
  return {
    freqs: [...(options.freqs || FREQUENCIES)],
    qs: [...(options.qs || QS)], gains: [...gains],
    filterTypes: [...(options.filterTypes || Array(BANDS).fill(2))],
    tag: options.tag ?? 14, offset: 0
  };
}

const preset = (id, name, category, description, icon, gains, options) => ({
  id, name, category, description, icon,
  reference: id === 'flat' ? '보정 없는 기본 설정' : options?.reference || PRESET_REFERENCE,
  eq: makeEq(gains, options)
});

/** Every preset is an editable starting point; none is a measured correction. */
export const PRESETS = [
  preset('flat', '기본 모드', 'REFERENCE', '원래의 소리를 그대로. 모든 밴드 0 dB.', 'flat', Array(BANDS).fill(0), {tag: 13}),
  preset('fps', 'FPS 모드', 'FPS', '중역과 고역을 강조해 발걸음과 효과음의 존재감을 높입니다.', 'crosshair',
    [0,0,3,1.8,5,4.5,3.5,4,4.5,0], {tag: 11, freqs: FPS_FREQUENCIES, reference: '사용자 제공 FPS 설정의 게인 비율을 50%로 조정 · 오디오 기기별 조절 필요'}),
  preset('vocal', '음악 보컬', '음악', '목소리의 두께를 남기면서 가사와 보컬의 존재감을 강조합니다.', 'mic',
    [-0.6,-0.6,0,-0.6,0,2.5,5,3.8,0,0], {tag: 16}),
  preset('music-balanced', '음악 밸런스', '음악', '중역은 유지하면서 저음의 탄력과 고음의 선명도를 더합니다.', 'music',
    [3.3,5,1.7,0,-0.8,0,0,2.5,4.2,2.5], {tag: 12}),
  preset('cinema', '영화', '영화', '깊은 저음과 선명한 대사를 강조해 영화의 몰입감을 더합니다.', 'film',
    [3.3,5,2.2,0,-1.1,0.6,2.8,2.8,1.1,0], {tag: 20})
];
for (const entry of PRESETS) {
  for (const value of Object.values(entry.eq)) if (Array.isArray(value)) Object.freeze(value);
  Object.freeze(entry.eq); Object.freeze(entry);
}
Object.freeze(PRESETS);

/** Returns a new canonical EQ object, rejecting coercions and malformed input. */
export function validateEq(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('EQ 설정 형식이 올바르지 않습니다.');
  for (const key of ['freqs','qs','gains','filterTypes']) {
    if (!Array.isArray(value[key]) || value[key].length !== BANDS) throw new Error('EQ는 10개 밴드의 주파수·게인·Q·필터가 필요합니다.');
  }
  for (let i=0; i<BANDS; i++) {
    const {freqs, qs, gains, filterTypes} = value;
    if (!Number.isInteger(freqs[i]) || freqs[i] < 20 || freqs[i] > 20000) throw new Error(`${i+1}번 주파수는 20~20,000 Hz 정수로 입력하세요.`);
    if (!Number.isFinite(qs[i]) || qs[i] < .5 || qs[i] > 5) throw new Error(`${i+1}번 Q는 0.5~5.0 사이로 입력하세요.`);
    if (!Number.isFinite(gains[i]) || gains[i] < -12 || gains[i] > 12) throw new Error(`${i+1}번 게인은 −12~+12 dB 사이로 입력하세요.`);
    if (!Number.isInteger(filterTypes[i]) || !Object.hasOwn(FILTERS, filterTypes[i])) throw new Error(`${i+1}번 필터 종류가 올바르지 않습니다.`);
  }
  const tag = value.tag ?? 14;
  if (!Number.isInteger(tag) || tag < 0 || tag > 255) throw new Error('사운드 식별값은 0~255 정수여야 합니다.');
  if (value.offset !== undefined && value.offset !== 0) throw new Error('이 프로그램은 전체 출력 게인 자동 보정을 사용하지 않습니다.');
  return {
    freqs: [...value.freqs], qs: [...value.qs], gains: [...value.gains],
    filterTypes: [...value.filterTypes], tag, offset: 0
  };
}

export function cloneEq(value) { return validateEq(value); }

export function signature(value) {
  const eq = validateEq(value);
  return JSON.stringify({freqs:eq.freqs, qs:eq.qs, gains:eq.gains, filterTypes:eq.filterTypes, tag:eq.tag});
}

function biquad(freq, q, gain, type) {
  const w = 2*Math.PI*freq/SAMPLE_RATE;
  const c = Math.cos(w), s = Math.sin(w), A = 10**(gain/40);
  let alpha = s/(2*q), b0, b1, b2, a0, a1, a2;
  if (type === 2) {
    b0=1+alpha*A; b1=-2*c; b2=1-alpha*A;
    a0=1+alpha/A; a1=-2*c; a2=1-alpha/A;
  } else if (type === 4) {
    b0=(1-c)/2; b1=1-c; b2=(1-c)/2;
    a0=1+alpha; a1=-2*c; a2=1-alpha;
  } else if (type === 5) {
    b0=(1+c)/2; b1=-(1+c); b2=(1+c)/2;
    a0=1+alpha; a1=-2*c; a2=1-alpha;
  } else {
    // RBJ shelf slope S=1, independent of Q. Vendor shelf implementations
    // may differ; these offline coefficients must never be sent to hardware.
    alpha=s/Math.SQRT2;
    const beta=2*Math.sqrt(A)*alpha;
    if (type === 1) {
      b0=A*((A+1)-(A-1)*c+beta); b1=2*A*((A-1)-(A+1)*c); b2=A*((A+1)-(A-1)*c-beta);
      a0=(A+1)+(A-1)*c+beta; a1=-2*((A-1)+(A+1)*c); a2=(A+1)+(A-1)*c-beta;
    } else {
      b0=A*((A+1)+(A-1)*c+beta); b1=-2*A*((A-1)+(A+1)*c); b2=A*((A+1)+(A-1)*c-beta);
      a0=(A+1)-(A-1)*c+beta; a1=2*((A-1)-(A+1)*c); a2=(A+1)-(A-1)*c-beta;
    }
  }
  return [b0/a0,b1/a0,b2/a0,a1/a0,a2/a0];
}

export function buildAnalyticModel(value) {
  const eq = validateEq(value);
  return {
    coeffs:eq.freqs.map((freq,i)=>biquad(freq,eq.qs[i],eq.gains[i],eq.filterTypes[i])),
    source:'analytic', sampleRate:SAMPLE_RATE, freqs:[...eq.freqs]
  };
}

/** Canonical denominator is 1+a1*z^-1+a2*z^-2 for every model source. */
export function responseAt(freq, model) {
  if (!model) return 0;
  if (!Number.isFinite(freq) || freq <= 0 || freq >= model.sampleRate/2) throw new RangeError('응답 계산 주파수가 올바르지 않습니다.');
  const w=2*Math.PI*freq/model.sampleRate, c=Math.cos(w), s=Math.sin(w), c2=Math.cos(2*w), s2=Math.sin(2*w);
  let db=0;
  for (const [b0,b1,b2,a1,a2] of model.coeffs) {
    const nr=b0+b1*c+b2*c2, ni=-b1*s-b2*s2;
    const dr=1+a1*c+a2*c2, di=-a1*s-a2*s2;
    db+=10*Math.log10(Math.max(nr*nr+ni*ni,1e-30)/Math.max(dr*dr+di*di,1e-30));
  }
  return Math.abs(db)<1e-10 ? 0 : db;
}

export function peakResponse(model) {
  const points=Array.from({length:2049},(_,i)=>20*1000**(i/2048));
  points.push(...(model?.freqs || []));
  let db=-Infinity, minDb=Infinity, freq=20;
  for (const point of points) {
    const value=responseAt(point,model);
    if (value>db) { db=value; freq=point; }
    minDb=Math.min(minDb,value);
  }
  return {db,freq,minDb};
}

/** REW plain TXT/CSV: frequency Hz and SPL dB in the first two columns. */
export function parseRew(text) {
  if (typeof text !== 'string' || text.length>5_000_000) throw new Error('측정 파일은 5 MB 이하 텍스트여야 합니다.');
  const rows=[];
  for (const line of text.replace(/^\uFEFF/,'').split(/\r?\n/)) {
    const value=line.trim();
    if (!value || /^[*#;%]/.test(value)) continue;
    const columns=value.split(/[\t;,\s]+/).filter(Boolean);
    if (columns.length<2) continue;
    const f=Number(columns[0]), db=Number(columns[1]);
    if (Number.isFinite(f)&&f>=10&&f<=50000&&Number.isFinite(db)&&db>=-200&&db<=250) rows.push({f,db});
    if (rows.length>100000) throw new Error('측정 데이터는 100,000행 이하여야 합니다.');
  }
  rows.sort((a,b)=>a.f-b.f);
  const unique=rows.filter((row,i)=>i===0||row.f!==rows[i-1].f);
  if (unique.length<10) throw new Error('유효한 측정값이 10개 이상 필요합니다. 첫 두 열이 주파수(Hz), SPL(dB)인지 확인하세요.');
  return unique;
}

/** Linear interpolation in dB on the logarithmic frequency axis. */
export function interpolate(freq, rows) {
  if (!Number.isFinite(freq)||freq<=0||!rows||rows.length<2||freq<rows[0].f||freq>rows.at(-1).f) return null;
  let low=0, high=rows.length-1;
  while (high-low>1) {
    const mid=(low+high)>>1;
    if (rows[mid].f>freq) high=mid; else low=mid;
  }
  const a=rows[low], b=rows[high];
  const t=(Math.log(freq)-Math.log(a.f))/(Math.log(b.f)-Math.log(a.f));
  return a.db+t*(b.db-a.db);
}

export function comparison(value, model, off, on) {
  const eq=validateEq(value); let total=0, count=0;
  const rows=eq.freqs.map((freq,i)=>{
    const before=interpolate(freq,off), after=interpolate(freq,on);
    const predicted=model?responseAt(freq,model):null;
    const measured=before===null||after===null?null:after-before;
    const error=predicted===null||measured===null?null:measured-predicted;
    if (error!==null) { total+=Math.abs(error); count++; }
    return {band:i+1,freq,predicted,measured,error};
  });
  return {rows,meanAbsoluteError:count?total/count:null,count};
}
