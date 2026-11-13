"""Consumer flows using mocked USB only; real browser and unmodified CB SDK."""
from playwright.sync_api import sync_playwright
import json
from pathlib import Path
BASE='http://127.0.0.1:8768'
FIXTURE=r'''
(count)=>{
window.__count=count;window.__writes=[];window.__listeners=new Set();window.__tag=13;
const freqs=count===5?[60,250,1000,4000,12000]:[60,200,600,1500,4000,12000],base=count===5?38:53;
const mem=new Map([[1,count===6?0x300:0x200],[2,0x31333230],[52,1]]);
for(let i=0;i<count;i++){mem.set(base+i*2,((freqs[i]/2)<<16)>>>0);mem.set(base+i*2+1,0x80000|1400);}
window.__memory=mem;
window.__device={vendorId:count===10?0x3302:0x31b2,productId:count,productName:'SECRET-PRODUCT-KT02H20',opened:false,
collections:[{inputReports:[{reportId:75,items:[{reportSize:8,reportCount:count===10?36:10}]}],outputReports:[{reportId:75,items:[{reportSize:8,reportCount:count===10?36:10}]}]}],
async open(){this.opened=true},async close(){this.opened=false},addEventListener(n,f){if(n==='inputreport')window.__listeners.add(f)},removeEventListener(n,f){window.__listeners.delete(f)},
async sendReport(id,data){const b=new Uint8Array(data);window.__writes.push([...b]);let answer;
if(count===10){if(b.length===36&&b[1]===9)window.__tag=b[35];if(b.join(',')!=='128,9,0')return;answer=new Uint8Array(36);answer[1]=9;answer[35]=window.__tag;}
else {const v=new DataView(b.buffer,b.byteOffset,b.byteLength),a=v.getUint32(0,true),cmd=b[4];if(cmd===0x53)return;answer=new Uint8Array(10);const out=new DataView(answer.buffer);out.setUint32(0,a,true);answer[4]=cmd;if(cmd===0x57){if(!((a>=base&&a<base+count*2)||(count===5&&a===36)||(count===6&&a===52)))throw Error('unsafe address '+a);mem.set(a,v.getUint32(6,true));}out.setUint32(6,cmd===0x52?(mem.get(a)||0):0x4f,true);}
queueMicrotask(()=>{for(const f of window.__listeners)f({device:this,reportId:75,data:new DataView(answer.buffer)})});}}
Object.defineProperty(navigator,'hid',{value:{addEventListener(){},async requestDevice(){return [window.__device]}}});
}
'''
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    for count in [5,6,10]:
        page=browser.new_page(viewport={'width':1440,'height':900})
        errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.add_init_script('('+FIXTURE+')('+str(count)+')')
        page.goto(BASE);page.wait_for_selector('#guideConnectBtn')
        assert page.locator('#equalizerPanel').is_hidden()
        assert page.locator('.brand-logo').evaluate('(e)=>e.complete&&e.naturalWidth>0')
        page.locator('#guideConnectBtn').click();page.wait_for_selector('#equalizerPanel:visible')
        page.wait_for_function('!document.querySelector("#connectBtn").disabled')
        assert page.locator('.band-column').count()==count
        assert str(count)+'밴드' in page.locator('#connectionLabel').inner_text()
        assert not any(x in page.locator('body').inner_text() for x in ['SECRET-PRODUCT','KT02','KT0231','A500','AIM8','CB5100'])
        assert page.evaluate('window.__writes.every(b=>b[4]===0x52)') if count!=10 else page.evaluate('window.__writes.every(b=>b.join(",")==="128,9,0")')
        page.locator('[data-preset="fps"]').click();page.wait_for_timeout(2500 if count==10 else 500)
        assert not page.evaluate('window.__writes.some(b=>b[4]===0x53||b.join(",")==="1,1,0")')
        page.locator('.band-gain input').nth(1).fill('3.2');page.wait_for_timeout(1500 if count==10 else 500)
        assert page.locator('.band-gain input').nth(1).input_value()=='3.2'
        page.locator('#eqEnabled').uncheck();page.wait_for_timeout(1800 if count==10 else 500)
        assert not page.evaluate('window.__writes.some(b=>b[4]===0x53||b.join(",")==="1,1,0")')
        page.locator('#eqEnabled').check();page.wait_for_timeout(1800 if count==10 else 500)
        page.locator('#createSoundBtn').click();page.locator('#soundName').fill('내 사운드');page.locator('#soundSubmit').click()
        assert page.locator('[data-sound]').count()==1
        page.locator('#applyBtn').click();page.wait_for_function('document.querySelector("#applyProgress").hidden',timeout=20000)
        assert page.evaluate('window.__writes.filter(b=>b[4]===0x53||b.join(",")==="1,1,0").length')==1
        assert '다시 연결' in page.locator('#toast').inner_text() if count!=10 else True
        if count!=10:
            page.locator('#connectBtn').click();page.wait_for_selector('#connectionGuide:visible')
            page.locator('#guideConnectBtn').click();page.wait_for_selector('#equalizerPanel:visible');page.wait_for_function('!document.querySelector("#connectBtn").disabled')
            assert page.locator('.band-gain input').nth(1).input_value()=='3.2'
            page.locator('#viewSavedEqBtn').click();assert page.locator('.band-gain input').nth(1).is_disabled()
            page.locator('#returnEditBtn').click()
        for w,h in [(1920,1080),(1366,768),(1100,720),(1024,600)]:
            page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(100)
            r=page.locator('#applyBtn').bounding_box();assert r['y']+r['height']<=h,(count,w,h,r)
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(count,w,h,'horizontal overflow')
        page.set_viewport_size({'width':1440,'height':900});page.wait_for_timeout(200)
        page.screenshot(path=f'/workspace/work/azla-{count}-bands.png')
        assert not errors,errors
        print(f'{count} bands: connection/read/RAM/bypass/library/Flash/reconnect/layout PASS')
        page.close()
    page=browser.new_page(viewport={'width':1440,'height':900});page.goto(BASE);page.wait_for_selector('#guideConnectBtn');page.screenshot(path='/workspace/work/azla-connect.png')
    browser.close()
