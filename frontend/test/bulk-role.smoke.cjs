const {chromium}=require('playwright-core'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../dist/frontend/browser'),origin='https://bouncer.test',server='111111111111111111',source='222222222222222222',role='333333333333333333',user='444444444444444444',id='00000000-0000-4000-8000-000000000001';
const artifacts=fs.mkdtempSync('/tmp/bouncer-bulk-browser-');
async function choose(page,name,label){await page.getByRole('combobox',{name,exact:true}).locator('.pixel-select-arrow').click();await page.getByRole('listbox').getByRole('option',{name:label,exact:true}).click();}
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN || '/home/snep/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
 try{for(const width of [1280,768,393,320]){
  const context=await browser.newContext({viewport:{width,height:1000},hasTouch:width<800}),page=await context.newPage(),errors=[],writes=[];
  let deleted=false,denyDeleteOnce=false;
  let state='preview',mode='grant',started=false,processed=0,failed=0,granted=0,failResume=false,resumeReceipt;
  page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
  const info=()=>({job:{id,status:state,mode,started_by:started?user:null,labels:{audience:'Pizza Comrade',target:'Rule 204 · Comrade',roles:{[role]:'Comrade',rank1:'Gold Bearer',rank2:'Korporal',rank3:'Leutnant',unknown1:'Lord',unknown2:'McSkullx'}},created_at:new Date().toISOString(),preview_expires_at:new Date(Date.now()+1800000).toISOString()},summary:{total:2,processed,granted,removed:0,already_held:1,no_wallet:0,ineligible:0,unavailable:failed,excluded:0,left_audience:0,errors:failed},members:[{user_id:user,member_name:'Pizza member',status:started?'completed':'pending',result:started?{granted:[role],ineligible:['rank1','rank2','rank3'],unavailable:['unknown1','unknown2']}:{},updated_at:new Date().toISOString()}],page:1});
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());if(url.origin!==origin)return route.abort();
   if(url.pathname.startsWith('/api/portal')){
    const p=url.pathname.slice(11);let data={};
    if(p==='/session')data={user:{id:user,name:'Admin'},csrf:'csrf',configured:true};
    else if(p==='/servers')data={servers:[{id:server,name:'NoMoreLabs',installed:true}]};
    else if(p===`/servers/${server}`)data={server:{id:server,name:'NoMoreLabs'},rules:[{id:204,role_id:role,role_name:'Comrade',asset_type:'ordinal',slug:'pizza-comrades',min_items:1,fields:[]}],roles:[{id:source,name:'Pizza Comrade',manageable:true},{id:role,name:'Comrade',manageable:true}],channels:[],diagnostics:[],role_actions:[],settings:{background_checks_enabled:true}};
    else if(p.includes('/bulk-role-checks')){
     if(req.method()==='POST'){
      assert.equal(req.headers()['x-csrf-token'],'csrf');const body=req.postDataJSON();writes.push(body);
      if(p.endsWith('/preview')){assert.equal(body.source_role_id,source);assert.equal(body.rule_id,204);mode=body.mode;state='preview';started=false;processed=failed=granted=0;}
      else if(body.action==='start'){state='completed';started=true;processed=2;granted=1;}
      else if(body.action==='cancel')state='cancelled';
      else if(body.action==='delete'){
       if(denyDeleteOnce){denyDeleteOnce=false;return route.fulfill({status:409,json:{message:'A member is still finishing. Try deleting again shortly.'}});}
       assert.ok(!['pending','running'].includes(state),'Active reports cannot be deleted');deleted=true;return route.fulfill({json:{deleted:true}});
      }
      else if(body.action==='resume'){
       state='pending';
       if(failResume){failResume=false;resumeReceipt=body.request_id;return route.fulfill({status:503,json:{message:'Resume response was lost. Retry the same action.'}});}
       if(resumeReceipt)assert.equal(body.request_id,resumeReceipt,'Resume retry reuses the accepted receipt');
      }else if(body.action==='retry'){state=state==='running'?'running':'pending';processed-=failed;failed=0;}
      data=info();
     }else data=p.endsWith('/bulk-role-checks')?(deleted?[]:[info().job]):info();
    }else throw new Error('Unexpected '+p);
    return route.fulfill({json:data});
   }
   let file=url.pathname==='/' || url.pathname==='/admin'?path.join(root,'index.html'):path.join(root,decodeURIComponent(url.pathname));
   if(!fs.existsSync(file))file=path.join(root,'index.html');return route.fulfill({path:file});
  });
  await page.goto(origin+'/admin');await page.getByRole('button',{name:'Bulk role check',exact:true}).click();
  await choose(page,'Bulk audience','Current role holders');await choose(page,'Audience role','Pizza Comrade');await choose(page,'Bulk rule','Rule 204 · Comrade');
  await page.getByRole('button',{name:'Preview audience',exact:true}).click();await page.getByRole('button',{name:'Run bulk check',exact:true}).waitFor();
  assert.equal(writes[0].mode,'grant');assert.equal(writes.length,1,'Preview must not start the run');
  await page.screenshot({path:path.join(artifacts,`preview-${width}.png`),fullPage:true});
  await page.getByRole('button',{name:'Run bulk check',exact:true}).click();await page.getByText('completed',{exact:true}).first().waitFor();assert.equal(writes[1].action,'start');
  const results=page.getByRole('table',{name:'Bulk role members'});
  assert.ok(await results.getByText('Granted: Comrade',{exact:true}).isVisible());
  assert.equal(await results.getByText('Ineligible: Gold Bearer, Korporal, Leutnant',{exact:true}).count(),1);
  assert.equal(await results.getByText('Unavailable: Lord, McSkullx',{exact:true}).count(),1);
  assert.equal((await results.innerText()).match(/Ineligible:/g)?.length,1);
  // Resume a partially completed cancellation, including an accepted action whose response was lost.
  state='cancelled';processed=1;failResume=true;
  await page.getByRole('button',{name:'Refresh results',exact:true}).click();await page.getByRole('button',{name:'Resume check',exact:true}).click();
  await page.getByRole('alert').getByText('Resume response was lost. Retry the same action.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Resume check',exact:true}).click();await page.getByText('pending',{exact:true}).first().waitFor();
  assert.equal(processed,1,'Resume preserves completed member progress');assert.equal(granted,1,'Resume preserves grants');
  assert.ok(await results.getByText('Granted: Comrade',{exact:true}).isVisible());
  // Terminal failures can be retried separately, including while other members run.
  state='failed';processed=2;failed=1;
  await page.getByRole('button',{name:'Refresh results',exact:true}).click();await page.getByRole('button',{name:'Retry failed',exact:true}).click();
  await page.getByRole('button',{name:'Retry failed',exact:true}).waitFor({state:'detached'});assert.equal(processed,1);assert.equal(granted,1);
  state='running';processed=1;failed=1;
  await page.getByRole('button',{name:'Refresh results',exact:true}).click();await page.getByRole('button',{name:'Retry failed',exact:true}).click();
  await page.getByRole('button',{name:'Retry failed',exact:true}).waitFor({state:'detached'});assert.equal(state,'running');assert.equal(granted,1);
  state='cancelled';processed=1;failed=1;
  await page.getByRole('button',{name:'Refresh results',exact:true}).click();await page.getByRole('button',{name:'Resume and retry failed',exact:true}).waitFor();
  await page.screenshot({path:path.join(artifacts,`resume-retry-${width}.png`),fullPage:true});
  await page.getByRole('button',{name:'Resume and retry failed',exact:true}).click();await page.getByRole('button',{name:'Resume and retry failed',exact:true}).waitFor({state:'detached'});assert.equal(granted,1);
  // Starting or resuming a removal-enabled check requires confirmation.
  await choose(page,'Bulk action','Grant and remove proven failures');await page.getByRole('button',{name:'Preview audience',exact:true}).click();await page.getByRole('button',{name:'Run bulk check',exact:true}).waitFor();
  page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Run bulk check',exact:true}).click();assert.equal(writes.filter(w=>w.action==='start').length,1);
  await page.getByRole('button',{name:'Cancel remaining checks',exact:true}).click();await page.getByText('cancelled',{exact:true}).first().waitFor();
  assert.equal(await page.getByRole('button',{name:'Resume check',exact:true}).count(),0,'An unstarted preview cannot bypass a new preview via Resume');
  started=true;processed=1;state='cancelled';const before=writes.length;
  await page.getByRole('button',{name:'Refresh results',exact:true}).click();await page.getByRole('button',{name:'Resume check',exact:true}).waitFor();
  page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Resume check',exact:true}).click();assert.equal(writes.length,before);
  // Delete is disabled for active jobs, confirmed, recoverable after a conflict, and clears the open report.
  const recent=page.getByRole('group',{name:'Recent bulk check: Pizza Comrade → Rule 204 · Comrade',exact:true});
  state='running';await page.getByRole('button',{name:'Refresh history',exact:true}).click();
  await recent.getByRole('button',{name:/· running$/}).waitFor();assert.equal(await recent.getByRole('button',{name:'Delete',exact:true}).isEnabled(),false);
  state='cancelled';await page.getByRole('button',{name:'Refresh history',exact:true}).click();
  await recent.getByRole('button',{name:/· cancelled$/}).waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'History deletion controls fit the viewport');
  await page.screenshot({path:path.join(artifacts,`delete-history-${width}.png`),fullPage:true});
  const deletionCount=()=>writes.filter(w=>w.action==='delete').length;
  const beforeDelete=deletionCount(),grantsBeforeDelete=granted;
  page.once('dialog',d=>d.dismiss());await recent.getByRole('button',{name:'Delete',exact:true}).click();assert.equal(deletionCount(),beforeDelete);
  denyDeleteOnce=true;page.once('dialog',d=>d.accept());await recent.getByRole('button',{name:'Delete',exact:true}).click();
  await page.getByRole('alert').getByText('A member is still finishing. Try deleting again shortly.',{exact:true}).waitFor();assert.equal(deleted,false);
  page.once('dialog',d=>d.accept());await recent.getByRole('button',{name:'Delete',exact:true}).click();
  await page.getByText('No recent bulk checks.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('region',{name:'Bulk check results'}).count(),0);assert.equal(granted,grantsBeforeDelete,'Deleting a report does not undo grants');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow');assert.deepEqual(errors,[]);
  console.log('PASS bulk roles '+width);await context.close();
 }}finally{await browser.close();}
 console.log('Artifacts: '+artifacts);
})().catch(e=>{console.error(e);process.exitCode=1});
