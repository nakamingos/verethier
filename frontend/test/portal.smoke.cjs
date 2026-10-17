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
    for (const width of [1280, 393, 320]) {
      let holdEdit = false,
        releaseEdit,
        editEntered;
      let rules = [
          structuredClone(base),
          {
            ...structuredClone(base),
            id: 2,
            asset_type: 'ethscription',
            slug: 'comrades',
          },
          {
            ...structuredClone(base),
            id: 3,
            min_items: 1,
            role_name: 'Single item',
          },
          {
            ...structuredClone(base),
            id: 4,
            asset_type: 'erc20',
            role_name: 'Token holder',
          },
        ],
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
              roles: [
                { id: role, name: 'Comrade', manageable: true },
                {
                  id: '666666666666666666',
                  name: 'New Comrade',
                  manageable: true,
                },
              ],
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
            if (holdEdit) {
              holdEdit = false;
              editEntered();
              await new Promise((resolve) => {
                releaseEdit = resolve;
              });
            }
            assert.equal(request.postDataJSON().version, 'version1');
            data = { id: 'a' + ++actions, kind: 'edit' };
            rules[0] = {
              ...base,
              min_items: Number(request.postDataJSON().inputs.min_items),
              ...(request.postDataJSON().role_id === '666666666666666666'
                ? { role_id: '666666666666666666', role_name: 'New Comrade' }
                : request.postDataJSON().role_name
                  ? {
                      role_id: '777777777777777777',
                      role_name: request.postDataJSON().role_name,
                    }
                  : {}),
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
              id: 5,
              role_name: body.role_name,
              slug: body.slug,
              min_items: body.min_items,
            });
          } else if (p.endsWith('/members'))
            data = {
              members: [
                {
                  id: '555555555555555555',
                  name: 'Collector',
                  username: 'collector',
                  avatar: '/assets/icon.svg',
                },
                {
                  id: '888888888888888888',
                  name: 'Collector',
                  username: 'other',
                  avatar: '/assets/icon.svg',
                },
              ],
            };
          else if (p.includes('/members/'))
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
      await page.evaluate(() => document.fonts.ready);
      const themeSize = await page
        .getByRole('button', { name: 'Light theme', exact: true })
        .boundingBox();
      await page
        .getByRole('button', { name: 'Light theme', exact: true })
        .click();
      const darkSize = await page
        .getByRole('button', { name: 'Dark theme', exact: true })
        .boundingBox();
      assert.equal(
        themeSize.width,
        darkSize.width,
        'theme button width must stay stable',
      );
      assert.equal(
        themeSize.height,
        darkSize.height,
        'theme button height must stay stable',
      );
      await page
        .getByRole('button', { name: 'Dark theme', exact: true })
        .click();
      const smallText = await page.evaluate(() =>
        [
          ...document.querySelectorAll(
            '.eyebrow,.badge,.muted,label,.app-footer,.brand-header button',
          ),
        ]
          .filter((el) => el.getClientRects().length)
          .map((el) => Number.parseFloat(getComputedStyle(el).fontSize)),
      );
      assert.ok(
        smallText.every((size) => size >= 16),
        'small text must be at least 16px',
      );
      await page
        .getByRole('combobox', { name: /^Asset type/ })
        .selectOption('ordinal');
      await page.locator('#rule-1 .combined-badge').click();
      assert.equal(await page.locator('.rule-card').count(), 2);
      assert.equal(
        await page.getByRole('combobox', { name: /^Asset type/ }).isDisabled(),
        true,
      );
      await page
        .getByRole('navigation', { name: 'Contributing rules' })
        .getByRole('link', { name: 'comrades · #2', exact: true })
        .click();
      await page.waitForFunction(() => document.activeElement?.id === 'rule-2');
      await page.getByRole('button', { name: 'Back to all rules' }).click();
      assert.equal(
        await page.getByRole('combobox', { name: /^Asset type/ }).inputValue(),
        'ordinal',
      );
      await page
        .getByRole('combobox', { name: /^Asset type/ })
        .selectOption('');
      const cardHeights = await page
        .locator('.rule-card')
        .evaluateAll((cards) =>
          cards.map((card) => card.getBoundingClientRect().height),
        );
      assert.ok(
        Math.max(...cardHeights) - Math.min(...cardHeights) < 1,
        'all rule cards should have equal heights',
      );
      const editSize = await page
        .locator('#rule-1')
        .getByRole('button', { name: 'Edit', exact: true })
        .boundingBox();
      await page
        .locator('#rule-1')
        .getByRole('button', { name: 'Edit', exact: true })
        .click();
      await page
        .getByRole('region', { name: 'Edit rule 1', exact: true })
        .waitFor();
      const mutationsBeforeCollapse = requests.filter(
        (request) => request.method === 'POST',
      ).length;
      const collapseSize = await page
        .locator('#rule-1')
        .getByRole('button', { name: 'Collapse', exact: true })
        .boundingBox();
      assert.equal(
        editSize.width,
        collapseSize.width,
        'Edit/Collapse width must stay stable',
      );
      assert.equal(
        editSize.height,
        collapseSize.height,
        'Edit/Collapse height must stay stable',
      );
      await page
        .locator('#rule-1')
        .getByRole('button', { name: 'Collapse', exact: true })
        .click();
      assert.equal(await page.locator('#edit-rule-1').count(), 0);
      assert.equal(
        requests.filter((request) => request.method === 'POST').length,
        mutationsBeforeCollapse,
        'collapsing an unchanged editor must not submit',
      );
      await page
        .locator('#rule-1')
        .getByRole('button', { name: 'Edit', exact: true })
        .click();
      await page
        .getByRole('region', { name: 'Edit rule 1', exact: true })
        .waitFor();
      assert.equal(await page.locator('#rule-1 #edit-rule-1').count(), 1);
      const editor = await page.locator('#edit-rule-1').boundingBox();
      const below = await page
        .locator(width > 800 ? '#rule-3' : '#rule-2')
        .boundingBox();
      assert.ok(
        editor.y + editor.height > below.y,
        'editor should overlap the next row',
      );
      const expandedHeights = await page
        .locator('.rule-card')
        .evaluateAll((cards) =>
          cards.map((card) => card.getBoundingClientRect().height),
        );
      assert.ok(
        Math.max(...expandedHeights) - Math.min(...expandedHeights) < 1,
        'opening the editor must keep card heights equal',
      );
      await page.screenshot({
        path: `${artifacts}/inline-editor-${width}.png`,
        fullPage: true,
      });
      await page.getByLabel('Minimum items', { exact: true }).fill('12');
      await page.getByRole('button', { name: 'Review changes' }).click();
      const saveSize = await page
        .getByRole('button', { name: 'Save rule', exact: true })
        .boundingBox();
      holdEdit = true;
      const editStarted = new Promise((resolve) => {
        editEntered = resolve;
      });
      await page.getByRole('button', { name: 'Save rule' }).click();
      await editStarted;
      const checkingSize = await page
        .getByRole('button', { name: 'Checking requirements…', exact: true })
        .boundingBox();
      assert.equal(
        saveSize.width,
        checkingSize.width,
        'save button width must stay stable while checking',
      );
      assert.equal(
        saveSize.height,
        checkingSize.height,
        'save button height must stay stable while checking',
      );
      releaseEdit();
      await page
        .getByRole('status')
        .filter({ hasText: 'Rule saved' })
        .waitFor();
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await page.getByRole('button', { name: 'Redo', exact: true }).waitFor();
      await page
        .locator('#rule-1')
        .getByRole('button', { name: 'Edit', exact: true })
        .click();
      await page
        .getByRole('combobox', { name: /^Discord role/ })
        .selectOption('666666666666666666');
      await page.getByRole('button', { name: 'Review changes' }).click();
      await page.getByText('Comrade → New Comrade', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Save rule' }).click();
      await page
        .getByRole('heading', { name: 'New Comrade', exact: true })
        .waitFor();
      assert.ok(
        requests.some(
          (r) =>
            r.path.endsWith('/edit') && r.body.role_id === '666666666666666666',
        ),
      );
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await page.getByRole('button', { name: 'Redo', exact: true }).waitFor();
      await page
        .locator('#rule-1')
        .getByRole('button', { name: 'Edit', exact: true })
        .click();
      await page
        .getByRole('combobox', { name: /^Discord role/ })
        .selectOption('');
      await page
        .getByLabel('New role name', { exact: true })
        .fill('Created role');
      await page.getByRole('button', { name: 'Review changes' }).click();
      await page.getByText('Comrade → Created role', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Save rule' }).click();
      await page
        .getByRole('heading', { name: 'Created role', exact: true })
        .waitFor();
      assert.ok(
        requests.some(
          (r) =>
            r.path.endsWith('/edit') && r.body.role_name === 'Created role',
        ),
      );
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
      await page.getByLabel('Username or user ID').fill('COLLECTOR');
      await page.getByRole('listbox', { name: 'Server members' }).waitFor();
      assert.equal(await page.getByRole('option').count(), 2);
      assert.ok(requests.some((r) => r.path.endsWith('/members')));
      await page.getByLabel('Username or user ID').press('ArrowDown');
      await page.getByLabel('Username or user ID').press('Enter');
      await page
        .getByRole('heading', { name: 'Collector', exact: true })
        .waitFor();
      assert.ok(
        requests.some((r) => r.path.endsWith('/members/555555555555555555')),
      );
      await page.screenshot({
        path: `${artifacts}/member-${width}.png`,
        fullPage: true,
      });
      await page.getByLabel('Username or user ID').fill('555555555555555555');
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
