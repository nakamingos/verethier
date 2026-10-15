const { chromium } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const artifacts = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bouncer-wallet-smoke-'));
const { generatePrivateKey, privateKeyToAccount } = require('viem/accounts');
const { recoverTypedDataAddress } = require('viem');
const account = privateKeyToAccount(generatePrivateKey());
const dist = root + '/dist/frontend/browser';
const index = fs.readFileSync(dist + '/index.html', 'utf8');
const origin = 'https://verify.bouncer.test';
const nonce = 'a'.repeat(64);
const expiry = Math.floor(Date.now() / 1000) + 3600;
const rainbow = { id: 'rainbow-test', name: 'Rainbow', mobile_link: 'rainbow://', chains: ['eip155:1'], supports_wc: true };

async function setup(browser, mobile, injected) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 393, height: 851 } : { width: 1000, height: 850 },
    ...(mobile ? { isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36' } : {}),
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  const consoleErrors = [];
  const socketMethods = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') consoleErrors.push(message.text().replace(/(?:https?:\/\/|wss?:\/\/|wc:)[^\s]+/gi, '[link]')); });
  let proof, typedData;
  if (injected) {
    await page.exposeFunction('__testSign', async data => {
      typedData = data;
      return account.signTypedData(data);
    });
    await page.addInitScript(({ address }) => {
      const listeners = new Map();
      const provider = {
        isMetaMask: false,
        on: (name, fn) => listeners.set(name, [...(listeners.get(name) || []), fn]),
        removeListener: (name, fn) => listeners.set(name, (listeners.get(name) || []).filter(item => item !== fn)),
        request: async ({ method, params }) => {
          window.__walletCalls.push(method);
          if (method === 'eth_chainId') return '0x1';
          if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [address];
          if (method === 'wallet_requestPermissions') return [{ parentCapability: 'eth_accounts' }];
          if (method === 'wallet_getCapabilities') return {};
          if (method === 'eth_signTypedData_v4') return window.__testSign(JSON.parse(params[1]));
          if (method === 'wallet_revokePermissions') return null;
          throw Object.assign(new Error('Unsupported test method'), { code: 4200 });
        },
      };
      window.__walletCalls = [];
      window.ethereum = provider;
      const announce = () => dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: {
        info: { uuid: 'b121fd92-aad7-42d3-afbe-88e14ca6b211', name: 'Test Wallet', rdns: 'test.bouncer.wallet', icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' }, provider,
      } }));
      addEventListener('eip6963:requestProvider', announce); announce();
    }, { address: account.address });
  }
  await page.routeWebSocket('**', socket => {
    socket.onMessage(raw => {
      const message = JSON.parse(raw);
      const reply = message => {
        socketMethods.push(message.method);
        socket.send(JSON.stringify({ id: message.id, jsonrpc: '2.0', result: message.method?.includes('batchSubscribe') ? message.params.topics.map((_, i) => 'test-subscription-' + i) : message.method?.toLowerCase().includes('subscribe') ? 'test-subscription' : true }));
      };
      if (Array.isArray(message)) message.forEach(reply); else reply(message);
    });
  });
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) {
      if (url.pathname.startsWith('/verify/')) return route.fulfill({ contentType: 'text/html', body: index });
      const file = path.resolve(dist, '.' + url.pathname);
      if (file.startsWith(dist + '/') && fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({ path: file });
      return route.abort();
    }
    if (url.pathname === '/api/verification-context') return route.fulfill({ json: {
      walletTypes: ['evm', 'bitcoin'], expiry,
      data: { userId: 'test-member', userTag: 'Collector', avatar: '', discordId: 'test-guild', discordName: 'NoMoreLabs', discordIcon: '', nonce },
    } });
    if (url.pathname === '/api/verify-signature') { proof = request.postDataJSON(); return route.fulfill({ json: { assignedRoles: ['holder'] } }); }
    if (url.pathname === '/appkit/v1/config') return route.fulfill({ json: { features: [] } });
    if (url.pathname === '/appkit/v1/project-limits') return route.fulfill({ json: { planLimits: { tier: 'starter', isAboveMauLimit: false, isAboveRpcLimit: false } } });
    if (url.pathname === '/getWallets') return route.fulfill({ json: { data: [rainbow], count: 1 } });
    if (url.pathname === '/getWalletRanks') return route.fulfill({ json: { data: [], count: 0 } });
    if (url.pathname === '/getAnalyticsConfig') return route.fulfill({ json: {} });
    if (request.method() === 'POST') {
      let payload; try { payload = request.postDataJSON(); } catch {}
      if (payload?.method?.startsWith('eth_')) return route.fulfill({ json: { jsonrpc: '2.0', id: payload.id, result: payload.method === 'eth_getBalance' ? '0x0' : '0x1' } });
      return route.fulfill({ json: {} });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto(origin + '/verify/' + nonce);
  await page.getByText('Connect your wallet', { exact: true }).waitFor();
  return { context, page, errors, consoleErrors, socketMethods, get proof() { return proof; }, get typedData() { return typedData; } };
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env['CHROME_BIN'], headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    for (const mobile of [false, true]) {
      const test = await setup(browser, mobile, true);
      const { page } = test;
      await page.locator('.step-1 .actions button').click();
      await page.getByText('Test Wallet', { exact: true }).last().click();
      await page.getByRole('button', { name: 'Sign Message', exact: true }).waitFor({ state: 'visible' });
      await page.getByRole('button', { name: 'Sign Message', exact: true }).click();
      await page.locator('.step-3.active').waitFor();
      assert.equal(test.proof.data.walletType, 'evm');
      assert.equal(test.proof.data.address.toLowerCase(), account.address.toLowerCase());
      assert.equal((await recoverTypedDataAddress({ ...test.typedData, signature: test.proof.signature })).toLowerCase(), account.address.toLowerCase());
      assert.equal(test.typedData.domain.name, 'Bouncer');
      assert.equal(test.typedData.message.Nonce, nonce);
      assert.deepEqual(test.errors, []);
      await page.screenshot({ path: path.join(artifacts, (mobile ? 'phone' : 'desktop') + '.png'), fullPage: true });
      console.log(JSON.stringify({ scenario: mobile ? 'mobile-injected-signature' : 'desktop-injected-signature', result: 'passed' }));
      await test.context.close();
    }
    const test = await setup(browser, true, false);
    const { page } = test;
    let handoff;
    const cdp = await test.context.newCDPSession(page);
    await cdp.send('Page.enable');
    cdp.on('Page.frameRequestedNavigation', event => { if (event.url.startsWith('rainbow:')) handoff = event.url; });
    await page.locator('.step-1 .actions button').click();
    await page.getByText('Rainbow', { exact: true }).last().click();
    for (let n = 0; n < 40 && !handoff; n++) await page.waitForTimeout(250);
    if (!handoff) {
      await page.screenshot({ path: path.join(artifacts, 'rainbow-pending.png'), fullPage: true });
      console.log(JSON.stringify({ pageError: await page.locator('.error-message').allTextContents(), modalText: await page.locator('w3m-modal').ariaSnapshot(), errors: test.errors, consoleErrors: test.consoleErrors.slice(-15), socketMethods: test.socketMethods }));
    }
    assert(handoff, 'Expected an Android Rainbow app handoff');
    assert(new URL(handoff).searchParams.get('uri').startsWith('wc:'), 'Handoff must contain a WalletConnect pairing URI');
    assert.equal(await page.locator('w3m-email-login-widget').count(), 0);
    assert.equal(await page.locator('w3m-social-login-widget').count(), 0);
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--apkt-tokens-core-backgroundAccentPrimary').trim().toUpperCase()), '#00FF73');
    assert.deepEqual(test.errors, []);
    await page.screenshot({ path: path.join(artifacts, 'rainbow-mobile.png'), fullPage: true });
    console.log(JSON.stringify({ scenario: 'android-rainbow-deep-link', result: 'passed' }));
    await test.context.close();
  } finally { await browser.close(); console.log(`Browser screenshots: ${artifacts}`); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
