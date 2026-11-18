// Manual Bitcoin signing ("Other wallet"), as with Freewallet: the member enters
// an address, copies Bouncer's message, signs it elsewhere and pastes the
// signature. Signatures are real and checked by the backend's verifier.
const { chromium } = require("playwright-core");
const fs = require('node:fs'),path = require('node:path'),assert = require('node:assert/strict'),Module=require('node:module');
const backend=path.resolve(__dirname,'../../backend'),resolve=Module._resolveFilename;
Module._resolveFilename=function(name,...rest){return resolve.call(this,name.startsWith('@/')?path.join(backend,'dist',name.slice(2)):name,...rest)};
const {Signer}=require(path.join(backend,'node_modules/bip322-js'));
const {encode}=require(path.join(backend,'node_modules/wif'));
const {payments}=require(path.join(backend,'node_modules/bitcoinjs-lib'));
const {secp256k1}=require(path.join(backend,'node_modules/@noble/curves/secp256k1'));
const {BitcoinSignatureService}=require(path.join(backend,'dist/services/bitcoin-signature.service'));
const secret=new Uint8Array(32);secret[31]=1;
const pubkey=secp256k1.getPublicKey(secret,true);
const key=encode({version:128,privateKey:secret,compressed:true});
const legacy=payments.p2pkh({pubkey}).address, native=payments.p2wpkh({pubkey}).address;
// Freewallet signs SegWit addresses with the legacy compact format, as signing
// for the key's P2PKH address does.
const sign=(message)=>Signer.sign(key,legacy,message);
const signatures=new BitcoinSignatureService();
const {BitcoinRelayService}=require(path.join(backend,'dist/services/bitcoin-relay.service'));
const root=path.resolve(__dirname,'../dist/frontend/browser'),origin='https://bouncer.test';
const nonce="a".repeat(64), expiry=Math.floor(Date.now()/1000)+600;
const data={userId:"111111111111111111",userTag:"Collector",discordId:"222222222222222222",discordName:"Stamps community",avatar:"",discordIcon:"",nonce,expiry,address:""};
const artifacts=fs.mkdtempSync("/tmp/bouncer-manual-bitcoin-smoke-");
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||"/home/snep/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome",headless:true,args:["--no-sandbox"]});
  try{
    for(const [width,address] of [[1280,legacy],[1024,native],[393,native],[320,legacy]]){
      const phone=width<800;
      const context=await browser.newContext({viewport:{width,height:900},hasTouch:phone,...(phone?{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'}:{})});
      await context.grantPermissions(['clipboard-read','clipboard-write'],{origin});
      const page=await context.newPage();
      page.setDefaultTimeout(15000);
      const errors=[];
      page.on("pageerror",(error)=>errors.push(error.message));
      let challenge, submitted=0;
      const relay=new BitcoinRelayService(signatures);
      await page.routeWebSocket("**",(socket)=>socket.close());
      await page.route("**/*",async(route)=>{
        const url=new URL(route.request().url());
        if(url.pathname==="/api/verification-context")
          return route.fulfill({json:{walletTypes:["bitcoin"],bitcoinStamps:true,expiry,data}});
        if(url.pathname==="/api/bitcoin-challenge"){
          const input=route.request().postDataJSON();
          assert.equal(input.address,address);
          challenge=['Bouncer verification',`Site: ${origin}`,`Address: ${address}`,`Code: ${nonce.slice(0,32)}`,'Expires: 2030-03-17 17:46:40 UTC'].join('\n');
          return route.fulfill({json:{address,message:challenge,expiry}});
        }
        if(url.pathname==="/api/bitcoin-relay"){
          const input=route.request().postDataJSON();
          return route.fulfill({json:relay.create(input.address,input.message)});
        }
        if(url.pathname.startsWith("/api/bitcoin-relay/")){
          const signature=relay.read(url.pathname.split('/').pop());
          return signature===undefined?route.fulfill({status:404,json:{}}):route.fulfill({json:{signature}});
        }
        if(url.pathname==="/api/verify-signature"){
          const proof=route.request().postDataJSON();
          assert.equal(proof.data.walletType,"bitcoin");
          assert.equal(proof.data.address,address);
          signatures.verifyMessage(address,challenge,proof.signature);
          submitted++;
          return route.fulfill({json:{message:"Verified",address,assignedRoles:[]}});
        }
        if(url.origin===origin){
          if(url.pathname.startsWith("/verify/")) return route.fulfill({path:path.join(root,"index.html")});
          const file=path.resolve(root,"."+url.pathname);
          if(file.startsWith(root+"/")&&fs.existsSync(file)&&fs.statSync(file).isFile()) return route.fulfill({path:file});
        }
        return route.fulfill({json:{}});
      });
      await page.goto(origin+"/verify/"+nonce);
      await page.getByRole("button",{name:"Bitcoin with another wallet"}).click();
      await page.getByText("Enter your Bitcoin address").waitFor();
      await page.getByLabel("Bitcoin address").fill("not-an-address");
      await page.getByRole("button",{name:"Use address",exact:true}).click();
      await page.getByText(/Enter a Bitcoin mainnet address/).waitFor();
      await page.getByLabel("Bitcoin address").fill(address);
      await page.getByRole("button",{name:"Use address",exact:true}).click();
      await page.waitForFunction(()=>getComputedStyle(document.querySelector(".step-2.active")).opacity==="1");
      // Cancel once, then sign for real.
      await page.getByRole("button",{name:"Sign Message",exact:true}).click();
      await page.getByRole("button",{name:"Cancel",exact:true}).click();
      await page.getByText(/Signing was cancelled/).waitFor();
      await page.getByRole("button",{name:"Sign Message",exact:true}).click();
      await page.getByRole("button",{name:"Copy message",exact:true}).waitFor();
      const freewallet=page.getByRole("link",{name:"Sign with Freewallet",exact:true});
      if(width===1280){
        // Freewallet: open the counterparty: link, sign, and post to its callback.
        await freewallet.waitFor();
        const link=await freewallet.getAttribute("href");
        assert.match(link,new RegExp('^counterparty:'+address+'\\?action=sign&message='));
        const params=Object.fromEntries(link.split('?')[1].split('&').map(pair=>pair.split('=').map(decodeURIComponent)));
        assert.equal(params.message,challenge);
        const callback=new URL(params.callback);
        assert.match(callback.pathname,/^\/api\/bitcoin-relay\/[A-Za-z0-9_-]{32}$/);
        await page.evaluate(()=>{const a=document.querySelector('a.button[href^="counterparty:"]');a.addEventListener('click',e=>e.preventDefault(),{once:true});});
        await freewallet.click();
        await page.getByText(/Waiting for Freewallet/).waitFor();
        relay.deliver(callback.pathname.split('/').pop(),address,sign(params.message));
        await page.locator(".step-3.active").waitFor();
        assert.equal(submitted,1);
        assert.deepEqual(errors,[]);
        console.log(JSON.stringify({width,address:'legacy',result:"passed",signature:"Freewallet link and callback relay"}));
        await context.close();
        continue;
      }
      if(phone) assert.equal(await freewallet.count(),0,"No Freewallet link on phones");
      else await freewallet.waitFor();
      // The panel stays readable while waiting for the pasted signature.
      assert.equal(await page.locator(".step-2").evaluate(el=>el.classList.contains("disabled")),false);
      await page.getByText("Show message").click();
      const shown=page.getByLabel("Message to sign");
      assert.equal(await shown.inputValue(),challenge);
      await page.getByRole("button",{name:"Copy message",exact:true}).click();
      await page.getByRole("button",{name:"Copied",exact:true}).waitFor();
      assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),challenge);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"Signing panel horizontal overflow");
      await page.screenshot({path:path.join(artifacts,`${width}-signing.png`),fullPage:true});
      await page.getByLabel("Signature").fill("not a signature");
      await page.getByRole("button",{name:"Submit signature",exact:true}).click();
      await page.getByText(/Paste the signature exactly/).waitFor();
      // Freewallet signs the pasted text with CRLF line breaks.
      await page.getByLabel("Signature").fill("\n"+sign((await page.evaluate(()=>navigator.clipboard.readText())).replace(/\n/g,"\r\n"))+"\n");
      await page.getByRole("button",{name:"Submit signature",exact:true}).click();
      await page.locator(".step-3.active").waitFor();
      assert.equal(submitted,1);
      assert.deepEqual(errors,[]);
      await page.screenshot({path:path.join(artifacts,`${width}.png`),fullPage:true});
      console.log(JSON.stringify({width,address:address.startsWith('1')?'legacy':'native SegWit',result:"passed",signature:"real compact Bitcoin proof, pasted"}));
      await context.close();
    }
  }finally{await browser.close();}
  console.log("Artifacts: "+artifacts);
})().catch((error)=>{console.error(error);process.exitCode=1;});
