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
const key=encode({version:128,privateKey:secret,compressed:true});
const address=payments.p2pkh({pubkey:secp256k1.getPublicKey(secret,true)}).address;
const signatures=new BitcoinSignatureService();
const root=path.resolve(__dirname,'../dist/frontend/browser'),origin='https://bouncer.test';
const nonce = "a".repeat(64),
  expiry = Math.floor(Date.now() / 1000) + 600;
const data = {
  userId: "111111111111111111",
  userTag: "Collector",
  discordId: "222222222222222222",
  discordName: "Stamps community",
  avatar: "",
  discordIcon: "",
  nonce,
  expiry,
  address: "",
};
const artifacts = fs.mkdtempSync("/tmp/bouncer-stamps-wallet-smoke-");
(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_BIN ||
      "/home/snep/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    for (const width of [1280, 393, 320]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        hasTouch: width < 800,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      let challenge,
        submitted = 0;
      await page.exposeFunction('__signBitcoin',message=>Signer.sign(key,address,message));
      await page.addInitScript(({address})=>{
        window.unisat={requestAccounts:async()=>[address],getAccounts:async()=>[address],getChain:async()=>({enum:'BITCOIN_MAINNET'}),signMessage:async(message,type)=>{
          if(type!=='ecdsa')throw new Error('Legacy Stamps wallets use compact message proofs');
          return window.__signBitcoin(message);
        }};
      },{address});
      await page.routeWebSocket("**", (socket) => socket.close());
      await page.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === "/api/verification-context")
          return route.fulfill({
            json: { walletTypes: ["bitcoin"], bitcoinStamps:true, expiry, data },
          });
        if (url.pathname === "/api/bitcoin-challenge") {
          const input = route.request().postDataJSON();
          assert.equal(input.address, address);
          assert.equal(input.nonce, nonce);
          challenge=['Bouncer verification',origin,address,nonce,data.userId,data.discordId].join('\n');
          return route.fulfill({
            json: { address, message: challenge, expiry },
          });
        }
        if (url.pathname === "/api/verify-signature") {
          const proof = route.request().postDataJSON();
          assert.equal(proof.data.walletType, "bitcoin");
          assert.equal(proof.data.address, address);
          assert.equal(proof.data.chainId, undefined);
          signatures.verifyMessage(address, challenge, proof.signature);
          submitted++;
          return route.fulfill({
            json: { message: "Verified", address, assignedRoles: [] },
          });
        }
        if (url.origin === origin) {
          if (url.pathname.startsWith("/verify/"))
            return route.fulfill({ path: path.join(root, "index.html") });
          const file = path.resolve(root, "." + url.pathname);
          if (
            file.startsWith(root + "/") &&
            fs.existsSync(file) &&
            fs.statSync(file).isFile()
          )
            return route.fulfill({ path: file });
        }
        return route.fulfill({ json: {} });
      });
      await page.goto(origin + "/verify/" + nonce);
      await page.locator(".step-1 button").filter({hasText:/^Connect/}).first().click();
      assert.equal(new URL(page.url()).origin, origin);
      await page.waitForFunction(
        () =>
          getComputedStyle(document.querySelector(".step-2.active")).opacity ===
          "1",
      );
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "Connected form horizontal overflow",
      );
      await page.screenshot({
        path: path.join(artifacts, `${width}-connected.png`),
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "Sign Message", exact: true })
        .click();
      await page.locator(".step-3.active").waitFor();
      await page.waitForFunction(
        () =>
          getComputedStyle(document.querySelector(".step-3.active")).opacity ===
          "1",
      );
      assert.equal(submitted, 1);
      assert.deepEqual(errors, []);
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "Horizontal overflow",
      );
      await page.screenshot({
        path: path.join(artifacts, `${width}.png`),
        fullPage: true,
      });
      console.log(
        JSON.stringify({ width, result: "passed", signature: "real legacy Bitcoin proof; Base58 case preserved" }),
      );
      await context.close();
    }
  } finally {
    await browser.close();
  }
  console.log("Artifacts: " + artifacts);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
