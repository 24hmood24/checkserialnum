const fs = require('fs');
const { chromium } = require('playwright');
(async () => {
  const out = {console:[], requests:[], responses:[]};
  const browser = await chromium.launch({args:['--no-sandbox'], headless: true});
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('console', msg => {
    out.console.push({type: msg.type(), text: msg.text()});
  });
  page.on('pageerror', err => {
    out.console.push({type: 'pageerror', text: ''+err});
  });
  page.on('request', req => {
    out.requests.push({url: req.url(), method: req.method(), resourceType: req.resourceType()});
  });
  page.on('requestfailed', req => {
    out.requests.push({url: req.url(), status: 'failed', failure: req.failure() && req.failure().errorText});
  });
  page.on('response', async res => {
    try{
      out.responses.push({url: res.url(), status: res.status(), ct: res.headers()['content-type']});
    }catch(e){
      out.responses.push({url: res.url(), status: null, err: ''+e});
    }
  });
  const url = 'https://checkserialnum.com';
  try{
    await page.goto(url, {waitUntil: 'networkidle', timeout: 45000});
  }catch(e){
    out.console.push({type:'goto-error', text: ''+e});
  }
  await page.waitForTimeout(2000);
  const html = await page.content();
  const screenshotPath = 'checkserialnum_screenshot.png';
  await page.screenshot({path: screenshotPath, fullPage: true});
  fs.writeFileSync('checkserialnum_rendered.html', html, 'utf8');
  fs.writeFileSync('checkserialnum_browser_log.json', JSON.stringify(out,null,2), 'utf8');
  console.log('Saved screenshot:', screenshotPath);
  console.log('Saved HTML: checkserialnum_rendered.html');
  console.log('Saved browser log: checkserialnum_browser_log.json');
  await browser.close();
})();
