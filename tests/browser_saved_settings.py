"""Named sounds: full EQ persistence, rename/overwrite/delete and RAM/Flash separation."""
import ast
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

fixture=next(ast.literal_eval(n.value) for n in ast.parse(Path('tests/browser_smoke.py').read_text()).body
             if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='fixture' for t in n.targets))
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':1366,'height':768});context.add_init_script(fixture)
    page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    config={'version':1,'devices':[{'vendorId':4660,'productId':22136}]}
    page.route('**/device-config.json',lambda r:r.fulfill(content_type='application/json',body=json.dumps(config)))
    page.goto('http://127.0.0.1:8768');page.wait_for_selector('.band-column')
    def values():return page.locator('#bandControls input,#bandControls select').evaluate_all('(els)=>els.map(el=>el.value)')
    def flashes():return page.evaluate("window.__writes.filter(w=>w.bytes.join(',')==='1,1,0').length")
    def library():return page.evaluate("JSON.parse(localStorage.getItem('azla_equalizer_sounds_v1')).sounds")
    def heard():page.wait_for_function("document.querySelector('#applyStatus').textContent==='미리듣기 중 · 저장 전'",timeout=10000)
    def add(name):
        page.locator('#addSoundBtn').click();page.locator('#soundName').fill(name);page.locator('#soundSubmit').click()
        page.locator('#soundDialog').wait_for(state='hidden')
    assert page.locator('[data-current-state]').count()==0
    assert page.locator('[data-preset]').count()==5
    page.locator('#advancedToggle').check()
    page.locator('.band-frequency input').nth(0).fill('70')
    page.locator('.band-q input').nth(0).fill('0.9')
    page.locator('.band-filter select').nth(0).select_option('3')
    page.locator('.band-gain input').nth(0).fill('-3')
    saved=values();add('나의 영화');first=library()[0]['id']
    assert page.locator('#profileName').inner_text()=='나의 영화'
    assert page.evaluate("[...document.querySelector('#presetList').children].map(e=>e.dataset.preset||e.querySelector('[data-sound]')?.dataset.sound)")[-2:]==['cinema',first]
    assert page.evaluate('window.__writes.length')==0,'local addition must not connect to or write a DAC'
    page.reload();page.wait_for_selector('.band-column')
    assert page.locator('#profileName').inner_text()=='기본 모드'
    page.locator(f'[data-sound="{first}"]').click();assert values()==saved
    assert page.evaluate('window.__writes.length')==0
    page.locator('#connectBtn').click();page.wait_for_function("!document.querySelector('#applyBtn').disabled")
    page.locator('[data-preset="flat"]').click();heard()
    page.locator(f'[data-sound="{first}"]').click();heard();assert values()==saved and flashes()==0
    # Renaming must preserve the stored EQ even when the editor holds other values.
    page.locator('.band-gain input').nth(0).fill('2');heard()
    page.locator('[data-sound-action="edit"]').first.click()
    assert not page.locator('#soundOverwrite').is_checked()
    page.locator('#soundName').fill('<b>밤 모드</b>');page.locator('#soundSubmit').click()
    page.locator('#soundDialog').wait_for(state='hidden')
    assert library()[0]['eq']['gains'][0]==-3
    assert page.locator('.user-sound b').count()==0,'user names must be plain text'
    page.locator(f'[data-sound="{first}"]').click();heard();assert values()==saved
    # Explicit overwrite replaces EQ, not just the display name.
    page.locator('.band-gain input').nth(0).fill('1.5');heard();updated=values()
    page.locator('[data-sound-action="edit"]').first.click();page.locator('#soundOverwrite').check()
    page.locator('#soundSubmit').click();page.locator('#soundDialog').wait_for(state='hidden')
    assert library()[0]['eq']['gains'][0]==1.5 and flashes()==0
    page.locator('[data-preset="cinema"]').click();heard();add('두 번째');second=library()[1]['id']
    page.locator('#addSoundBtn').click();page.locator('#soundName').fill('두 번째');page.locator('#soundSubmit').click()
    assert '이미 사용' in page.locator('#soundFormError').inner_text() and len(library())==2
    page.locator('#cancelSoundBtn').click()
    # Storage refusal must leave both the list and the existing record intact.
    page.evaluate("()=>{window.__realSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('blocked','QuotaExceededError')}}")
    page.locator('#addSoundBtn').click();page.locator('#soundName').fill('저장 불가');page.locator('#soundSubmit').click()
    assert '저장 공간' in page.locator('#soundFormError').inner_text() and page.locator('[data-sound]').count()==2
    page.locator('#cancelSoundBtn').click();page.evaluate('()=>{Storage.prototype.setItem=window.__realSetItem}')
    page.locator(f'[data-sound="{first}"]').click();heard();assert values()==updated
    page.locator('#applyBtn').click()
    assert page.locator('#addSoundBtn').is_disabled() and page.locator('[data-sound-action="edit"]').first.is_disabled()
    page.wait_for_function("document.querySelector('#applyStatus').textContent==='설정 전송 완료'",timeout=15000)
    assert flashes()==1,'only the explicit device-save action writes Flash'
    page.locator(f'[data-sound-action="delete"][data-sound-id="{first}"]').click();page.locator('#cancelDeleteSoundBtn').click()
    assert len(library())==2
    page.locator(f'[data-sound-action="delete"][data-sound-id="{first}"]').click()
    page.locator('#deleteSoundForm button[type="submit"]').click();page.locator('#deleteSoundDialog').wait_for(state='hidden')
    assert values()==updated and flashes()==1 and page.locator('#profileName').inner_text()=='직접 조절'
    assert len(library())==1
    page.reload();page.wait_for_selector('.band-column');assert page.locator('[data-sound]').count()==1
    assert page.locator(f'[data-sound="{first}"]').count()==0
    for i in range(8):add(f'추가 사운드 {i+1}')
    assert page.locator('#connectBtn').evaluate('e=>{let r=e.getBoundingClientRect();return r.bottom<=innerHeight&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}')
    assert page.locator('.preset-list').evaluate('e=>e.scrollHeight>e.clientHeight')
    assert page.locator('.equalizer-panel').evaluate('e=>e.scrollHeight-e.clientHeight<=1')
    page.locator(f'[data-sound="{second}"]').click()
    page.locator('[data-sound-action="edit"]').first.click();page.screenshot(path='/workspace/work/named-sound-dialog.png')
    page.locator('#cancelSoundBtn').click();page.locator('.preset-list').evaluate('e=>e.scrollTop=0')
    page.screenshot(path='/workspace/work/named-sounds-desktop.png')
    page.set_viewport_size({'width':390,'height':844});page.locator('#addSoundBtn').click()
    assert page.locator('#soundName').is_visible();page.locator('#cancelSoundBtn').click()
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path='/workspace/work/named-sounds-mobile.png',full_page=True)
    assert not errors,errors
    print('PASS: named EQ add/load/rename/overwrite/delete; reload and full-band isolation; duplicate and storage failure; RAM-only loading; explicit Flash; scroll and mobile access')
    browser.close()
