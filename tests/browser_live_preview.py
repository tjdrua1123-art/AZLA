"""Real bundled SDK + mock HID: audition, save barrier, consent, and errors.

Run with server.mjs serving port 8768. No physical DAC is exercised.
"""
import ast
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

# Reuse the browser smoke test's mock without executing that test script.
fixture = next(ast.literal_eval(node.value) for node in ast.parse(Path('tests/browser_smoke.py').read_text()).body
               if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'fixture' for t in node.targets))
fixture += """
window.__flashCount=()=>window.__writes.filter(w=>w.bytes.join(',')==='1,1,0').length;
const originalSend=window.__device.sendReport;
window.__device.sendReport=async function(id,data){
  if(window.__failNext){window.__failNext=false;throw new Error('Mock USB failure')}
  if(window.__gateNext){window.__gateNext=false;await new Promise(resolve=>window.__release=resolve)}
  return originalSend.call(this,id,data);
};
"""
config = {'version':1,'devices':[{'vendorId':4660,'productId':22136,'name':'Synthetic AZLA device'}]}

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':1366,'height':768})
    context.add_init_script(fixture)
    page=context.new_page(); errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.route('**/device-config.json',lambda route:route.fulfill(content_type='application/json',body=json.dumps(config)))
    page.goto('http://127.0.0.1:8768');page.wait_for_selector('.band-column')
    page.locator('#connectBtn').click()
    page.wait_for_function("!document.querySelector('#applyBtn').disabled")
    page.wait_for_timeout(400)
    assert page.evaluate('window.__writes.map(w=>w.bytes)')==[[128,9,0]],'connection must not overwrite EQ'
    assert page.locator('#applyBtn span').inner_text()=='기기에 저장'

    def heard():
        page.wait_for_function("document.querySelector('#applyStatus').textContent==='미리듣기 중 · 저장 전'",timeout=10000)

    def change(index,value):
        page.locator('.band-gain input').nth(index).fill(str(value))

    change(4,2);heard()
    assert page.evaluate('window.__flashCount()')==0
    assert page.evaluate('window.__writes.length')==12 # Tag + 10 bands + RAM
    assert page.evaluate("localStorage.getItem('azla_equalizer_device_state_v1')") is None
    assert page.locator('[data-current-state]').inner_text() == '현재 상태'
    before=page.evaluate('window.__writes.length')
    # Multiple input events within one debounce window send only the latest value.
    page.locator('.band-gain input').nth(4).evaluate("el=>{for(const value of [1,2,3,4]){el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}))}}")
    heard()
    writes=page.evaluate('window.__writes').copy()
    assert len(writes)==before+2 and writes[-1]['bytes']==[1,10,4,0,0,255,255]
    assert writes[-2]['bytes'][4]==4
    assert int.from_bytes(bytes(writes[-2]['bytes'][31:33]),'little',signed=True)==4*256

    # Start a held RAM write, then choose a newer value and immediately save.
    page.evaluate('window.__gateNext=true');change(4,3)
    page.wait_for_function("typeof window.__release==='function'")
    change(4,2.5);page.locator('#applyBtn').click()
    assert page.locator('.gain-slider').first.is_disabled()
    assert page.evaluate('window.__flashCount()')==0
    page.evaluate('window.__release()')
    page.wait_for_function("document.querySelector('#applyStatus').textContent==='설정 전송 완료'",timeout=15000)
    assert page.evaluate('window.__flashCount()')==1
    snapshot=page.evaluate("JSON.parse(localStorage.getItem('azla_equalizer_device_state_v1'))")
    assert snapshot['eq']['gains'][4]==2.5,'save freezes the latest editor snapshot after the RAM barrier'
    writes=page.evaluate('window.__writes')
    assert [w['bytes'][4] for w in writes[-13:-3]]==list(range(10))
    assert writes[-2]['bytes']==[1,1,0] and writes[-1]['bytes']==[128,9,0]
    before=page.evaluate('window.__writes.length')
    page.wait_for_timeout(600)
    assert page.evaluate('window.__writes.length')==before,'no stale preview may follow the saved snapshot'
    print('PASS: no writes on connection; latest RAM-only audition; exact Flash save after in-flight preview; no stale writes')

    change(4,11)
    page.wait_for_selector('#previewRiskBtn:not([hidden])');page.wait_for_timeout(600)
    assert page.evaluate('window.__writes.length')==before
    assert not page.locator('#riskDialog').is_visible(),'slider edits should not repeatedly open modals'
    page.locator('#previewRiskBtn').click()
    assert page.locator('#confirmRiskBtn').inner_text()=='확인 후 미리듣기'
    assert '출력이 강해' in page.locator('.risk-volume-notice').inner_text()
    page.locator('#cancelRiskBtn').click();page.wait_for_timeout(300)
    assert page.evaluate('window.__writes.length')==before
    page.locator('#previewRiskBtn').click();page.locator('#confirmRiskBtn').click();heard()
    assert page.evaluate('window.__flashCount()')==1
    assert page.evaluate("JSON.parse(localStorage.getItem('azla_equalizer_device_state_v1')).eq.gains[4]")==2.5
    change(4,11.1);page.wait_for_timeout(500)
    assert page.locator('#previewRiskBtn').is_visible(),'consent applies to the confirmed EQ values only'
    before=page.evaluate('window.__writes.length')
    # Both audition and save controls remain reachable without scrolling on desktop.
    for width,height in [(1920,1080),(1366,768),(1024,600),(901,600)]:
        page.set_viewport_size({'width':width,'height':height})
        for selector in ['#previewRiskBtn','#applyBtn']:
            box=page.locator(selector).bounding_box()
            assert box['y']>=0 and box['y']+box['height']<=height,(width,height,selector,box)
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth and document.documentElement.scrollHeight<=innerHeight'.replace(' and ',' && '))
    page.set_viewport_size({'width':1366,'height':768})
    page.screenshot(path='docs/screenshots/AZLA-Live-Preview-Confirmation-1366.png')
    page.locator('#applyBtn').click()
    assert page.locator('#confirmRiskBtn').inner_text()=='확인 후 저장'
    assert page.evaluate('window.__writes.length')==before
    page.locator('#cancelRiskBtn').click()
    page.set_viewport_size({'width':390,'height':844})
    page.locator('#previewRiskBtn').scroll_into_view_if_needed()
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.locator('#previewRiskBtn').click()
    dialog=page.locator('#riskDialog').bounding_box()
    assert dialog['x']>=0 and dialog['x']+dialog['width']<=390
    page.locator('#cancelRiskBtn').click()
    page.set_viewport_size({'width':1366,'height':768})
    print('PASS: high-gain automatic audition blocked; separate volume consent and save; Flash audit unchanged; desktop actions visible')

    change(4,3);heard()
    page.screenshot(path='docs/screenshots/AZLA-Live-Preview-1366.png')
    # Failed audition stops pending work and disables saving until reconnect.
    page.evaluate('window.__failNext=true');change(4,2)
    page.wait_for_function("document.querySelector('#applyDetail').textContent.includes('미리듣기를 반영하지 못했습니다')")
    assert page.locator('#applyBtn').is_disabled()
    before=page.evaluate('window.__writes.length')
    change(4,1);page.wait_for_timeout(500)
    assert page.evaluate('window.__writes.length')==before
    assert page.evaluate('window.__flashCount()')==1
    page.locator('#connectBtn').click();page.wait_for_function('!window.__device.opened')
    page.locator('#connectBtn').click();page.wait_for_function("!document.querySelector('#applyBtn').disabled")
    page.wait_for_timeout(400)
    assert page.evaluate('window.__writes.length')==before+1,'reconnect only reads Tag'
    change(4,1.5);heard()
    assert page.evaluate('window.__writes.length')==before+12,'fresh connection refreshes all ten RAM bands'
    assert page.evaluate('window.__flashCount()')==1
    assert not errors,errors
    print('PASS: audition error stops writes and requires reconnect; fresh RAM baseline; no implicit Flash save')
    browser.close()
