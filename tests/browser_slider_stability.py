"""Rendered track follows the thumb; warning changes cannot move desktop sliders."""
import ast
import io
import json
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright

fixture=next(ast.literal_eval(n.value) for n in ast.parse(Path('tests/browser_smoke.py').read_text()).body
             if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='fixture' for t in n.targets))
config={'version':1,'devices':[{'vendorId':4660,'productId':22136,'name':'Synthetic AZLA device'}]}
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    for width,height in [(1920,1080),(1366,768),(1100,720),(901,600)]:
        context=browser.new_context(viewport={'width':width,'height':height},device_scale_factor=1)
        context.add_init_script(fixture)
        page=context.new_page();errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.route('**/device-config.json',lambda route:route.fulfill(content_type='application/json',body=json.dumps(config)))
        page.goto('http://127.0.0.1:8768');page.wait_for_selector('.band-column')
        page.locator('#connectBtn').click();page.wait_for_function("!document.querySelector('#applyBtn').disabled")
        page.locator('#toast').wait_for(state='hidden')
        slider=page.locator('.gain-slider').nth(2)
        slider.scroll_into_view_if_needed()
        rect=slider.bounding_box();footer=page.locator('.apply-bar').bounding_box()
        panel=page.locator('.equalizer-panel').bounding_box()
        for value in [0,11.1,-12,6,-6,12,0]:
            slider.evaluate('(el,v)=>{el.value=v;el.dispatchEvent(new Event("input",{bubbles:true}))}',value)
            page.wait_for_timeout(220)
            now=slider.bounding_box();bar=page.locator('.apply-bar').bounding_box()
            for key in ['x','y','height']:
                assert abs(now[key]-rect[key])<1,(width,value,'slider moved',key,rect,now)
            assert abs(bar['height']-footer['height'])<1,(width,value,'footer resized')
            assert abs(page.locator('.equalizer-panel').bounding_box()['height']-panel['height'])<1
            assert bar['y']+bar['height']<=height
            if value>6:
                assert page.locator('#previewRiskBtn').is_visible()
                for selector in ['#previewRiskBtn','#applyBtn']:
                    assert page.locator(selector).evaluate('el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}'),(width,value,selector)
            # Inspect actual rendered pixels outside the 13px thumb, not a CSS variable.
            image=Image.open(io.BytesIO(page.screenshot())).convert('RGB')
            expected=now['y']+6.5+(now['height']-13)*(12-value)/24
            x=round(now['x']+now['width']/2)
            for delta,orange in [(-11,False),(11,True)]:
                y=round(expected+delta)
                if not now['y']+1<y<now['y']+now['height']-1:continue
                red,green,blue=image.getpixel((x,y))
                assert (red>220 and 45<green<140 and blue<80)==orange,(width,value,delta,(red,green,blue))
        assert not errors,errors
        context.close()
        print('PASS:',width,height,'slider position and footer stable across warning threshold; orange follows thumb')
    browser.close()
