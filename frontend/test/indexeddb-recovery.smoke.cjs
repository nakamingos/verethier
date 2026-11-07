const {chromium}=require('playwright-core');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const origin='https://bouncer-storage.test';
const source=process.env.IDB_KEYVAL_SOURCE || path.join(path.dirname(require.resolve('idb-keyval/package.json')),'dist/index.js');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage();
  await page.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.origin!==origin)return route.abort();
   if(url.pathname==='/idb-keyval.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(source,'utf8')});
   return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Storage recovery regression</title>'});
  });
  await page.goto(origin);
  const result=await page.evaluate(async()=>{
   const opened=[];const original=indexedDB.open.bind(indexedDB);
   indexedDB.open=(...args)=>{const request=original(...args);request.addEventListener('success',()=>opened.push(request.result));return request};
   const {createStore,get,set,del}=await import('/idb-keyval.js');
   const store=createStore('WALLET_CONNECT_V2_INDEXED_DB','keyvaluestorage');
   const session={topic:'synthetic-session',accounts:['eip155:1:0x1111111111111111111111111111111111111111']};
   await set('synthetic-session',session,store);
   const initial=await get('synthetic-session',store);
   // Model Safari's unexpected-close event after the SDK cached a real connection.
   opened[0].close();opened[0].dispatchEvent(new Event('close'));
   const [restored,parallel]=await Promise.all([get('synthetic-session',store),get('synthetic-session',store)]);
   await set('synthetic-retry','persisted',store);
   const written=await get('synthetic-retry',store);
   await del('synthetic-session',store);await del('synthetic-retry',store);
   return {initial,restored,parallel,written,opened:opened.length};
  });
  assert.deepEqual(result.restored,result.initial,'Existing session must survive reopening');
  assert.deepEqual(result.parallel,result.initial,'Concurrent retry must reuse the reopened connection');
  assert.equal(result.written,'persisted');assert.equal(result.opened,2);
  console.log('PASS: real IndexedDB reopens after an unexpected close, preserving the session and concurrent reads/writes');
 }finally{await browser.close()}
})().catch(error=>{console.error(error.message);process.exitCode=1});
