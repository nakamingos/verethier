const { chromium } = require('playwright-core');
const { privateKeyToAccount } = require('viem/accounts');
const { recoverTypedDataAddress } = require('viem');
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../dist/frontend/browser');
const artifacts = fs.mkdtempSync('/tmp/bouncer-member-smoke-');
const account = privateKeyToAccount('0x' + '11'.repeat(32));
const bitcoin =
  'bc1pss0zhytly75awhm6x2hhvd5lnzv3vssgrf9axfheq8ldyzn88ges79fler';
const origin = 'https://bouncer.test',
  server = '222222222222222222',
  channel = '333333333333333333',
  nonce = 'a'.repeat(64);
const flowId = 'aaaaaaaa-0000-4000-8000-000000000001';
const user = { id: '111111111111111111', name: 'Collector' };
const expiry = Math.floor(Date.now() / 1000) + 600;
(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_BIN ||
      '/home/snep/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
    headless: true,
    args: ['--no-sandbox'],
  });
  try {
    for (const width of [1280, 393, 320]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        hasTouch: width < 800,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const errors = [],
        requests = [];
      let signedIn = true,
        signatures = 0,
        flow,
        wallets = [],
        actions = [
          {
            id: 'discord-event',
            kind: 'wallet_verify',
            address: account.address,
            source: 'discord',
            community: 'NoMoreLabs',
            channel: 'verify',
            created_at: '2026-10-18T12:00:00Z',
            jobs: [],
          },
        ],
        pending = null,
        failRemoval = false;
      const communities = [
        {
          id: server,
          name: 'NoMoreLabs',
          icon: null,
          defaultChannel: channel,
          channels: [
            {
              id: channel,
              name: 'verify',
              rules: [
                {
                  id: '1',
                  role: 'Holder',
                  roleId: 'role',
                  earned: true,
                  previouslyEarned: true,
                  asset: 'ethscription',
                  collection: 'nakamingos',
                  minimum: 1,
                },
                {
                  id: '2',
                  roleId: 'collector',
                  role: 'Collector role',
                  earned: false,
                  previouslyEarned: false,
                  asset: 'ethscription',
                  collection: 'nakamingos',
                  minimum: 2,
                },
                {
                  id: '3',
                  roleId: 'collector',
                  role: 'Collector role',
                  earned: false,
                  previouslyEarned: false,
                  asset: 'nft',
                  network: 1,
                  collection: 'Combined collection',
                  minimum: 2,
                },
                {
                  id: '4',
                  roleId: 'alumni',
                  role: 'Alumni',
                  earned: false,
                  previouslyEarned: true,
                  asset: 'ethscription',
                  collection: 'Old collection',
                  minimum: 1,
                },
              ],
            },
            {
              id: '444444444444444444',
              name: 'other-channel',
              rules: [
                {
                  id: '5',
                  roleId: 'side',
                  role: 'Side role',
                  earned: false,
                  previouslyEarned: false,
                  asset: 'ordinal',
                  collection: 'Other collection',
                  minimum: 1,
                },
              ],
            },
          ],
          roles: [{ id: 'role', name: 'Holder', status: 'active' }],
        },
      ];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.exposeFunction('__testSign', (data) => {
        signatures++;
        return account.signTypedData(data);
      });
      await page.addInitScript(
        ({ address, bitcoin }) => {
          const listeners = new Map();
          let authorized = false;
          const provider = {
            on: (name, fn) =>
              listeners.set(name, [...(listeners.get(name) || []), fn]),
            removeListener: () => {},
            request: async ({ method, params }) => {
              if (method === 'eth_chainId') return '0x1';
              if (method === 'eth_accounts') return authorized ? [address] : [];
              if (
                method === 'eth_requestAccounts' ||
                method === 'wallet_requestPermissions'
              ) {
                authorized = true;
                return method === 'eth_requestAccounts'
                  ? [address]
                  : [{ parentCapability: 'eth_accounts' }];
              }
              if (method === 'wallet_getCapabilities') return {};
              if (method === 'eth_signTypedData_v4')
                return window.__testSign(JSON.parse(params[1]));
              throw Object.assign(new Error('Unsupported test method'), {
                code: 4200,
              });
            },
          };
          window.ethereum = provider;
          const announce = () =>
            dispatchEvent(
              new CustomEvent('eip6963:announceProvider', {
                detail: {
                  info: {
                    uuid: 'b121fd92-aad7-42d3-afbe-88e14ca6b211',
                    name: 'Test Wallet',
                    rdns: 'test.bouncer.wallet',
                    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
                  },
                  provider,
                },
              }),
            );
          addEventListener('eip6963:requestProvider', announce);
          announce();
          window.unisat = {
            requestAccounts: async () => [bitcoin],
            getAccounts: async () => [bitcoin],
            getChain: async () => ({ enum: 'BITCOIN_MAINNET' }),
            on: () => {},
            removeListener: () => {},
            signMessage: async (message, type) => {
              window.__bitcoinMessage = { message, type };
              return 'test-bip322-proof';
            },
          };
        },
        { address: account.address, bitcoin },
      );
      await page.routeWebSocket('**', (socket) => {
        socket.onMessage((raw) => {
          const reply = (m) =>
            socket.send(
              JSON.stringify({
                jsonrpc: '2.0',
                id: m.id,
                result: m.method?.includes('batchSubscribe')
                  ? m.params.topics.map(() => 'subscription')
                  : 'subscription',
              }),
            );
          const m = JSON.parse(raw);
          Array.isArray(m) ? m.forEach(reply) : reply(m);
        });
      });
      await page.route('**/*', async (route) => {
        const req = route.request(),
          url = new URL(req.url());
        let body,
          status = 200;
        if (url.pathname.startsWith('/api/portal')) {
          const p = url.pathname.replace('/api/portal', '');
          const posted = req.method() === 'POST' ? req.postDataJSON() : null;
          requests.push({ p, posted, csrf: req.headers()['x-csrf-token'] });
          if (p === '/session')
            body = {
              user: signedIn ? user : null,
              csrf: 'csrf',
              configured: true,
            };
          else if (p === '/auth/logout') {
            signedIn = false;
            body = { ok: true };
          } else if (p === '/member')
            body = {
              wallets,
              communities,
              counts: { wallets: wallets.length, communities: 1, roles: 1 },
              actions,
              pending,
            };
          else if (p === '/member/wallet-challenge') {
            flow = {
              id: flowId,
              address: posted.address.toLowerCase(),
              walletType: posted.walletType,
              expiresAt: new Date(expiry * 1000).toISOString(),
              challenge:
                posted.walletType === 'evm'
                  ? {
                      domain: { name: 'Bouncer', version: '1', chainId: 1 },
                      types: {
                        WalletLink: [
                          { name: 'Purpose', type: 'string' },
                          { name: 'UserID', type: 'string' },
                          { name: 'Nonce', type: 'string' },
                          { name: 'Expiry', type: 'uint256' },
                        ],
                      },
                      primaryType: 'WalletLink',
                      message: {
                        Purpose: 'Link wallet to Bouncer',
                        UserID: user.id,
                        Nonce: nonce,
                        Expiry: expiry,
                      },
                    }
                  : 'Bouncer saved-wallet link\nDiscord user: ' + user.id,
            };
            body = flow;
            pending = {
              id: flowId,
              purpose: 'wallet_link',
              address: flow.address,
              expiresAt: flow.expiresAt,
            };
          } else if (p === '/member/wallet-proof') {
            assert.equal(posted.flow, flowId);
            if (flow.walletType === 'evm') {
              assert.equal(
                (
                  await recoverTypedDataAddress({
                    ...flow.challenge,
                    signature: posted.signature,
                  })
                ).toLowerCase(),
                account.address.toLowerCase(),
              );
              if (!posted.transfer) {
                body = { requiresTransfer: true };
                return route.fulfill({ json: body });
              }
            } else assert.equal(posted.signature, 'test-bip322-proof');
            wallets.push({
              address: flow.address,
              wallet_type: flow.walletType,
              last_verified_at: new Date().toISOString(),
            });
            pending = null;
            body = { linked: true, transferred: !!posted.transfer };
          } else if (p === '/member/wallet-removal' && !posted)
            body = {
              address: url.searchParams.get('address'),
              communities: [{ id: server, name: 'NoMoreLabs' }],
            };
          else if (p === '/member/wallet-removal') {
            if (failRemoval) {
              status = 503;
              body = { message: 'Please retry removal.' };
              failRemoval = false;
            } else {
              wallets = wallets.filter((w) => w.address !== posted.address);
              actions = [
                {
                  id: posted.requestId,
                  kind: 'wallet_remove',
                  address: posted.address,
                  created_at: new Date().toISOString(),
                  jobs: [
                    { id: 'job', community: 'NoMoreLabs', status: 'pending' },
                  ],
                },
              ];
              body = { removed: true };
            }
          } else if (p === '/member/verify') {
            assert.deepEqual(posted, { server, channel });
            pending = {
              id: flowId,
              purpose: 'verify',
              server,
              channel,
              expiresAt: new Date(expiry * 1000).toISOString(),
            };
            body = { url: '/verify/' + nonce + '?from=member' };
          } else if (p === '/member/resume')
            body = { url: '/verify/' + nonce + '?from=member' };
          else {
            throw new Error('Unexpected portal path ' + p);
          }
          return route.fulfill({ status, json: body });
        }
        if (url.pathname === '/api/verification-context')
          return route.fulfill({
            json: {
              walletTypes: ['evm'],
              expiry,
              data: {
                userId: user.id,
                userTag: user.name,
                avatar: '',
                discordId: server,
                discordName: 'NoMoreLabs',
                discordIcon: '',
                nonce,
              },
            },
          });
        if (url.origin === origin) {
          const file = path.resolve(root, '.' + url.pathname);
          const found =
            file.startsWith(root + '/') &&
            fs.existsSync(file) &&
            fs.statSync(file).isFile()
              ? file
              : path.join(root, 'index.html');
          return route.fulfill({ path: found });
        }
        if (url.pathname === '/appkit/v1/config')
          return route.fulfill({ json: { features: [] } });
        if (url.pathname === '/appkit/v1/project-limits')
          return route.fulfill({ json: { planLimits: { tier: 'starter' } } });
        if (url.pathname === '/getWallets')
          return route.fulfill({ json: { data: [], count: 0 } });
        return route.fulfill({ json: {} });
      });
      await page.goto(origin + '/member');
      await page.getByRole('heading', { name: 'Welcome, Collector' }).waitFor();
      assert.equal(signatures, 0, 'Dashboard rendering must not sign');
      assert(
        !requests.some((r) => r.p.includes('verify')),
        'Dashboard rendering must not run ownership checks',
      );
      await page
        .getByRole('button', { name: 'View communities', exact: true })
        .click();
      await page
        .locator('.community-role')
        .filter({ hasText: 'Collector role' })
        .waitFor();
      assert.equal(
        await page.locator('.community-role').count(),
        2,
        'Available roles are grouped and exclude earned roles',
      );
      assert.equal(
        await page
          .locator('.community-role')
          .filter({ hasText: 'Collector role' })
          .locator('li')
          .count(),
        2,
        'Combined requirements remain grouped under their role',
      );
      const reads = requests.length;
      async function choose(label, option) {
        await page
          .getByRole('combobox', { name: label, exact: true })
          .locator('.pixel-select-arrow')
          .click();
        await page.getByRole('option', { name: option, exact: true }).click();
      }
      await choose('Show roles', 'Earned roles');
      assert.equal(await page.locator('.community-role').count(), 1);
      await page
        .locator('.community-role')
        .filter({ hasText: 'Holder' })
        .waitFor();
      await choose('Verification channel', '#other-channel');
      await page.getByText('No earned roles in this channel yet.').waitFor();
      await choose('Show roles', 'Available roles');
      await page
        .locator('.community-role')
        .filter({ hasText: 'Side role' })
        .waitFor();
      await choose('Verification channel', '#verify');
      await page
        .locator('.community-role')
        .filter({ hasText: 'Collector role' })
        .waitFor();
      assert.equal(
        requests.length,
        reads,
        'Role/channel switches do not start backend ownership scans',
      );
      await page.screenshot({
        path: path.join(artifacts, width + '-communities.png'),
        fullPage: true,
      });
      await page.getByRole('searchbox').fill('absent');
      await page.getByText('No communities match your search.').waitFor();
      await page.getByRole('searchbox').fill('');
      await page.getByRole('button', { name: 'Wallets', exact: true }).click();
      await page
        .locator('.wallet-activity')
        .filter({ hasText: 'Verified' })
        .getByText('Discord · NoMoreLabs · #verify', { exact: true })
        .waitFor();
      await page
        .getByRole('button', { name: 'Add wallet', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Connect wallet', exact: true })
        .click();
      await page.getByText('Test Wallet', { exact: true }).last().click();
      await page
        .getByRole('button', { name: 'Sign & link wallet', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Confirm transfer', exact: true })
        .waitFor();
      assert.equal(signatures, 1);
      assert.equal(
        wallets.length,
        0,
        'No transfer before explicit confirmation',
      );
      await page
        .getByRole('button', { name: 'Confirm transfer', exact: true })
        .click();
      await page
        .getByRole('button', {
          name: 'Remove wallet from Bouncer',
          exact: true,
        })
        .waitFor();
      assert.equal(
        signatures,
        1,
        'Transfer confirmation uses the still-valid fresh proof',
      );
      await page
        .getByRole('button', { name: 'Add wallet', exact: true })
        .click();
      await page
        .getByRole('combobox', { name: 'Wallet type' })
        .locator('.pixel-select-arrow')
        .click();
      await page
        .getByRole('option', { name: 'Bitcoin · UniSat', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Connect wallet', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Sign & link wallet', exact: true })
        .click();
      await page.waitForFunction(
        () => document.querySelectorAll('.saved-wallet').length === 2,
      );
      assert.deepEqual(await page.evaluate(() => window.__bitcoinMessage), {
        message: 'Bouncer saved-wallet link\nDiscord user: ' + user.id,
        type: 'bip322-simple',
      });
      const evmCard = page.locator('.saved-wallet').filter({ hasText: 'EVM' });
      await evmCard
        .getByRole('button', {
          name: 'Remove wallet from Bouncer',
          exact: true,
        })
        .click();
      await page.getByRole('heading', { name: /Remove 0x/ }).waitFor();
      failRemoval = true;
      await page
        .getByRole('button', { name: 'Confirm removal', exact: true })
        .click();
      await page.getByText('Please retry removal.', { exact: true }).waitFor();
      await page
        .getByRole('button', { name: 'Confirm removal', exact: true })
        .click();
      await page.getByText('Wallet activity', { exact: true }).waitFor();
      assert.equal(wallets.length, 1, 'Removal keeps the other wallet');
      const removes = requests.filter(
        (r) => r.p === '/member/wallet-removal' && r.posted,
      );
      assert.equal(
        removes[0].posted.requestId,
        removes[1].posted.requestId,
        'Retry keeps the same idempotency key',
      );
      await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
      await page
        .getByRole('button', { name: 'Communities', exact: true })
        .click();
      await page.getByRole('button', { name: 'Verify', exact: true }).click();
      await page
        .getByRole('link', { name: 'Back to member portal', exact: true })
        .waitFor();
      await page
        .getByRole('link', { name: 'Back to member portal', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Continue', exact: true })
        .waitFor();
      await page.getByRole('button', { name: 'Not now', exact: true }).click();
      assert.equal(
        await page
          .getByRole('button', { name: 'Continue', exact: true })
          .count(),
        0,
      );
      await page.reload();
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page
        .getByRole('link', { name: 'Back to member portal', exact: true })
        .click();
      await page.getByRole('button', { name: 'Wallets', exact: true }).click();
      await page.locator('.saved-wallet').waitFor();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        'No horizontal overflow',
      );
      await page.screenshot({
        path: path.join(artifacts, width + '-dark.png'),
        fullPage: true,
      });
      await page
        .getByRole('button', { name: 'Light theme', exact: true })
        .click();
      await page.screenshot({
        path: path.join(artifacts, width + '-light.png'),
        fullPage: true,
      });
      assert(
        requests.filter((r) => r.posted).every((r) => r.csrf === 'csrf'),
        'Every mutation carries CSRF',
      );
      assert.deepEqual(errors, []);
      await page.getByRole('button', { name: /Sign out ·/ }).click();
      await page
        .getByRole('heading', { name: 'Your wallets. Your communities.' })
        .waitFor();
      assert.equal(await page.locator('.saved-wallet').count(), 0);
      assert.equal(
        await page
          .getByRole('link', { name: 'Sign in with Discord' })
          .first()
          .getAttribute('href'),
        '/api/portal/auth/login?return_to=/member',
      );
      console.log(JSON.stringify({ width, result: 'passed' }));
      await context.close();
    }
    console.log('Artifacts: ' + artifacts);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
