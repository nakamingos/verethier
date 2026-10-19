const { chromium } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../dist/frontend/browser');
const server = '111111111111111111',
  channel = '222222222222222222',
  role = '333333333333333333';
const filter = {
  operator: 'AND',
  conditions: [
    { key: 'Background', value: 'Blue' },
    { key: 'Hat', value: 'Crown' },
  ],
};
const rule = {
  id: 1,
  server_id: server,
  channel_id: channel,
  role_id: role,
  role_name: 'Holder',
  asset_type: 'ethscription',
  slug: 'comrades',
  min_items: 2,
  trait_filter: filter,
  version: 'v1',
  fields: [
    { key: 'slug', label: 'Collection slug', value: 'comrades' },
    {
      key: 'trait_filter',
      label: 'Trait conditions',
      value: JSON.stringify(filter),
    },
    { key: 'min_items', label: 'Minimum items', value: '2' },
  ],
};
(async () => {
  const browser = await chromium.launch({
    executablePath:
      '/home/snep/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
    headless: true,
    args: ['--no-sandbox'],
  });
  try {
    for (const width of [1280, 393, 320]) {
      const context = await browser.newContext({
          viewport: { width, height: 900 },
        }),
        page = await context.newPage(),
        errors = [],
        requests = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.addInitScript(
        (id) => sessionStorage.setItem('bouncer-admin-server', id),
        server,
      );
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.startsWith('/api/portal')) {
          const p = url.pathname.slice('/api/portal'.length);
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
              rules: [rule],
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
          else if (p.endsWith('/suggestions'))
            data = { values: ['Background', 'Hat'] };
          else if (
            p.endsWith('/rules/1/edit') &&
            route.request().method() === 'POST'
          ) {
            requests.push(route.request().postDataJSON());
            data = {};
          } else if (p.endsWith('/activity'))
            data = { items: [], page: 1, pages: 1, total: 0 };
          return route.fulfill({ json: data });
        }
        const relative =
            url.pathname === '/' || !path.extname(url.pathname)
              ? 'index.html'
              : url.pathname.slice(1),
          file = path.join(root, relative);
        if (!file.startsWith(root) || !fs.existsSync(file))
          return route.fulfill({ status: 404, body: '' });
        const ext = path.extname(file),
          type =
            {
              '.html': 'text/html',
              '.js': 'text/javascript',
              '.css': 'text/css',
              '.png': 'image/png',
              '.svg': 'image/svg+xml',
              '.woff2': 'font/woff2',
            }[ext] || 'application/octet-stream';
        return route.fulfill({ path: file, contentType: type });
      });
      page.setDefaultTimeout(15000);
      await page.goto('https://bouncer.test/admin');
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      assert.equal(
        await page
          .getByLabel('Attribute key:', { exact: true })
          .nth(0)
          .inputValue(),
        'Background',
      );
      assert.equal(
        await page
          .getByLabel('Attribute key:', { exact: true })
          .nth(1)
          .inputValue(),
        'Hat',
      );
      await page
        .getByLabel('Attribute value:', { exact: true })
        .nth(1)
        .fill('Cap');
      const match = page.locator('app-pixel-select[name=traitOperator]');
      await match.locator('.pixel-select-arrow').click();
      await page
        .getByRole('option', { name: 'OR — match any condition', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Review changes', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Save rule', exact: true })
        .click();
      await page.waitForTimeout(100);
      assert.equal(requests.length, 1);
      assert.deepEqual(JSON.parse(requests[0].inputs.trait_filter), {
        operator: 'OR',
        conditions: [filter.conditions[0], { key: 'Hat', value: 'Cap' }],
      });
      assert.equal(requests[0].inputs.attribute_key, undefined);
      await page
        .getByRole('button', { name: '+ Add rule', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Add trait', exact: true })
        .click();
      await page
        .getByLabel('Attribute key:', { exact: true })
        .nth(0)
        .fill('Hat');
      await page
        .getByLabel('Attribute value:', { exact: true })
        .nth(0)
        .fill('Crown');
      await page
        .getByRole('button', { name: '+ Add rule', exact: true })
        .click();
      await page
        .getByRole('button', { name: '+ Add rule', exact: true })
        .click();
      assert.equal(
        await page
          .getByLabel('Attribute key:', { exact: true })
          .nth(0)
          .inputValue(),
        'Hat',
      );
      await page
        .getByRole('button', { name: 'Add trait', exact: true })
        .click();
      assert.equal(
        await page.getByLabel('Attribute key:', { exact: true }).count(),
        2,
      );
      await page
        .getByRole('button', { name: 'Remove trait 2', exact: true })
        .click();
      assert.equal(
        await page.getByLabel('Attribute key:', { exact: true }).count(),
        1,
      );
      assert.deepEqual(errors, []);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await context.close();
      console.log(
        `PASS: multi-trait editor, complete payload and draft retention at ${width}px`,
      );
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
