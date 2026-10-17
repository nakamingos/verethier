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
let currentScenario = 'startup';
// AppKit's optional dependency accepts newer connector majors as well. Keep the
// adapter and application on the same stable connector/core instances.
const adapterDirectory = path.dirname(require.resolve('@reown/appkit-adapter-wagmi'));
for (const dependency of ['@wagmi/core', '@wagmi/connectors']) {
  assert.equal(require.resolve(dependency, { paths: [adapterDirectory] }), require.resolve(dependency), `${dependency} must resolve consistently inside AppKit`);
}

async function setup(browser, mobile, injected, entry = '/verify/' + nonce) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 393, height: 851 } : { width: 1000, height: 850 },
    ...(mobile ? { isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36' } : {}),
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  const consoleErrors = [];
  const socketMethods = [];
  const apiRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') consoleErrors.push(message.text().replace(/(?:https?:\/\/|wss?:\/\/|wc:)[^\s]+/gi, '[link]')); });
  let proof, typedData, signatures = 0;
  if (injected) {
    await page.exposeFunction('__testSign', async data => {
      signatures++;
      typedData = data;
      return account.signTypedData(data);
    });
    await page.addInitScript(({ address }) => {
      const listeners = new Map();
      let authorized = localStorage.getItem('test-wallet-authorized') === 'true';
      const provider = {
        isMetaMask: false,
        on: (name, fn) => listeners.set(name, [...(listeners.get(name) || []), fn]),
        removeListener: (name, fn) => listeners.set(name, (listeners.get(name) || []).filter(item => item !== fn)),
        request: async ({ method, params }) => {
          window.__walletCalls.push(method);
          if (method === 'eth_chainId') return '0x1';
          if (method === 'eth_accounts') return authorized ? [address] : [];
          if (method === 'eth_requestAccounts' || method === 'wallet_requestPermissions') {
            authorized = true;
            localStorage.setItem('test-wallet-authorized', 'true');
            return method === 'eth_requestAccounts' ? [address] : [{ parentCapability: 'eth_accounts' }];
          }
          if (method === 'wallet_getCapabilities') return {};
          if (method === 'eth_signTypedData_v4') return window.__testSign(JSON.parse(params[1]));
          if (method === 'wallet_revokePermissions') {
            authorized = false;
            localStorage.removeItem('test-wallet-authorized');
            return null;
          }
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
      if (url.pathname.startsWith('/verify/') || url.pathname === '/wallet-check') return route.fulfill({ contentType: 'text/html', body: index });
      const file = path.resolve(dist, '.' + url.pathname);
      if (file.startsWith(dist + '/') && fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({ path: file });
      return route.abort();
    }
    if (url.pathname.startsWith('/api/')) apiRequests.push(url.pathname);
    if (url.pathname === '/api/verification-context') return route.fulfill({ json: {
      walletTypes: ['evm', 'bitcoin'], expiry,
      data: { userId: 'test-member', userTag: 'Collector', avatar: '', discordId: 'test-guild', discordName: 'NoMoreLabs', discordIcon: '', nonce: request.postDataJSON().nonce },
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
  await page.goto(origin + entry);
  if (entry.startsWith('/wallet-check')) await page.getByRole('heading', { name: 'Wallet connection check' }).waitFor();
  else await page.getByText('Connect your wallet', { exact: true }).waitFor();
  return { context, page, errors, consoleErrors, socketMethods, apiRequests, get proof() { return proof; }, get typedData() { return typedData; }, get signatures() { return signatures; } };
}

async function restorePreviousWalletConnectConnection(page) {
  // Wagmi persists connector metadata, not its methods or the new page's UID.
  // This used to repopulate AppKit's connected-wallet list even though both the
  // verification page and enableReconnect: false considered it disconnected.
  await page.evaluate(address => {
    const uid = 'previous-page-walletconnect';
    localStorage.setItem('wagmi.store', JSON.stringify({ version: 3, state: {
      chainId: 1, current: uid,
      connections: { __type: 'Map', value: [[uid, {
        accounts: [address], chainId: 1,
        connector: { id: 'walletConnect', name: 'WalletConnect', type: 'walletConnect', uid },
      }]] },
    } }));
    localStorage.setItem('@appkit/eip155:connected_connector_id', 'walletConnect');
    localStorage.setItem('@appkit/connection_status', 'connected');
    localStorage.setItem('@appkit/connected_namespaces', 'eip155');
    localStorage.setItem('@appkit/connections', JSON.stringify({ eip155: [
      { connectorId: 'walletConnect', accounts: [{ address }] },
    ] }));
  }, account.address);
  await page.reload();
  await page.getByText('Connect your wallet', { exact: true }).waitFor();
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env['CHROME_BIN'], headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    for (const mobile of [false, true]) {
      currentScenario = `${mobile ? 'mobile' : 'desktop'} injected wallet connection`;
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
      // A second visit reuses the approved wallet but still requires a signature.
      const nextNonce = 'b'.repeat(64);
      await page.goto(origin + '/verify/' + nextNonce);
      await page.getByText('Connect your wallet', { exact: true }).waitFor();
      assert.equal(test.signatures, 1, 'Restoring a session must not sign automatically');
      await page.getByRole('button', { name: 'Sign Message', exact: true }).click();
      await page.locator('.step-3.active').waitFor();
      assert.equal(test.signatures, 2, 'A fresh verification must request another signature');
      assert.equal(test.typedData.message.Nonce, nextNonce);
      assert.equal((await recoverTypedDataAddress({ ...test.typedData, signature: test.proof.signature })).toLowerCase(), account.address.toLowerCase());
      // Changing wallets is deliberate, rather than a side effect of loading a link.
      currentScenario = `${mobile ? 'mobile' : 'desktop'} injected wallet change`;
      await page.reload();
      await page.getByRole('button', { name: 'Change wallet', exact: true }).click();
      await page.getByText('Test Wallet', { exact: true }).last().click();
      await page.getByRole('button', { name: 'Sign Message', exact: true }).click();
      await page.locator('.step-3.active').waitFor();
      assert.deepEqual(test.errors, []);
      await page.screenshot({ path: path.join(artifacts, (mobile ? 'phone' : 'desktop') + '.png'), fullPage: true });
      console.log(JSON.stringify({ scenario: mobile ? 'mobile-injected-signature' : 'desktop-injected-signature', result: 'passed' }));
      await test.context.close();
    }
    currentScenario = 'AppKit signing diagnostics';
    {
      const test = await setup(browser, true, true, '/wallet-check');
      const { page } = test;
      await page.getByRole('button', { name: 'Start connection', exact: true }).click();
      await page.getByText('Test Wallet', { exact: true }).last().click();
      await page.getByRole('button', { name: 'Test signature', exact: true }).waitFor();
      assert.equal(test.signatures, 0, 'Restoring or connecting must not sign automatically');
      await page.getByRole('button', { name: 'Test signature', exact: true }).click();
      await page.getByText('Signature received successfully', { exact: true }).waitFor();
      assert.equal(test.typedData.domain.name, 'Bouncer Wallet Check');
      assert.equal(test.typedData.primaryType, 'WalletCheck');
      const firstChallenge = test.typedData.message.Challenge;
      await page.getByRole('button', { name: 'Test signature', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('textarea').value.match(/Signature received/g)?.length === 2);
      assert.equal(test.signatures, 2);
      assert.notEqual(test.typedData.message.Challenge, firstChallenge);
      const report = await page.getByRole('textbox', { name: 'Connection details', exact: true }).inputValue();
      assert(!report.includes(account.address));
      assert(!report.includes(firstChallenge));
      assert(!report.includes(test.typedData.message.Challenge));
      assert.deepEqual(test.apiRequests, [], 'Signing diagnostics must not call the verification API');
      assert.deepEqual(test.errors, []);
      console.log(JSON.stringify({ scenario: 'appkit-signing-diagnostics', result: 'passed' }));
      await test.context.close();
    }
    for (const direct of [false, true]) {
      currentScenario = direct ? 'direct diagnostics' : 'AppKit diagnostics';
      const test = await setup(browser, true, false, '/wallet-check' + (direct ? '?mode=direct' : ''));
      const { page } = test;
      await page.getByRole('button', { name: 'Start connection', exact: true }).click();
      if (direct) {
        const link = await page.getByRole('link', { name: 'Open Rainbow', exact: true }).getAttribute('href');
        assert(new URL(link).searchParams.get('uri').startsWith('wc:'));
      } else {
        await page.getByText('Rainbow', { exact: true }).last().click();
        await page.waitForFunction(() => document.querySelector('textarea').value.includes('Pairing link created'));
      }
      const report = await page.getByRole('textbox', { name: 'Connection details', exact: true }).inputValue();
      assert(/Relay (?:already )?connected/.test(report), report);
      assert(!report.includes('wc:'));
      assert(!report.includes('symKey'));
      assert(!report.includes(account.address));
      assert.deepEqual(test.apiRequests, [], 'Connection diagnostics must not request verification contexts or mutate Discord roles');
      assert.deepEqual(test.errors, []);
      console.log(JSON.stringify({ scenario: direct ? 'isolated-walletconnect-diagnostics' : 'appkit-connection-diagnostics', result: 'passed' }));
      await test.context.close();
    }
    for (const previousConnection of [false, true]) {
      currentScenario = previousConnection ? 'saved-session retry' : 'fresh-session retry';
      const test = await setup(browser, true, false);
      const { page } = test;
      let handoff;
      await page.exposeFunction('__testWalletHandoff', url => { handoff = url; });
      await page.addInitScript(() => {
        // Capture the link without invoking the OS. Headless Chrome has no
        // wallet app to return from, which otherwise interferes with retry taps.
        const open = window.open;
        window.open = (url, ...args) => {
          if (String(url).startsWith('rainbow:')) {
            window.__testWalletHandoff(String(url));
            return null;
          }
          return open.call(window, url, ...args);
        };
      });
      if (previousConnection) await restorePreviousWalletConnectConnection(page);
      else {
        await page.reload();
        await page.getByText('Connect your wallet', { exact: true }).waitFor();
      }
      await page.locator('.step-1 .actions button').click();
      const rainbowRow = page.locator('w3m-list-wallet[name="Rainbow"]');
      await rainbowRow.waitFor();
      assert.equal(await rainbowRow.getAttribute('disabled'), null, 'Rainbow must be selectable, including after a saved connection');
      assert.equal(await page.getByRole('button', { name: /Search Wallet/ }).isEnabled(), true);
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
      await page.screenshot({ path: path.join(artifacts, previousConnection ? 'rainbow-after-saved-session.png' : 'rainbow-mobile.png'), fullPage: true });
      // Dismissing an unapproved request must allow another wallet choice.
      const previousHandoff = handoff;
      handoff = undefined;
      await page.getByTestId('w3m-header-close').getByRole('button').click();
      await page.locator('.step-1 .actions button').click();
      assert.equal(await rainbowRow.getAttribute('disabled'), null);
      await page.getByText('Rainbow', { exact: true }).last().click();
      for (let n = 0; n < 40 && !handoff; n++) await page.waitForTimeout(250);
      assert(handoff, 'Expected another Android Rainbow app handoff after dismissing the first request');
      assert(handoff !== previousHandoff, 'A retry should use a fresh pairing URI');
      assert.deepEqual(test.errors, []);
      console.log(JSON.stringify({ scenario: previousConnection ? 'android-rainbow-after-saved-connection-and-retry' : 'android-rainbow-deep-link-and-retry', result: 'passed' }));
      await test.context.close();
    }
  } finally { await browser.close(); console.log(`Browser screenshots: ${artifacts}`); }
})().catch(error => { console.error(`${currentScenario}: ${error.message}`); process.exitCode = 1; });
