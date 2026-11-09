const { chromium } = require('playwright-core');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../dist/frontend/browser'), origin = 'https://bouncer.test';
const alpha = '111111111111111111', beta = '222222222222222222', channel = '333333333333333333', role = '444444444444444444';
const token = 'f'.repeat(64), artifacts = fs.mkdtempSync('/tmp/bouncer-history-browser-');
const delay = () => { let release; const promise = new Promise(resolve => release = resolve); return {promise,release}; };
async function urlIs(page, server, tab) {
  await page.waitForURL(url => url.pathname === '/admin' && url.searchParams.get('server') === server && url.searchParams.get('tab') === tab);
  await page.getByRole('heading',{name:(server===alpha?'Alpha':'Beta')+' Control Room',exact:true}).waitFor();
  const labels={rules:'Rules',settings:'Bot Settings',audit:'Audit Log'};
  await page.waitForFunction(label => Array.from(document.querySelectorAll('.workspace-tabs button')).some(button=>button.textContent.trim()===label && button.getAttribute('aria-current')==='page' && !button.disabled),labels[tab]);
}
async function minimumIs(page, expected) {
  await page.waitForFunction(value => Array.from(document.querySelectorAll('label')).some(label =>
    label.textContent.trim().startsWith('Minimum items:') && label.querySelector('input')?.value === value), expected);
}
(async () => {
  const browser = await chromium.launch({executablePath:process.env.CHROME_BIN || '/home/snep/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
  try {
    for (const width of [1280,393,320]) {
      const context = await browser.newContext({viewport:{width,height:1000},hasTouch:width<800});
      const page = await context.newPage(), errors = [], writes = [], reads = [];
      let signedIn = true, contextStatus = 400, holdBeta, betaStarted, denyBeta = false;
      page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
      const makeRule = server => ({id:server===alpha?174:175,server_id:server,channel_id:channel,role_id:role,role_name:'Collector',primary_role_name:'Collector',additional_roles:[],asset_type:'ordinal',min_items:1,slug:null,inscription_criteria:{kind:'numbers',ranges:[[10100838,10100838]]},version:'v1',fields:[{key:'selection',label:'Inscription numbers / ranges',value:'10100838',list:true},{key:'label',label:'Label (optional)',value:'McSkull'},{key:'min_items',label:'Minimum items',value:'1',required:true}]});
      await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.pathname === '/api/verification-context') return route.fulfill({status:contextStatus,json:contextStatus===400?{message:'This verification link is no longer active. Please return to Discord and request a new one.'}:{message:'Temporarily unavailable'}});
        if (url.origin !== origin) return route.abort();
        if (url.pathname.startsWith('/api/portal')) {
          const api = url.pathname.slice(11); let data = {};
          if (request.method() === 'POST') writes.push({path:api,body:request.postDataJSON()});
          if (api === '/session') data = {user:signedIn?{id:'admin',name:'Admin'}:null,csrf:'csrf',configured:true};
          else if (api === '/servers') data = {servers:[{id:alpha,name:'Alpha',installed:true},{id:beta,name:'Beta',installed:true}]};
          else if (api === `/servers/${alpha}` || api === `/servers/${beta}`) {
            const server = api.endsWith(beta)?beta:alpha; reads.push(server);
            if (server===beta && holdBeta) { betaStarted.release(); await holdBeta.promise; holdBeta = null; }
            if (server===beta && denyBeta) return route.fulfill({status:403,json:{message:'Server access is no longer available.'}});
            data = {server:{id:server,name:server===alpha?'Alpha':'Beta'},rules:[makeRule(server)],channels:[{id:channel,name:'verify'}],roles:[{id:role,name:'Collector',manageable:true}],role_actions:[],diagnostics:[],settings:{background_checks_enabled:true},capabilities:{multi_trait:true}};
          } else if (api.includes('/activity')) data = {items:[],total:0,page:1,pages:1};
          else if (api === '/auth/logout') {signedIn=false; data={};}
          else throw new Error('Unexpected API '+api);
          return route.fulfill({json:data});
        }
        let file = path.join(root, decodeURIComponent(url.pathname));
        if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root,'index.html');
        return route.fulfill({path:file});
      });
      await page.goto(origin+'/verify/'+token);
      const inactive = page.getByRole('status').filter({has:page.getByRole('heading',{name:'This verification link is no longer active.',exact:true})});
      await inactive.waitFor(); assert.equal(await page.getByRole('alert').count(),0,'Inactive links are informational');
      assert.equal(await inactive.getByRole('link',{name:'Member Portal',exact:true}).getAttribute('href'),'/member');
      await page.screenshot({path:path.join(artifacts,`inactive-${width}.png`),fullPage:true});
      await inactive.getByRole('link',{name:'Control Room',exact:true}).click();
      await urlIs(page,alpha,'rules'); await page.getByRole('button',{name:'Edit',exact:true}).click();
      await page.getByLabel('Minimum items:',{exact:true}).fill('5');
      await page.getByRole('button',{name:'Bot Settings',exact:true}).click(); await urlIs(page,alpha,'settings');
      await page.goBack(); await urlIs(page,alpha,'rules');
      await minimumIs(page,'5'); assert.equal(await page.getByLabel('Minimum items:',{exact:true}).inputValue(),'5','Back restores edited requirements');
      await page.goForward(); await urlIs(page,alpha,'settings');
      await page.goBack(); await urlIs(page,alpha,'rules');
      await page.locator('.server-list').getByRole('button',{name:'Beta',exact:true}).click(); await urlIs(page,beta,'rules');
      await page.getByRole('button',{name:'Edit',exact:true}).click(); await page.getByLabel('Minimum items:',{exact:true}).fill('7');
      await page.getByRole('button',{name:'Audit Log',exact:true}).click(); await urlIs(page,beta,'audit');
      await page.goBack(); await urlIs(page,beta,'rules');
      await minimumIs(page,'7'); assert.equal(await page.getByLabel('Minimum items:',{exact:true}).inputValue(),'7');
      await page.goBack(); await urlIs(page,alpha,'rules');
      await minimumIs(page,'5'); assert.equal(await page.getByLabel('Minimum items:',{exact:true}).inputValue(),'5','Server drafts remain separate');
      await page.goForward(); await urlIs(page,beta,'rules');
      await page.getByRole('link',{name:'Help',exact:true}).click();
      await page.getByRole('heading',{name:'Verify your wallet. Get your roles.',exact:true}).waitFor();
      await page.goBack(); await urlIs(page,beta,'rules');
      await minimumIs(page,'7'); assert.equal(await page.getByLabel('Minimum items:',{exact:true}).inputValue(),'7','Help/Back restores an unsaved draft');
      await page.getByRole('button',{name:'Cancel',exact:true}).click();
      await page.getByRole('button',{name:'Bot Settings',exact:true}).click(); await urlIs(page,beta,'settings');
      await page.goBack(); await urlIs(page,beta,'rules');
      assert.equal(await page.getByRole('button',{name:'Review changes',exact:true}).count(),0,'Cancel discards a draft');
      await page.getByRole('button',{name:'Edit',exact:true}).click(); await minimumIs(page,'1'); assert.equal(await page.getByLabel('Minimum items:',{exact:true}).inputValue(),'1');
      await page.getByRole('button',{name:'Cancel',exact:true}).click();
      await page.getByRole('button',{name:'+ Add rule',exact:true}).click();
      await page.getByLabel('Minimum items:',{exact:true}).fill('9');
      await page.getByRole('button',{name:'Bot Settings',exact:true}).click(); await urlIs(page,beta,'settings');
      await page.goBack(); await urlIs(page,beta,'rules'); await minimumIs(page,'9'); assert.equal(await page.getByLabel('Minimum items:',{exact:true}).inputValue(),'9','New drafts survive tab navigation');
      await page.getByRole('button',{name:'Cancel',exact:true}).click();
      if (width===1280) {
        // Back during a slow server read must win once the pending read settles.
        await page.locator('.server-list').getByRole('button',{name:'Alpha',exact:true}).click(); await urlIs(page,alpha,'rules');
        holdBeta=delay(); betaStarted=delay();
        await page.locator('.server-list').getByRole('button',{name:'Beta',exact:true}).click(); await betaStarted.promise;
        await page.evaluate(()=>{window.oldServerFrames=[];window.oldServerObserver=new MutationObserver(()=>{if(document.querySelector('.portal-heading h1')?.textContent.includes('Beta'))window.oldServerFrames.push('Beta');});window.oldServerObserver.observe(document.body,{subtree:true,childList:true,characterData:true});});
        await page.goBack(); holdBeta.release(); await urlIs(page,alpha,'rules');
        assert.deepEqual(await page.evaluate(()=>{window.oldServerObserver.disconnect();return window.oldServerFrames;}),[],'A superseded server response must never replace the Back target');
        await page.getByRole('heading',{name:'Alpha Control Room',exact:true}).waitFor();
        // Old URLs remain usable as links, while invalid server/tab values are normalized safely.
        await page.goto(origin+`/admin?server=${beta}&tab=audit`); await urlIs(page,beta,'audit');
        await page.goto(origin+'/admin?server=not-a-server&tab=operator&nonce=must-not-persist'); await urlIs(page,beta,'rules');
        assert.equal(new URL(page.url()).searchParams.has('nonce'),false);
        await page.getByRole('button',{name:'Edit',exact:true}).click(); await page.getByLabel('Minimum items:',{exact:true}).fill('11');
        await page.getByRole('link',{name:'Help',exact:true}).click(); denyBeta=true;
        await page.goBack(); await page.getByText('Server access is no longer available.',{exact:true}).waitFor();
        assert.equal(await page.getByLabel('Minimum items:',{exact:true}).count(),0,'Restoring a draft still requires fresh server access');
        denyBeta=false;
      }
      assert.equal(writes.length,0,'Navigation must never save a rule or replay a mutation');
      assert.ok(reads.every(server=>[alpha,beta].includes(server)));
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow');
      assert.deepEqual(errors,[]); console.log('PASS portal history '+width);
      // A real service failure must not be described as an expired link.
      contextStatus=503; await page.goto(origin+'/verify/'+token);
      await page.getByRole('alert').getByText('Could not load verification. Check your connection and reload this page to try again.',{exact:true}).waitFor();
      assert.equal(await page.getByRole('heading',{name:'This verification link is no longer active.',exact:true}).count(),0);
      await context.close();
    }
  } finally { await browser.close(); }
  console.log('Artifacts: '+artifacts);
})().catch(error=>{console.error(error);process.exitCode=1;});
