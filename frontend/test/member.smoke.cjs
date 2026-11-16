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
            jobs: [{ id: 'failed-role-check', community: 'NoMoreLabs', status: 'failed', result: { verified: 25, revoked: 1, errors: 4 } }],
          },
        ],
        pending = null,
        failRemoval = false, failSharing = false;
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
                  network: 8453,
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
                      domain: { name: 'Bouncer', version: '2', chainId: 1 },
                      types: {
                        WalletLink: [
                          { name: 'Purpose', type: 'string' },
                          { name: 'Domain', type: 'string' },
                          { name: 'Address', type: 'address' },
                          { name: 'Nonce', type: 'string' },
                          { name: 'Expiry', type: 'uint256' },
                        ],
                      },
                      primaryType: 'WalletLink',
                      message: {
                        Purpose: 'Link wallet to Bouncer',
                        Domain: origin,
                        Address: posted.address.toLowerCase(),
                        Nonce: nonce,
                        Expiry: expiry,
                      },
                    }
                  : 'Bouncer saved-wallet link\nDomain: ' + origin + '\nNetwork: Bitcoin mainnet',
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
          } else if (p === '/member/wallet-sharing') {
            if (failSharing) { failSharing=false; return route.fulfill({status:503,json:{message:'Could not save wallet sharing.'}}); }
            assert.equal(typeof posted.enabled,'boolean');
            const wallet=wallets.find(w=>w.address===posted.address);
            assert(wallet && communities.some(c=>c.id===posted.server));
            wallet.communities ||= [];
            const scope=wallet.communities.find(c=>c.server_id===posted.server);
            if(scope) scope.enabled=posted.enabled;
            else wallet.communities.push({server_id:posted.server,source:'member',enabled:posted.enabled,shared_at:new Date().toISOString()});
            body={ok:true};
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
      assert.ok((await page.locator('.community-role').filter({ hasText: 'Collector role' }).textContent()).includes('Base'));
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
      const communitySearch = page.getByRole('searchbox');
      const searchIcon = page.locator('.search-field > img');
      assert.equal(await searchIcon.getAttribute('src'), '/assets/search.png');
      assert.equal(
        await searchIcon.evaluate(
          (icon) => getComputedStyle(icon).imageRendering,
        ),
        'pixelated',
      );
      const fieldBox = await communitySearch.boundingBox(),
        iconBox = await searchIcon.boundingBox();
      assert(
        Math.abs(
          iconBox.y + iconBox.height / 2 - fieldBox.y - fieldBox.height / 2,
        ) < 1,
        'Search icon centered in field',
      );
      await communitySearch.fill('absent');
      await page.getByText('No communities match your search.').waitFor();
      await page.getByRole('searchbox').fill('');
      await page.getByRole('button', { name: 'Wallets', exact: true }).click();
      await page
        .locator('.wallet-activity')
        .filter({ hasText: 'Verified' })
        .getByText('Discord · NoMoreLabs · #verify', { exact: true })
        .waitFor();
      await page.getByText(/NoMoreLabs: failed/).waitFor();
      assert.equal((await page.locator('.wallet-activity .wallet-address-inline').first().textContent()).trim(), account.address);
      assert.equal(await page.getByRole('button', { name: /Retry.*check/i }).count(), 0,
        'Failed wallet activity is informational; members cannot retry ownership jobs');
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
        message: 'Bouncer saved-wallet link\nDomain: ' + origin + '\nNetwork: Bitcoin mainnet',
        type: 'bip322-simple',
      });
      const evmCard = page.locator('.saved-wallet').filter({ hasText: 'EVM' });
      const walletHeadings = await page.locator('.saved-wallet h2.wallet-address').allTextContents();
      assert.deepEqual(walletHeadings.map(value => value.trim()).sort(), wallets.map(wallet => wallet.address).sort(),
        'Wallet cards retain complete addresses for responsive display');
      if (width === 1280) {
        for (const heading of await page.locator('.saved-wallet h2.wallet-address').all()) {
          const size = await heading.evaluate(el=>({available:el.clientWidth,full:el.scrollWidth}));
          assert.ok(size.available >= size.full, 'Full wallet address is visible when desktop space allows');
        }
      }

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
      wallets.push({
        address: '0x' + 'cd'.repeat(20),
        wallet_type: 'evm',
        last_verified_at: new Date().toISOString(),
        evm_chain_ids: [1, 8453, 4663],
        checking: [{server_id: server, server_name: 'NoMoreLabs', network: 'ethereum', network_name: 'Ethereum', empty_checked_at: '2026-11-09T12:00:00Z'}],
      });
      await page.reload();
      await page.getByRole('button', { name: 'Wallets', exact: true }).click();
      const smartCard = page.locator('.saved-wallet').filter({ hasText: 'Smart wallet' });
      await smartCard.waitFor();
      assert((await smartCard.innerText()).includes('Proven networks: Ethereum, Base, Robinhood'));
      assert(!(await smartCard.innerText()).includes('Checks paused'), 'All-wallets view has no combined dormancy warnings');
      const secondServer='666666666666666666';
      communities[0].privacy={sharing_enabled:true,share_since:'2020-01-01',export_since:'2020-01-01'};
      communities.push({...communities[0],id:secondServer,name:'Other community'});
      const smartWallet=wallets.find(w=>w.evm_chain_ids?.length);
      smartWallet.communities=[{server_id:server,source:'legacy',enabled:true,shared_at:new Date().toISOString()},{server_id:secondServer,source:'verification',enabled:true,shared_at:new Date().toISOString()}];
      smartWallet.checking.push({server_id:secondServer,server_name:'Other community',network:'base',network_name:'Base',empty_checked_at:'2026-11-09T12:00:00Z'});
      await page.reload();
      await page.getByRole('button',{name:'Wallets',exact:true}).click();
      const walletView=page.getByRole('combobox',{name:'Wallet view',exact:true});
      assert.equal((await walletView.textContent()).trim(),'All wallets');
      await walletView.click();
      await page.getByRole('option',{name:'NoMoreLabs',exact:true}).click();
      assert((await smartCard.innerText()).includes('Checks paused'));
      assert((await smartCard.innerText()).includes('Ethereum'));
      assert(!(await smartCard.innerText()).includes('Checks paused · Base'));
      const countBeforeSharing=signatures;
      failSharing=true;
      await smartCard.getByLabel('Allow sharing this wallet with NoMoreLabs').uncheck();
      await page.getByText('Could not save wallet sharing.',{exact:true}).waitFor();
      assert.equal(await smartCard.getByLabel('Allow sharing this wallet with NoMoreLabs').isChecked(),true,'Failed sharing changes restore the real setting');
      await page.getByRole('button',{name:'Dismiss',exact:true}).click();
      await smartCard.getByLabel('Allow sharing this wallet with NoMoreLabs').uncheck();
      await page.getByText('Wallet hidden from this community’s admin views and exports. Private role checks continue.',{exact:true}).waitFor();
      assert.equal(smartWallet.communities.find(c=>c.server_id===server).enabled,false);
      assert.equal(smartWallet.communities.find(c=>c.server_id===secondServer).enabled,true);
      assert.equal(signatures,countBeforeSharing,'Sharing never requests another proof');
      await page.getByRole('button',{name:'Dismiss',exact:true}).click();
      await walletView.click();
      await page.getByRole('option',{name:'Other community',exact:true}).click();
      assert((await smartCard.innerText()).includes('Checks paused'));
      assert((await smartCard.innerText()).includes('Base'));
      assert.equal(await smartCard.getByLabel('Allow sharing this wallet with Other community').isChecked(),true);
      assert.equal(await smartCard.getByText('This wallet keeps its previous sharing settings until you verify it again.',{exact:true}).count(),0);

      assert((await smartCard.innerText()).includes('Sign with this wallet again to resume checks.'));
      assert(!(await smartCard.innerText()).includes('additional empty wallet'));
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
      // Rule removal must not hide a wallet's existing sharing controls.
      communities.find(c=>c.id===secondServer).channels=[];
      await page.reload();
      await page.getByRole('button',{name:'Wallets',exact:true}).click();
      await page.getByRole('combobox',{name:'Wallet view',exact:true}).click();
      await page.getByRole('option',{name:'Other community',exact:true}).click();
      assert.equal(await page.locator('.saved-wallet').count(),1,'Associated wallet stays manageable without matching rules');
      await smartCard.getByLabel('Allow sharing this wallet with Other community').uncheck();
      await page.getByText('Wallet hidden from this community’s admin views and exports. Private role checks continue.',{exact:true}).waitFor();
      assert.equal(await page.locator('.saved-wallet').count(),1,'Opting out does not hide the re-enable control');
      assert.equal(await smartCard.getByLabel('Allow sharing this wallet with Other community').isChecked(),false);
      await page.getByRole('button',{name:'Dismiss',exact:true}).click();
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
