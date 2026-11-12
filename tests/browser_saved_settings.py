"""One save action: named library + optional DAC Flash, updates, copy and menu management."""
import ast
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

fixture=next(ast.literal_eval(n.value) for n in ast.parse(Path('tests/browser_smoke.py').read_text()).body
             if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='fixture' for t in n.targets))
fixture+='''
const send=window.__device.sendReport;
window.__device.sendReport=async function(id,data){
 if(window.__failSave){window.__failSave=false;throw new Error('Mock save failure')}
 return send.call(this,id,data);
};
'''
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
    def menu(id,action):
        page.locator(f'[data-sound-id="{id}"]').click();page.locator(f'[data-menu-action="{action}"]').click()
    def new_save(name):
        page.locator('#createSoundBtn').click();page.locator('#soundName').fill(name);page.locator('#soundSubmit').click()
        page.locator('#soundDialog').wait_for(state='hidden')
    def done():page.wait_for_function("document.querySelector('#applyStatus').textContent==='설정 전송 완료'",timeout=15000)
    def heard():page.wait_for_function("document.querySelector('#applyStatus').textContent==='미리듣기 중 · 기기 저장 전'",timeout=10000)
    def connect():
        page.locator('#connectBtn').click();page.wait_for_function("document.querySelector('#connectionLabel').textContent==='USB 연결됨'&&!document.querySelector('#connectBtn').disabled")
    assert page.locator('[data-current-state],#addSoundBtn,#soundOverwrite').count()==0
    assert page.locator('#saveSoundBtn').is_hidden() and page.locator('#createSoundBtn').is_enabled() and page.locator('#applyBtn').is_disabled()
    assert page.locator('#applyBtn span').inner_text()=='EQ 적용'
    page.locator('#viewSavedEqBtn').click();assert page.locator('#returnEditBtn').is_hidden()
    assert '기록이 없습니다' in page.locator('#toast').inner_text()
    assert page.locator('#savedEqDialog').count()==0
    page.locator('#advancedToggle').check()
    page.locator('.band-frequency input').nth(0).fill('70');page.locator('.band-q input').nth(0).fill('0.9')
    page.locator('.band-filter select').nth(0).select_option('3');page.locator('.band-gain input').nth(0).fill('-3')
    saved=values();new_save('나의 영화');first=library()[0]['id']
    assert values()==saved and page.locator('#profileName').inner_text()=='나의 영화'
    assert page.locator('#saveSoundBtn').inner_text()=='변경사항 적용'
    assert page.evaluate('window.__writes.length')==0
    assert page.locator('#applyStatus').inner_text()=='내 사운드에 보관됨'
    page.reload();page.wait_for_selector('.band-column');page.locator(f'[data-sound="{first}"]').click()
    assert values()==saved and page.evaluate('window.__writes.length')==0
    # Updating a saved sound takes one click and never asks for its name again.
    page.locator('.band-gain input').nth(0).fill('2')
    assert page.locator('#profileName').inner_text()=='나의 영화'
    page.locator('#saveSoundBtn').click();assert not page.locator('#soundDialog').is_visible()
    assert len(library())==1 and library()[0]['eq']['gains'][0]==2
    updated=values()
    # Rename via ⋯ preserves EQ and performs no hardware write.
    menu(first,'rename');page.locator('#soundName').fill('<b>밤 모드</b>');page.locator('#soundSubmit').click()
    assert library()[0]['eq']['gains'][0]==2 and page.locator('.user-sound b').count()==0
    assert page.locator('#profileName').inner_text()=='<b>밤 모드</b>' and page.evaluate('window.__writes.length')==0
    # Save-as-new copies the edited EQ while preserving the original record.
    page.locator('.band-gain input').nth(0).fill('1.5');menu(first,'copy')
    page.locator('#soundName').fill('두 번째');page.locator('#soundSubmit').click();page.locator('#soundDialog').wait_for(state='hidden')
    second=library()[1]['id'];assert library()[0]['eq']['gains'][0]==2 and library()[1]['eq']['gains'][0]==1.5
    assert page.locator('[data-preset="cinema"]').evaluate('(e)=>e.nextElementSibling.querySelector("[data-sound]")!==null')
    # Duplicate names are rejected without overwriting a different sound.
    menu(second,'rename');page.locator('#soundName').fill('<b>밤 모드</b>');page.locator('#soundSubmit').click()
    assert '이미 사용' in page.locator('#soundFormError').inner_text();page.locator('#cancelSoundBtn').click()
    connect();assert flashes()==0
    # Sound storage remains local even with a connected DAC; EQ application is explicit.
    page.locator('#saveSoundBtn').click();assert flashes()==0
    page.locator('#applyBtn').click();assert page.locator('#saveSoundBtn').is_disabled();done();assert flashes()==1
    # First save from a factory mode asks only for a name, then writes Flash once.
    page.locator('[data-preset="cinema"]').click();heard();page.locator('#createSoundBtn').click()
    assert 'EQ 적용' in page.locator('#soundDialogHelp').inner_text()
    assert flashes()==1;page.locator('#cancelSoundBtn').click();assert flashes()==1
    new_save('연결 저장');assert flashes()==1 and len(library())==3
    page.locator('#applyBtn').click();done();assert flashes()==2
    third=library()[2]['id']
    # The read-only viewer shows actual last Flash evidence, unaffected by RAM edits.
    stored_record=page.evaluate("JSON.parse(localStorage.getItem('azla_equalizer_device_state_v1'))")
    page.locator('.band-gain input').nth(0).fill('2.7');heard();before_view=values()
    writes_before=page.evaluate('window.__writes.length')
    dirty_curve=page.locator('#responseChart').evaluate('e=>e.toDataURL()')
    page.locator('#viewSavedEqBtn').click()
    assert page.locator('#savedEqDialog').count()==0,'saved EQ uses the main editor layout'
    assert page.locator('#profileName').inner_text()=='기기에 저장한 EQ'
    assert page.locator('#viewSavedEqBtn').get_attribute('aria-pressed')=='true'
    for field,selector in [('freqs','.band-frequency input'),('gains','.band-gain input'),('qs','.band-q input'),('filterTypes','.band-filter select')]:
        actual=page.locator(selector).evaluate_all('(els)=>els.map(e=>Number(e.value))')
        assert actual==stored_record['eq'][field],(field,actual,stored_record['eq'][field])
    assert page.locator('#bandControls input:enabled,#bandControls select:enabled').count()==0
    assert page.locator('#applyBtn').is_disabled() and page.locator('#createSoundBtn').is_disabled()
    assert page.locator('#saveSoundBtn').is_hidden() and page.locator('#resetBtn').is_hidden()
    assert '다른 프로그램' in page.locator('#applyDetail').inner_text()
    page.wait_for_timeout(250)
    assert page.locator('#responseChart').evaluate('e=>e.toDataURL()')!=dirty_curve,'graph must show the saved response'
    frozen=values();rect=page.locator('#responseChart').bounding_box()
    page.mouse.move(rect['x']+rect['width']*.47,rect['y']+rect['height']*.55)
    page.mouse.down();page.mouse.move(rect['x']+rect['width']*.5,rect['y']+20);page.mouse.up()
    page.locator('#advancedToggle').uncheck();page.locator('#advancedToggle').check()
    assert values()==frozen and page.evaluate('window.__writes.length')==writes_before
    page.locator('#returnEditBtn').click()
    assert values()==before_view and page.evaluate('window.__writes.length')==writes_before and flashes()==2
    assert page.locator('#profileName').inner_text()=='연결 저장'
    assert page.locator('#bandControls input:disabled,#bandControls select:disabled').count()==0
    page.evaluate('window.__device.productId=33333');page.locator('#viewSavedEqBtn').click()
    assert page.locator('#returnEditBtn').is_hidden() and '연결한 기기' in page.locator('#toast').inner_text()
    page.evaluate('window.__device.productId=22136')
    # A blocked local write must leave records unchanged and never start Flash.
    page.evaluate("()=>{window.__realSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('blocked','QuotaExceededError')}}")
    page.locator('.band-gain input').nth(0).fill('1');heard();page.locator('#saveSoundBtn').click()
    assert '저장 공간' in page.locator('#toast').inner_text() and flashes()==2 and library()[2]['eq']['gains'][0]!=1
    page.locator('#applyBtn').click();done();assert flashes()==3,'DAC apply works even if browser storage is denied'
    assert library()[2]['eq']['gains'][0]!=1,'EQ apply must not overwrite a named sound'
    page.evaluate('()=>{Storage.prototype.setItem=window.__realSetItem}')
    # USB failure retains the local copy and makes the partial result explicit.
    page.evaluate('window.__failSave=true');page.locator('#applyBtn').click()
    page.wait_for_function("document.querySelector('#applyDetail').textContent.includes('기기 적용을 확인하지 못했습니다')",timeout=15000)
    assert library()[2]['eq']['gains'][0]!=1 and flashes()==3 and page.locator('#applyBtn').is_disabled()
    assert page.locator('#saveSoundBtn').is_enabled()
    page.locator('#saveSoundBtn').click();assert library()[2]['eq']['gains'][0]==1 and flashes()==3
    page.locator('#connectBtn').click();page.wait_for_function('!window.__device.opened');connect()
    page.locator('#applyBtn').click();done();assert flashes()==4,'explicit retry after reconnection'
    # Menu deletion is isolated from both editor values and DAC Flash.
    before=values();menu(third,'delete');page.locator('#cancelDeleteSoundBtn').click();assert len(library())==3
    menu(third,'delete');page.locator('#deleteSoundForm button[type="submit"]').click()
    assert values()==before and flashes()==4 and len(library())==2
    page.reload();page.wait_for_selector('.band-column');assert page.locator('[data-sound]').count()==2
    page.locator('#viewSavedEqBtn').click();assert page.locator('#profileName').inner_text()=='기기에 저장한 EQ'
    assert page.locator('.band-gain input').first.input_value()=='1'
    assert page.evaluate('window.__writes.length')==0
    # Connecting a device with a different stored identity exits the read-only view.
    connect()
    assert page.locator('#returnEditBtn').is_hidden() and '설정이 저장 기록과 달라' in page.locator('#toast').inner_text()
    assert page.evaluate('window.__writes.map(w=>w.bytes)')==[[128,9,0]],'view/return during connect must not audition the editor'
    page.locator('#viewSavedEqBtn').click();assert '설정이 저장 기록과 달라' in page.locator('#toast').inner_text()
    page.locator('#connectBtn').click();page.wait_for_function('!window.__device.opened')
    before_copy=values();before_copy_writes=page.evaluate('window.__writes.length');menu(first,'copy');page.locator('#soundName').fill('원본 보관 복사');page.locator('#soundSubmit').click()
    page.locator('#soundDialog').wait_for(state='hidden')
    assert values()==before_copy and library()[-1]['eq']['gains'][0]==2,'copying an unselected sound must not change the editor'
    assert page.evaluate('window.__writes.length')==before_copy_writes
    for i in range(7):
        page.locator('[data-preset="flat"]').click();new_save(f'추가 사운드 {i+1}')
    assert page.locator('.preset-list').evaluate('e=>e.scrollHeight>e.clientHeight')
    assert page.locator('#connectBtn').evaluate('e=>{let r=e.getBoundingClientRect();return r.bottom<=innerHeight&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}')
    assert page.locator('.equalizer-panel').evaluate('e=>e.scrollHeight-e.clientHeight<=1')
    for selector in ['#createSoundBtn','#viewSavedEqBtn','#saveSoundBtn','#applyBtn']:
        assert page.locator(selector).evaluate('e=>{let r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}'),selector
    # Popover stays inside the viewport even for the lowest list item.
    last=library()[-1]['id'];page.locator(f'[data-sound-id="{last}"]').click()
    assert page.locator('#soundMenu').evaluate('e=>{let r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth}')
    page.keyboard.press('ArrowDown');assert page.locator('[data-menu-action="copy"]').evaluate('e=>e===document.activeElement')
    page.keyboard.press('Escape')
    page.set_viewport_size({'width':390,'height':844});menu(last,'rename')
    assert page.locator('#soundName').is_visible();page.locator('#cancelSoundBtn').click()
    page.locator('#viewSavedEqBtn').click();assert page.locator('#profileName').inner_text()=='기기에 저장한 EQ'
    assert page.locator('#returnEditBtn').is_visible() and page.locator('.band-column').count()==10
    page.locator('#returnEditBtn').click()
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert not errors,errors
    print('PASS: sidebar creation, conditional change application, independent DAC saves; main graph/sliders show frozen last Flash data; edits restored exactly; no USB writes on viewing/return/connection; no inferred settings for missing/mismatched records; menu, scrolling and mobile access')
    browser.close()
