"""Functional browser checks. Requires Python Playwright and system Chromium.
Only HID is mocked. The browser loads the bundled, unmodified manufacturer SDK.
Run while `node server.mjs` is serving the project.
"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:8768'
OUT = Path('/tmp/azla-browser')
OUT.mkdir(exist_ok=True)
fixture = """
window.__writes = [];
window.__device = {
  vendorId:4660,productId:22136,productName:'Synthetic AZLA device',opened:false,
  async open(){this.opened=true}, async close(){this.opened=false},
  async sendReport(id,bytes){window.__writes.push({id,bytes:[...bytes]})}
};
Object.defineProperty(navigator,'hid',{value:{
  addEventListener(){}, async requestDevice(){return [window.__device]}
}});
"""

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width':1440,'height':1000}, device_scale_factor=1)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(BASE)
    page.wait_for_selector('.band-column')
    assert page.locator('.band-column').count() == 10
    assert page.locator('[data-preset]').count() == 8
    assert page.locator('#applyBtn').is_disabled()
    page.locator('[data-preset="fps-competitive"]').click()
    assert page.locator('#profileName').inner_text() == 'FPS 경쟁전'
    assert page.locator('.band-frequency input').nth(4).input_value() == '850'
    gain = page.locator('.band-gain input').nth(4)
    gain.fill('2.5')
    gain.press('Tab')
    assert page.locator('#profileName').inner_text() == '사용자 설정'
    assert page.locator('.gain-slider').nth(4).input_value() == '2.5'
    page.locator('#advancedToggle').check()
    q = page.locator('.band-q input').nth(0)
    q.fill('1.13'); q.press('Tab')
    assert q.input_value() == '1.13'
    page.locator('#savePresetBtn').click()
    page.locator('#presetName').fill('청음 테스트')
    page.locator('#saveForm button[type="submit"]').click()
    assert page.locator('[data-preset]').count() == 9
    page.reload(); page.wait_for_selector('.band-column')
    assert page.locator('#profileName').inner_text() == '청음 테스트'
    assert page.locator('.band-q input').nth(0).input_value() == '1.13'
    with page.expect_download() as event:
        page.locator('#exportBtn').click()
    download = event.value
    backup_path = OUT / 'backup.json'; download.save_as(backup_path)
    data = json.loads(backup_path.read_text())
    assert data['format'] == 'azla-equalizer-v3'
    assert data['current']['gains'][4] == 2.5
    assert len(data['presets']) == 1
    page.locator('#importInput').set_input_files({'name':'invalid.json','mimeType':'application/json','buffer':b'{"format":"wrong"}'})
    page.wait_for_function("document.querySelector('#toast').textContent.includes('가져오기 실패')")
    page.locator('#flatBtn').click()
    assert all(v == '0' for v in page.locator('.band-gain input').evaluate_all('(els)=>els.map(x=>x.value)'))
    page.locator('#settingsBtn').click()
    assert 'SDK' in page.locator('#sdkStatus').inner_text()
    off = '\n'.join(f'{f} 100' for f in [20,50,100,200,500,1000,2000,5000,10000,20000])
    on = '\n'.join(f'{f} 102' for f in [20,50,100,200,500,1000,2000,5000,10000,20000])
    for id_, text in [('rewOffInput',off),('rewOnInput',on)]:
        page.locator('#'+id_).set_input_files({'name':id_+'.txt','mimeType':'text/plain','buffer':text.encode()})
    page.wait_for_function("document.querySelector('#rewSummary').textContent.includes('2.00')")
    assert page.locator('#comparisonRows tr').count() == 10
    page.locator('#closeSettingsBtn').click()
    page.locator('#flatBtn').click()
    assert not errors, errors
    print('PASS: offline UI, 10 bands, preset editing, Q input, local restore, export, invalid import, FLAT, REW comparison')
    context.close()

    context = browser.new_context(viewport={'width':1440,'height':1000})
    context.add_init_script(fixture)
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('**/device-config.json', lambda route: route.fulfill(content_type='application/json',body=json.dumps({'version':1,'devices':[{'vendorId':4660,'productId':22136,'name':'Synthetic AZLA device'}]})))
    page.goto(BASE); page.wait_for_selector('.band-column')
    page.locator('#connectBtn').click()
    page.wait_for_function("!document.querySelector('#applyBtn').disabled")
    page.locator('[data-preset="flat"]').click()
    assert page.evaluate('window.__writes.length') == 0
    page.locator('#applyBtn').click()
    assert page.locator('#connectBtn').is_disabled()
    assert page.locator('.gain-slider').nth(0).is_disabled()
    page.wait_for_function("document.querySelector('#applyStatus').textContent==='Flash 저장 명령 전송 완료'", timeout=15000)
    writes = page.evaluate('window.__writes')
    assert len(writes) == 12
    assert [w['bytes'][4] for w in writes[:10]] == list(range(10))
    assert writes[-1]['bytes'] == [1,1,0]
    page.locator('.band-gain input').nth(0).fill('-1')
    page.locator('.band-gain input').nth(0).press('Tab')
    assert len(page.evaluate('window.__writes')) == 12
    assert page.locator('#applyStatus').inner_text() == '적용할 준비가 되었습니다'
    assert not errors, errors
    print('PASS: browser original SDK + mock HID apply 10 EQ + RAM + Flash, UI lock, no automatic writes, edited state')
    context.close()
    context = browser.new_context(viewport={'width':1366,'height':768})
    context.add_init_script(fixture.replace('vendorId:4660', 'vendorId:13058'))
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(BASE); page.wait_for_selector('.band-column')
    page.locator('#settingsBtn').click()
    page.locator('#inspectDeviceBtn').click()
    page.wait_for_function("document.querySelector('#discoveredDevice').textContent.includes('0x3302')")
    assert page.evaluate('window.__writes.length') == 0
    assert page.evaluate('window.__device.opened') is False
    page.locator('#closeSettingsBtn').click()
    assert page.locator('#applyBtn').is_disabled()
    assert not errors, errors
    print('PASS: supplied manufacturer search method reads VID/PID without opening, writing, or authorizing apply')
    browser.close()
