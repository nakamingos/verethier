const { chromium } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../dist/frontend/browser');
const artifacts = fs.mkdtempSync('/tmp/bouncer-portal-smoke-');
const server = '111111111111111111',
  channel = '222222222222222222',
  role = '333333333333333333';
const base = {
  id: 1,
  server_id: server,
  channel_id: channel,
  role_id: role,
  role_name: 'Comrade',
  asset_type: 'ordinal',
  slug: 'pizza-comrades',
  min_items: 10,
  attribute_key: 'ALL',
  attribute_value: 'ALL',
  version: 'version1',
  fields: [
    { key: 'slug', label: 'Collection slug', value: 'pizza-comrades' },
    { key: 'attribute_key', label: 'Attribute key', value: 'ALL' },
    { key: 'attribute_value', label: 'Attribute value', value: 'ALL' },
    { key: 'min_items', label: 'Minimum items', value: '10', required: true },
  ],
};
(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_BIN ||
      '/home/snep/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
    headless: true,
    args: ['--no-sandbox'],
  });
  try {
    for (const width of [1280, 393]) {
      let rules = [structuredClone(base)],
        actions = 0;
      const requests = [],
        errors = [];
      const context = await browser.newContext({
        viewport: { width, height: 900 },
      });
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        const request = route.request();
        if (url.pathname.startsWith('/api/portal')) {
          const p = url.pathname.replace('/api/portal', '');
          let data = {};
          let status = 200;
          requests.push({
            path: p,
            method: request.method(),
            body: request.postDataJSON(),
            csrf: request.headers()['x-csrf-token'],
          });
          if (p === '/session')
            data = {
              user: { id: '444444444444444444', name: 'Snepsid' },
              csrf: 'csrf-test',
              configured: true,
            };
          else if (p === '/servers')
            data = {
              servers: [{ id: server, name: 'NoMoreLabs', installed: true }],
              invite: 'https://discord.com/oauth2/authorize',
            };
          else if (p === `/servers/${server}`)
            data = {
              server: { id: server, name: 'NoMoreLabs' },
              rules,
              settings: {
                verification_channel_id: channel,
                background_checks_enabled: true,
              },
              channels: [{ id: channel, name: 'verify-collections' }],
              roles: [{ id: role, name: 'Comrade', manageable: true }],
              diagnostics: [],
            };
          else if (p.endsWith('/suggestions'))
            data = { values: ['pizza-comrades', 'yonder'] };
          else if (p.endsWith('/activity'))
            data = {
              items: [
                {
                  id: 'a1',
                  kind: 'edit',
                  after_rule: base,
                  reversible: true,
                  created_at: new Date().toISOString(),
                },
              ],
              page: Number(url.searchParams.get('page') || 1),
              pages: 3,
              total: 45,
            };
          else if (p.endsWith('/edit')) {
            assert.equal(request.postDataJSON().version, 'version1');
            data = { id: 'a' + ++actions, kind: 'edit' };
            rules[0] = {
              ...base,
              min_items: Number(request.postDataJSON().inputs.min_items),
            };
          } else if (p.endsWith('/reverse')) {
            data = { id: 'a' + ++actions, kind: 'reverse' };
            rules[0] = { ...base, min_items: 10 };
          } else if (p.endsWith('/rules')) {
            data = { id: 'a' + ++actions, kind: 'create' };
            const body = request.postDataJSON();
            assert.equal(body.asset_type, 'ordinal');
            assert.equal(body.slug, 'yonder');
            rules.push({
              ...base,
              id: 2,
              role_name: body.role_name,
              slug: body.slug,
              min_items: body.min_items,
            });
          } else if (p.includes('/members/'))
            data = {
              id: '555555555555555555',
              name: 'Collector',
              wallets: [{ wallet_type: 'bitcoin', address: 'bc1p-example' }],
              roles: [
                {
                  id: role,
                  name: 'Comrade',
                  held: false,
                  status: 'unavailable',
                },
              ],
            };
          else if (p.endsWith('/settings')) data = request.postDataJSON();
          else if (p.endsWith('/message'))
            data = {
              url: `https://discord.com/channels/${server}/${channel}/123`,
            };
          else {
            status = 404;
            data = { message: 'Unexpected API path ' + p };
          }
          return route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify(data),
          });
        }
        if (url.origin === 'https://bouncer.test') {
          const file = path.join(root, url.pathname);
          const found =
            fs.existsSync(file) && fs.statSync(file).isFile()
              ? file
              : path.join(root, 'index.html');
          const types = {
            '.js': 'application/javascript',
            '.css': 'text/css',
            '.woff2': 'font/woff2',
            '.svg': 'image/svg+xml',
            '.html': 'text/html',
          };
          return route.fulfill({
            body: fs.readFileSync(found),
            contentType:
              types[path.extname(found)] || 'application/octet-stream',
          });
        }
        return route.abort();
      });
      await page.goto('https://bouncer.test/admin');
      await page
        .getByRole('heading', { name: 'NoMoreLabs', exact: true })
        .waitFor();
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      await page.getByLabel('Minimum items', { exact: true }).fill('12');
      await page.getByRole('button', { name: 'Review changes' }).click();
      await page.getByRole('button', { name: 'Save rule' }).click();
      await page
        .getByRole('status')
        .filter({ hasText: 'Rule saved' })
        .waitFor();
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await page.getByRole('button', { name: 'Redo', exact: true }).waitFor();
      await page
        .getByRole('button', { name: '+ Add rule', exact: true })
        .click();
      await page.getByLabel('New role name').fill('Yonderling');
      await page.getByLabel('Collection slug', { exact: true }).fill('yonder');
      await page.getByLabel('Minimum items', { exact: true }).fill('1');
      await page.getByRole('button', { name: 'Review changes' }).click();
      await page.getByRole('button', { name: 'Save rule' }).click();
      await page
        .getByRole('heading', { name: 'Yonderling', exact: true })
        .waitFor();
      await page.screenshot({
        path: `${artifacts}/admin-${width}.png`,
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        'horizontal overflow',
      );
      await page
        .getByRole('button', { name: 'Audit Log', exact: true })
        .click();
      await page.getByRole('button', { name: 'Next →', exact: true }).click();
      await page.getByText('2 / 3 · 45 entries').waitFor();
      await page
        .getByRole('button', { name: 'Member Lookup', exact: true })
        .click();
      await page.getByLabel('Discord user ID').fill('555555555555555555');
      await page.getByRole('button', { name: 'Look up', exact: true }).click();
      await page
        .getByRole('heading', { name: 'Collector', exact: true })
        .waitFor();
      await page
        .getByRole('button', { name: 'Check roles', exact: true })
        .click();
      await page.getByText('unavailable', { exact: true }).waitFor();
      assert.ok(
        requests
          .filter((r) => r.method === 'POST')
          .every((r) => r.csrf === 'csrf-test'),
        'CSRF header missing',
      );
      assert.deepEqual(errors, []);
      console.log(
        JSON.stringify({ scenario: `admin-${width}`, result: 'passed' }),
      );
      await context.close();
    }
    console.log('Portal screenshots: ' + artifacts);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
