"""Headless browser layout checks; native IPC/capture/printing are tested in Electron."""
import json
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
evidence = root / '.evidence' / 'web-ui'
evidence.mkdir(parents=True, exist_ok=True)
template = json.loads((root / 'templates/starter.json').read_text(encoding='utf-8'))
settings = dict(version=2,profileId='browser-test',eventName=template['eventName'],canvas=template['canvas'],frames=template['frames'],
    frameMode='none',frame='',background='',previewMode='full',welcome=template['welcome'],welcomeFit='contain',welcomeText='Step in. Make a memory.',preparingText='Getting the camera ready…',maxGuestCopies=10,
    geometry=dict(opening=dict(x=0,y=0,width=2400,height=3600),zoom=1,offsetX=0,offsetY=0,previewMirror=True,outputMirror=True),
    camera=dict(deviceId='',previewWidth=1280,previewHeight=720,captureWidth=1920,captureHeight=1080,autofocus=True),
    printer=dict(name='',paper='auto',copies=1,orientation='portrait',borderless=True,fit='contain'),countdown=3,inactivity=90,postAction=2,storage='browser-synthetic',fullscreen=False)
class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(root)))
threading.Thread(target=server.serve_forever, daemon=True).start()
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width':1366,'height':900})
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.add_init_script('''window.booth={settings:async()=>(SETTINGS),health:async()=>({pinSet:true,settingsError:''}),media:p=>'/templates/'+p,reset:async()=>{},unlock:async()=>{throw Error('Synthetic PIN check: use the native Electron test for authentication')}};'''.replace('SETTINGS',json.dumps(settings)))
    page.goto(f'http://127.0.0.1:{server.server_port}/dist/')
    page.wait_for_load_state('networkidle')
    page.screenshot(path=str(evidence/'welcome.png'),full_page=True)
    page.get_by_role('button',name='Touch anywhere to start').click()
    page.get_by_role('heading',name='Choose your frame').wait_for()
    assert page.locator('.frame-choice').count()==2
    for width,height in [(1366,900),(700,600)]:
        page.set_viewport_size({'width':width,'height':height})
        page.screenshot(path=str(evidence/f'choices-{width}.png'),full_page=True)
        for choice in page.locator('.frame-choice').all():
            box=choice.bounding_box()
            assert box and box['width']>=44 and box['height']>=44
            assert box['x']>=0 and box['x']+box['width']<=width+1
    page.keyboard.press('Control+Shift+G')
    page.get_by_role('dialog',name='Operator access',exact=True).wait_for()
    field=page.get_by_label('Operator PIN',exact=True)
    assert field.get_attribute('readonly') is not None
    assert field.get_attribute('inputmode')=='none'
    for digit in '135790': page.get_by_role('button',name=digit,exact=True).click()
    assert field.input_value()=='135790'
    page.get_by_role('button',name='Backspace',exact=True).click()
    assert field.input_value()=='13579'
    page.screenshot(path=str(evidence/'numeric-pin.png'),full_page=True)
    assert not errors,errors
    browser.close()
server.shutdown()
server.server_close()
print(json.dumps({'status':'PASS','scope':'Headless browser layout and touch keypad; mocked IPC only','evidence':str(evidence)}))
