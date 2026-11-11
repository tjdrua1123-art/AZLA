"""Saved settings must survive previews and reloads; loading never saves Flash."""
import ast
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

fixture=next(ast.literal_eval(n.value) for n in ast.parse(Path('tests/browser_smoke.py').read_text()).body
             if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='fixture' for t in n.targets))
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':1366,'height':900});context.add_init_script(fixture)
    page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    config={'version':1,'devices':[{'vendorId':4660,'productId':pid} for pid in [22136,33333]]}
    page.route('**/device-config.json',lambda r:r.fulfill(content_type='application/json',body=json.dumps(config)))
    page.goto('http://127.0.0.1:8768');page.wait_for_selector('.band-column')
    def connect():
        page.locator('#connectBtn').click();page.wait_for_function("!document.querySelector('#applyBtn').disabled")
    def values():
        return page.locator('#bandControls input,#bandControls select').evaluate_all('(els)=>els.map(el=>el.value)')
    def flashes():
        return page.evaluate("window.__writes.filter(w=>w.bytes.join(',')==='1,1,0').length")
    def idle():
        page.wait_for_function("!document.querySelector('#applyStatus').textContent.includes('반영 중')",timeout=10000)
    connect()
    page.locator('.band-gain input').nth(4).fill('2');page.wait_for_timeout(2000);idle()
    before=values();page.locator('[data-current-state]').click()
    assert values()==before and flashes()==0
    assert '저장한 설정이 없습니다' in page.locator('#toast').inner_text()
    assert page.locator('#profileName').inner_text()=='직접 조절','a known device mode must not impersonate a saved snapshot'
    page.locator('#advancedToggle').check()
    page.locator('.band-frequency input').nth(0).fill('70')
    page.locator('.band-q input').nth(0).fill('0.9')
    page.locator('.band-gain input').nth(0).fill('-3')
    saved=values();page.locator('#applyBtn').click()
    page.wait_for_function("document.querySelector('#applyStatus').textContent==='설정 전송 완료'",timeout=15000)
    record=page.evaluate("localStorage.getItem('azla_equalizer_device_state_v1')")
    assert flashes()==1
    for mode in ['cinema','flat']:
        page.locator(f'[data-preset="{mode}"]').click()
        page.wait_for_function("document.querySelector('#applyStatus').textContent==='미리듣기 중 · 저장 전'",timeout=10000)
        assert values()!=saved
        page.locator('[data-current-state]').click()
        assert page.locator('#profileName').inner_text()=='저장된 설정'
        assert values()==saved,'load must restore all saved bands and Q values, not the current RAM preview'
        page.wait_for_timeout(2000);idle()
        assert flashes()==1 and page.evaluate("localStorage.getItem('azla_equalizer_device_state_v1')")==record
    page.reload();page.wait_for_selector('.band-column')
    page.locator('[data-current-state]').click()
    assert values()==saved and page.evaluate('window.__writes.length')==0
    connect();page.locator('[data-preset="flat"]').click()
    page.wait_for_function("document.querySelector('#applyStatus').textContent==='미리듣기 중 · 저장 전'",timeout=10000)
    page.locator('[data-current-state]').click();assert values()==saved
    page.wait_for_timeout(2000);idle();assert flashes()==0,'loading after reload must not write Flash'
    page.locator('#connectBtn').click();page.wait_for_function('!window.__device.opened')
    page.evaluate('window.__device.productId=33333');connect()
    page.locator('.band-gain input').nth(0).fill('-1');before=values()
    page.locator('[data-current-state]').click()
    assert values()==before and '이 기기에 저장한 설정이 없습니다' in page.locator('#toast').inner_text()
    assert flashes()==0
    assert not errors,errors
    print('PASS: no inferred mode as saved EQ; last explicit save restored after RAM edits and reload; no automatic Flash; device mismatch blocked')
    browser.close()
