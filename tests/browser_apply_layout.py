"""Keep the desktop EQ apply action visible before and after panel scrolling."""
from pathlib import Path
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    for width,height in [(1920,1080),(1920,900),(1366,768),(1100,720),(1024,600),(901,600)]:
        page=browser.new_page(viewport={'width':width,'height':height})
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto('http://127.0.0.1:8768')
        page.wait_for_selector('.band-column')
        for selector in ['.sidebar .brand','#connectBtn','#createSoundBtn','#viewSavedEqBtn']:
            assert page.locator(selector).evaluate('el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth&&el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}'), selector
        assert page.locator('#connectBtn').evaluate("el=>el.closest('.sidebar').contains(el)&&el.getBoundingClientRect().right<=el.closest('.sidebar').getBoundingClientRect().right&&el.getBoundingClientRect().top>innerHeight/2"), 'connection belongs at bottom left'
        for advanced in [False,True]:
            if advanced:page.locator('#advancedToggle').check()
            for scroll in [False,True]:
                if scroll:
                    page.locator('.equalizer-panel').evaluate('(el)=>el.scrollTop=el.scrollHeight')
                    page.locator('.preset-list').evaluate('(el)=>el.scrollTop=el.scrollHeight')
                result=page.evaluate("""()=>{
                  const b=document.querySelector('#applyBtn'),panel=document.querySelector('.equalizer-panel');
                  const r=b.getBoundingClientRect(),pr=panel.getBoundingClientRect();
                  return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,panelBottom:pr.bottom,
                    panelOverflow:panel.scrollHeight-panel.clientHeight,
                    height:innerHeight,width:innerWidth,scrollHeight:document.documentElement.scrollHeight,
                    scrollWidth:document.documentElement.scrollWidth,
                    clickable:b.contains(document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2))};
                }""")
                assert 0<=result['top']<result['bottom']<=height,(width,height,advanced,scroll,result)
                assert result['panelBottom']<=result['top'],('panel overlaps apply button',result)
                assert result['clickable'],('apply button obscured',result)
                assert page.locator('#saveSoundBtn').is_hidden(), 'factory modes have no change-apply button'
                if height>=768:
                    assert result['panelOverflow']<=1,('unnecessary EQ panel scroll',width,height,advanced,result)
                assert result['scrollWidth']<=width and result['scrollHeight']<=height,(width,height,result)
        if width in [1920,1366]:
            page.locator('#advancedToggle').uncheck()
            page.locator('.equalizer-panel').evaluate('(el)=>el.scrollTop=0')
            page.locator('.preset-list').evaluate('(el)=>el.scrollTop=0')
            page.locator('[data-preset="music-balanced"]').click()
            page.wait_for_timeout(200)
            page.screenshot(path=str(Path('docs/screenshots')/f'AZLA-Vivid-Orange-{width}.png'))
        page.evaluate("""async()=>{
            const {PRESETS}=await import('./src/eq.js');
            const {persistDeviceSnapshot}=await import('./src/storage.js');
            persistDeviceSnapshot(localStorage,{result:'flash-command-transmitted',device:{vendorId:13058,productId:1},eq:PRESETS.find(p=>p.id==='cinema').eq});
        }""")
        page.reload();page.wait_for_selector('.band-column');page.locator('#viewSavedEqBtn').click()
        assert page.locator('#profileName').inner_text()=='기기에 저장한 EQ'
        for advanced in [False,True]:
            page.locator('#advancedToggle').set_checked(advanced)
            assert page.locator('#returnEditBtn').evaluate('e=>{let r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}')
            if height>=768:assert page.locator('.equalizer-panel').evaluate('e=>e.scrollHeight-e.clientHeight<=1'),(width,height,'saved view scroll')
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        page.locator('#returnEditBtn').click();assert page.locator('#profileName').inner_text()=='기본 모드'
        assert not errors,errors
        print('PASS:',width,height,'apply button visible; no overlap or page scrolling; advanced controls accessible')
        page.close()
    page=browser.new_page(viewport={'width':390,'height':844})
    page.goto('http://127.0.0.1:8768');page.wait_for_selector('.band-column')
    assert page.locator('#connectBtn').evaluate('el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.right<=innerWidth&&el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}')
    page.screenshot(path='docs/screenshots/AZLA-Vivid-Orange-Mobile.png',full_page=True)
    page.locator('#applyBtn').scroll_into_view_if_needed()
    assert page.locator('#applyBtn').is_visible() and page.locator('#saveSoundBtn').is_hidden()
    assert page.locator('#createSoundBtn').is_visible() and page.locator('#viewSavedEqBtn').is_visible()
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    print('PASS: mobile controls and apply action remain reachable')
    browser.close()
