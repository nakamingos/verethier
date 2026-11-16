const { chromium } = require('playwright-core');
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../dist/frontend/browser');
const server = '111111111111111111',
  channel = '222222222222222222',
  role = '333333333333333333',
  contract = '0x' + '1'.repeat(40);
const selections = {
  '1,3-5,0003': ['1', '3', '4', '5'],
  '3-5,7': ['3', '4', '5', '7'],
};
function display(r) {
  return {
    ...r,
    version: 'v' + r.min_items,
    fields: [
      {
        key: 'token_ids',
        label: 'Token IDs (blank = any)',
        value: r.token_ids[0] === '1' ? '1,3-5' : '3-5,7',
        list: true,
      },
      { key: 'trait_filter', label: 'Trait conditions', value: 'null' },
      {
        key: 'min_items',
        label: 'Minimum items',
        value: String(r.min_items),
        required: true,
      },
    ],
  };
}
async function choose(page, name, value) {
  await page
    .getByRole('combobox', { name, exact: true })
    .last()
    .locator('.pixel-select-arrow')
    .click();
  await page.getByRole('option', { name: value, exact: true }).click();
}
(async () => {
  const browser = await chromium.launch({
    executablePath:
      '/home/snep/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
    headless: true,
    args: ['--no-sandbox'],
  });
  try {
    for (const [width, network, networkLabel, chainId] of [1280, 393, 320].flatMap(width => [
      [width, 'ethereum', 'Ethereum', 1], [width, 'base', 'Base', 8453],
    ])) {
      const context = await browser.newContext({
          viewport: { width, height: 900 },
        }),
        page = await context.newPage(),
        errors = [],
        requests = [],
        actions = new Map();
      let rules = [],
        sequence = 0;
      page.setDefaultTimeout(15000);
      page.on('pageerror', (e) => errors.push(e.message));
      await page.addInitScript(
        (id) => sessionStorage.setItem('bouncer-admin-server', id),
        server,
      );
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.startsWith('/api/portal')) {
          const p = url.pathname.slice('/api/portal'.length),
            body = route.request().postDataJSON();
          let data = {};
          if (p === '/session')
            data = {
              user: { id: '444444444444444444', name: 'Admin' },
              csrf: 'test',
              configured: true,
            };
          else if (p === '/servers')
            data = {
              servers: [{ id: server, name: 'Community', installed: true }],
            };
          else if (p === `/servers/${server}`)
            data = {
              server: { id: server, name: 'Community' },
              rules: rules.map(display),
              channels: [{ id: channel, name: 'verify' }],
              roles: [{ id: role, name: 'Holder', manageable: true }],
              settings: {
                verification_channel_id: channel,
                background_checks_enabled: true,
              },
              role_actions: [],
              diagnostics: [],
              capabilities: { multi_trait: true },
            };
          else if (p.endsWith('/suggestions')) data = { values: [] };
          else if (p.endsWith('/rules')) {
            requests.push({ p, body });
            if (body.asset_type === 'erc20') {
              assert.deepEqual(body, {
                asset_type: 'erc20', channel_id: channel, request_id: body.request_id,
                role_id: role, contract_address: contract, network, min_balance: '0.5',
              });
              return route.fulfill({ json: { id: String(++sequence) } });
            }
            assert.deepEqual(body, {
              asset_type: 'nft',
              channel_id: channel,
              request_id: body.request_id,
              role_id: role,
              contract_address: contract,
              network,
              token_ids: '1,3-5,0003',
              min_items: 3,
              trait_filter: null,
            });
            const rule = {
              id: 1,
              server_id: server,
              channel_id: channel,
              role_id: role,
              role_name: 'Holder',
              asset_type: 'nft',
              chain_id: chainId,
              contract_address: contract,
              collection_name: 'Collection',
              token_standard: 'erc721',
              token_ids: selections[body.token_ids],
              min_items: body.min_items,
              trait_filter: null,
            };
            rules = [rule];
            data = {
              id: String(++sequence),
              before: null,
              after: structuredClone(rule),
            };
            actions.set(data.id, data);
          } else if (p.endsWith('/rules/1/edit')) {
            requests.push({ p, body });
            const before = structuredClone(rules[0]);
            rules[0] = {
              ...before,
              token_ids: selections[body.inputs.token_ids],
              min_items: Number(body.inputs.min_items),
            };
            data = {
              id: String(++sequence),
              before,
              after: structuredClone(rules[0]),
            };
            actions.set(data.id, data);
          } else if (/\/actions\/\d+\/reverse$/.test(p)) {
            const action = actions.get(p.split('/').at(-2));
            assert.ok(action);
            rules = action.before ? [structuredClone(action.before)] : [];
            data = {
              id: String(++sequence),
              before: action.after,
              after: action.before,
            };
            actions.set(data.id, data);
          } else if (p.endsWith('/activity'))
            data = { items: [], page: 1, pages: 1, total: 0 };
          return route.fulfill({ json: data });
        }
        const file = path.join(
          root,
          url.pathname === '/' || !path.extname(url.pathname)
            ? 'index.html'
            : url.pathname.slice(1),
        );
        if (!file.startsWith(root) || !fs.existsSync(file))
          return route.fulfill({ status: 404, body: '' });
        return route.fulfill({
          path: file,
          contentType:
            {
              '.html': 'text/html',
              '.js': 'text/javascript',
              '.css': 'text/css',
              '.png': 'image/png',
              '.svg': 'image/svg+xml',
              '.woff2': 'font/woff2',
            }[path.extname(file)] || 'application/octet-stream',
        });
      });
      await page.goto('https://bouncer.test/admin');
      await page.getByRole('button', {name:'Rules',exact:true}).click();
      await page
        .getByRole('button', { name: '+ Add rule', exact: true })
        .click();
      await choose(page, 'Asset type', 'NFTs');
      await choose(page, 'Network', networkLabel);
      await choose(page, 'Discord role', 'Holder');
      await page
        .getByLabel('Contract address:', { exact: true })
        .fill(contract);
      await page
        .getByLabel('Token IDs (optional):', { exact: true })
        .fill('1,3-5,0003');
      await page.getByLabel('Minimum items:', { exact: true }).fill('3');
      await page
        .getByRole('button', { name: '+ Add rule', exact: true })
        .click();
      await page
        .getByRole('button', { name: '+ Add rule', exact: true })
        .click();
      assert.equal(
        await page
          .getByLabel('Token IDs (optional):', { exact: true })
          .inputValue(),
        '1,3-5,0003',
      );
      await page
        .getByRole('button', { name: 'Review changes', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Save rule', exact: true })
        .click();
      await page.getByText('Rule created.', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      assert.equal(
        await page
          .getByLabel('Token IDs (blank = any):', { exact: true })
          .inputValue(),
        '1,3-5',
      );
      assert.equal(
        await page.getByLabel('Minimum items:', { exact: true }).inputValue(),
        '3',
      );
      const suggestion = page.waitForRequest(request => new URL(request.url()).pathname.endsWith('/suggestions'));
      await page.getByRole('button', { name: 'Add trait', exact: true }).click();
      await page.getByLabel('Attribute key:', { exact: true }).fill('Color');
      assert.equal(new URL((await suggestion).url()).searchParams.get('network'), network,
        'editing traits retains the rule’s chain');
      await page.getByRole('button', { name: 'Remove trait 1', exact: true }).click();
      await page
        .getByLabel('Token IDs (blank = any):', { exact: true })
        .fill('3-5,7');
      await page.getByLabel('Minimum items:', { exact: true }).fill('4');
      await page
        .getByRole('button', { name: 'Review changes', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Save rule', exact: true })
        .click();
      await page
        .getByText(
          'Rule saved. Previously earned roles are queued for a fresh check.',
          { exact: true },
        )
        .waitFor();
      assert.equal(requests[1].body.inputs.token_ids, '3-5,7');
      assert.equal(requests[1].body.inputs.min_items, '4');
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await page.getByRole('button', { name: 'Redo', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      assert.equal(
        await page
          .getByLabel('Token IDs (blank = any):', { exact: true })
          .inputValue(),
        '1,3-5',
      );
      assert.equal(
        await page.getByLabel('Minimum items:', { exact: true }).inputValue(),
        '3',
      );
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      assert.equal(
        await page
          .getByLabel('Token IDs (blank = any):', { exact: true })
          .inputValue(),
        '3-5,7',
      );
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByRole('button', { name: '+ Add rule', exact: true }).click();
      await choose(page, 'Asset type', 'Tokens (ERC-20)');
      await choose(page, 'Network', networkLabel);
      await choose(page, 'Discord role', 'Holder');
      await page.getByLabel('Contract address:', { exact: true }).fill(contract);
      await page.getByLabel('Minimum token balance:', { exact: true }).fill('0.5');
      await page.getByRole('button', { name: 'Review changes', exact: true }).click();
      await page.getByRole('button', { name: 'Save rule', exact: true }).click();
      await page.getByText('Rule created.', { exact: true }).waitFor();
      assert.equal(requests.at(-1).body.asset_type, 'erc20');
      assert.equal(requests.at(-1).body.network, network);
      assert.deepEqual(errors, []);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      console.log(
        `PASS: ${networkLabel} NFT/token create, trait routing, edit, retained selections and Undo/Redo at ${width}px`,
      );
      await context.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
