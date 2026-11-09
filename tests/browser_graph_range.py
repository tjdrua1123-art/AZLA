"""Graph clipping regression. Run with server.mjs serving on port 8768."""
from pathlib import Path
from playwright.sync_api import sync_playwright

capture = """
const proto=CanvasRenderingContext2D.prototype;
const begin=proto.beginPath,move=proto.moveTo,line=proto.lineTo,stroke=proto.stroke,clear=proto.clearRect,text=proto.fillText;
proto.beginPath=function(...args){this.__points=[];return begin.apply(this,args)};
proto.moveTo=function(x,y){this.__points?.push([x,y]);return move.call(this,x,y)};
proto.lineTo=function(x,y){this.__points?.push([x,y]);return line.call(this,x,y)};
proto.clearRect=function(...args){window.__axes=[];window.__curve=[];return clear.apply(this,args)};
proto.fillText=function(value,...args){window.__axes.push(String(value));return text.call(this,value,...args)};
proto.stroke=function(...args){if(Math.abs(this.lineWidth-2.3)<0.01)window.__curve=this.__points.slice();return stroke.apply(this,args)};
"""
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    for width,height in [(1366,768),(390,844)]:
        page=browser.new_page(viewport={'width':width,'height':height})
        page.add_init_script(capture)
        for case in ['flat','low-cuts','stacked-cuts','stacked-boosts']:
            page.goto('http://127.0.0.1:8768')
            page.wait_for_selector('.band-column')
            if case!='flat':
                page.evaluate("""(name)=>{
                  function set(selector,values){document.querySelectorAll(selector).forEach((input,i)=>{input.value=values[i];input.dispatchEvent(new Event('input',{bubbles:true}))})}
                  if(name==='low-cuts')set('.band-gain input',[-12,-12,-12,0,2,0,0,0,0,4]);
                  else {set('.band-frequency input',Array(10).fill(1000));set('.band-gain input',Array(10).fill(name==='stacked-cuts'?-12:12));}
                }""",case)
            page.wait_for_timeout(450)
            result=page.evaluate("""()=>({
              axes:window.__axes,points:window.__curve,
              height:document.querySelector('#responseChart').getBoundingClientRect().height,
              gains:[...document.querySelectorAll('.band-gain input')].map(el=>Number(el.value))
            })""")
            assert len(result['points'])==650,(width,case)
            assert all(20<=point[1]<=result['height']-27 for point in result['points']),(width,case,'curve clipped')
            if case=='flat':assert '-12' in result['axes'] and '+12' in result['axes']
            if case=='low-cuts':
                assert '-24' in result['axes'] or '-36' in result['axes'],result['axes']
                assert result['gains']==[-12,-12,-12,0,2,0,0,0,0,4]
                page.screenshot(path=str(Path('docs/screenshots')/f'AZLA-Graph-Cuts-{width}.png'),full_page=True)
            if case.startswith('stacked-'):
                labels=[float(label) for label in result['axes'] if label.lstrip('+-').isdigit()]
                assert max(labels)>96 and min(labels)<-96,(width,case,result['axes'])
            print('PASS:',width,case,'complete curve visible; EQ gains unchanged')
        page.close()
    browser.close()
