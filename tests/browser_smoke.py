"""Functional browser checks. Requires Python Playwright and system Chromium.
Only HID is mocked. The browser loads the bundled, unmodified manufacturer SDK.
Run while `node server.mjs` is serving the project.
"""
import json
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:8768'
legacy_saves = """
localStorage.setItem('azla_equalizer_v4', JSON.stringify({
  advanced:false, selected:'user:old', current:{gains:[12]},
  presets:[{name:'삭제될 사용자 사운드'}]
}));
localStorage.setItem('azla_equalizer_v3', JSON.stringify({presets:[{name:'이전 저장'}]}));
localStorage.setItem('azla_cb5100_presets_v1', JSON.stringify({'구버전 저장':{}}));
"""
fixture = """
window.__writes = [];
window.__deviceTag = 13;
window.__deviceListeners = new Map();
window.__device = {
  vendorId:4660,productId:22136,productName:'Synthetic AZLA device',opened:false,
  async open(){this.opened=true}, async close(){this.opened=false},
  addEventListener(name,fn){if(!window.__deviceListeners.has(name))window.__deviceListeners.set(name,new Set());window.__deviceListeners.get(name).add(fn)},
  removeEventListener(name,fn){window.__deviceListeners.get(name)?.delete(fn)},
  async sendReport(id,data){
    const bytes=[...data];window.__writes.push({id,bytes});
    if(bytes[0]===1&&bytes[1]===9&&bytes.length===36)window.__deviceTag=bytes[35];
    if(bytes.join(',')==='128,9,0'){
      const response=new Uint8Array(36);response[1]=9;response[35]=window.__deviceTag;
      queueMicrotask(()=>{for(const fn of window.__deviceListeners.get('inputreport')||[])fn({device:this,data:new DataView(response.buffer)})});
    }
  }
};
Object.defineProperty(navigator,'hid',{value:{
  addEventListener(){}, async requestDevice(){return [window.__device]}
}});
"""

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width':1440,'height':1000}, device_scale_factor=1)
    context.add_init_script(legacy_saves)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(BASE)
    page.wait_for_selector('.band-column')
    assert page.locator('.band-column').count() == 10
    assert page.locator('.topbar, #settingsBtn, .sidebar-footer').count() == 0
    assert page.locator('[data-preset]').count() == 5
    assert page.locator('[data-preset] .preset-name').all_text_contents() == ['기본 모드','FPS 모드','음악 보컬','음악 밸런스','영화']
    assert page.locator('.band-filter select').first.locator('option[value="3"]').inner_text() == 'HIGH SHELF'
    assert page.locator('[data-current-state]').count() == 1
    assert page.locator('[data-current-state]').inner_text().startswith('저장된 설정')
    assert page.locator('#profileName').inner_text() == '기본 모드'
    assert page.locator('[data-preset="flat"]').get_attribute('aria-pressed') == 'true'
    assert page.locator('#profileBadge').count() == 0
    for selector in ['#savePresetBtn','#saveDialog','#importBtn','#exportBtn','#importInput']:
        assert page.locator(selector).count() == 0, selector
    assert page.locator('text=삭제될 사용자 사운드').count() == 0
    for key in ['azla_equalizer_v4','azla_equalizer_v3','azla_cb5100_presets_v1']:
        assert page.evaluate('(key)=>localStorage.getItem(key)', key) is None
    assert all(v == '1.4' for v in page.locator('.band-q input').evaluate_all('(els)=>els.map(x=>x.value)'))
    assert page.locator('#applyBtn').is_disabled()
    assert page.locator('.band-frequency input').evaluate_all('(els)=>els.map(x=>Number(x.value))') == [32,63,125,250,500,1000,2000,4000,8000,16000]
    page.locator('[data-preset="fps"]').click()
    assert page.locator('#profileName').inner_text() == 'FPS 모드'
    assert page.locator('.band-frequency input').nth(4).input_value() == '500'
    assert page.locator('.band-frequency input').evaluate_all('(els)=>els.map(x=>Number(x.value))') == [31,62,125,250,500,1000,2000,4000,8000,16000]
    gain = page.locator('.band-gain input').nth(4)
    gain.fill('2.5')
    gain.press('Tab')
    assert page.locator('#profileName').inner_text() == '직접 조절'
    assert page.locator('.gain-slider').nth(4).input_value() == '2.5'
    page.locator('#resetBtn').click()
    assert page.locator('#profileName').inner_text() == 'FPS 모드'
    assert page.locator('.band-gain input').nth(4).input_value() == '5'
    page.locator('#advancedToggle').check()
    q = page.locator('.band-q input').nth(0)
    q.fill('1.13'); q.press('Tab')
    assert q.input_value() == '1.13'
    page.reload(); page.wait_for_selector('.band-column')
    assert page.locator('#profileName').inner_text() == '기본 모드'
    assert page.locator('#advancedToggle').is_checked()
    assert all(v == '0' for v in page.locator('.band-gain input').evaluate_all('(els)=>els.map(x=>x.value)'))
    assert all(v == '1.4' for v in page.locator('.band-q input').evaluate_all('(els)=>els.map(x=>x.value)'))
    page.evaluate("document.querySelector('#settingsDialog').showModal()")
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
    print('PASS: five modes, requested bands, manual reset, removed user saves, 기본 모드 restart, Q input, REW comparison')
    context.close()

    context = browser.new_context(viewport={'width':1440,'height':1000})
    context.add_init_script(fixture)
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('**/device-config.json', lambda route: route.fulfill(content_type='application/json',body=json.dumps({'version':1,'devices':[{'vendorId':4660,'productId':22136,'name':'Synthetic AZLA device'}]})))
    page.goto(BASE); page.wait_for_selector('.band-column')
    page.locator('#connectBtn').click()
    page.wait_for_function("!document.querySelector('#applyBtn').disabled")
    assert page.locator('[data-current-state]').inner_text().startswith('저장된 설정')
    assert page.locator('[data-current-state]').inner_text() == '저장된 설정'
    assert page.evaluate('window.__writes.map(x=>x.bytes)') == [[128,9,0]]
    page.locator('[data-preset="fps"]').click()
    page.locator('#applyBtn').click()
    assert not page.locator('#riskDialog').is_visible(), 'FPS preset must apply without a warning'
    assert page.locator('#connectBtn').is_disabled()
    assert page.locator('.gain-slider').nth(0).is_disabled()
    page.wait_for_function("document.querySelector('#applyStatus').textContent==='설정 전송 완료'", timeout=15000)
    writes = page.evaluate('window.__writes')
    mutation_writes = [w for w in writes if w['bytes'] != [128,9,0]]
    assert len(writes) == 14
    assert len(mutation_writes) == 12
    assert [w['bytes'][4] for w in mutation_writes[:10]] == list(range(10))
    assert mutation_writes[-1]['bytes'] == [1,1,0]
    assert page.locator('[data-current-state]').inner_text() == '저장된 설정'
    assert page.evaluate("localStorage.getItem('azla_equalizer_device_state_v1')") is not None
    page.locator('[data-preset="flat"]').click()
    page.wait_for_function("document.querySelector('#applyStatus').textContent==='미리듣기 중 · 저장 전'", timeout=10000)
    page.locator('[data-current-state]').click()
    assert page.locator('#profileName').inner_text() == '저장된 설정'
    assert page.locator('.band-gain input').nth(0).input_value() == '0'
    page.locator('.band-gain input').nth(0).fill('-1')
    page.locator('.band-gain input').nth(0).press('Tab')
    page.wait_for_function("document.querySelector('#applyStatus').textContent==='미리듣기 중 · 저장 전'", timeout=10000)
    assert page.evaluate("window.__writes.filter(w=>w.bytes.join(',')==='1,1,0').length") == 1
    for mode in ['flat','vocal','music-balanced','cinema']:
        page.locator(f'[data-preset="{mode}"]').click()
        page.wait_for_function("document.querySelector('#applyStatus').textContent==='미리듣기 중 · 저장 전'", timeout=10000)
        page.locator('#applyBtn').click()
        assert not page.locator('#riskDialog').is_visible(), f'{mode} must apply without a warning'
        page.wait_for_function("document.querySelector('#applyStatus').textContent==='설정 전송 완료'", timeout=15000)
    # Summed gain is informational; manual boosts preview and save without a modal.
    page.locator('[data-preset="flat"]').click()
    gain = page.locator('.band-gain input').nth(4)
    gain.fill('12'); gain.press('Tab')
    page.wait_for_function("document.querySelector('#applyStatus').textContent==='미리듣기 중 · 저장 전'", timeout=10000)
    assert page.locator('#riskDialog').count() == 0
    page.locator('#applyBtn').click()
    page.wait_for_function("document.querySelector('#applyStatus').textContent==='설정 전송 완료'", timeout=15000)
    assert page.locator('.volume-guidance').is_visible()
    assert not errors, errors
    print('PASS: all five presets apply without clipping warnings; manual boosts preview and save without a summed-gain gate')
    print('PASS: browser original SDK + mock HID Tag read, current-state snapshot, 10 EQ + RAM + Flash, UI lock, edited state')
    context.close()
    context = browser.new_context(viewport={'width':1366,'height':768})
    context.add_init_script(fixture.replace('vendorId:4660', 'vendorId:13058'))
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(BASE); page.wait_for_selector('.band-column')
    page.evaluate("document.querySelector('#settingsDialog').showModal()")
    page.locator('#inspectDeviceBtn').click()
    page.wait_for_function("document.querySelector('#discoveredDevice').textContent.includes('0x3302')")
    assert page.evaluate('window.__writes.length') == 0
    assert page.evaluate('window.__device.opened') is False
    page.locator('#closeSettingsBtn').click()
    assert page.locator('#applyBtn').is_disabled()
    assert not errors, errors
    print('PASS: supplied manufacturer search method reads VID/PID without opening, writing, or authorizing apply')
    browser.close()
