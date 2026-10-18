const { chromium } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
async function chooseOption(page, control, name) {
  await control.click();
  await page
    .getByRole('listbox')
    .getByRole('option', { name, exact: true })
    .click();
}
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
      let holdServer = true,
        releaseServer,
        serverEntered;
      let denyOtherServer = true;
      let sessionExpired = false;
      let oauthConfigured = true;
      let holdActivity = false,
        releaseActivity,
        activityEntered;
      let failActivity = false;
      const initialServerStarted = new Promise((resolve) => {
        serverEntered = resolve;
      });
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
        hasTouch: width <= 800,
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
              user: sessionExpired
                ? null
                : { id: '444444444444444444', name: 'Snepsid' },
              csrf: 'csrf-test',
              configured: oauthConfigured,
            };
          else if (p === '/auth/logout') {
            sessionExpired = true;
          } else if (p === '/servers')
            data = {
              servers: [
                { id: server, name: 'NoMoreLabs', installed: true },
                {
                  id: '999999999999999999',
                  name: 'Another community',
                  installed: true,
                },
              ],
              invite: 'https://discord.com/oauth2/authorize',
            };
          else if (
            p === `/servers/${server}` ||
            p === '/servers/999999999999999999'
          ) {
            if (holdServer) {
              holdServer = false;
              serverEntered();
              await new Promise((resolve) => {
                releaseServer = resolve;
              });
            }
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
                  id: '777777777777777777',
                  name: 'Cannot assign',
                  manageable: false,
                },
                {
                  id: '666666666666666666',
                  name: 'New Comrade',
                  manageable: true,
                },
                ...Array.from({ length: 30 }, (_, index) => ({
                  id: '8000000000000000' + String(index).padStart(2, '0'),
                  name:
                    'Additional community role ' +
                    (index + 1) +
                    ' with a longer name',
                  manageable: true,
                })),
              ],
              diagnostics: [],
            };
            if (p.endsWith('/999999999999999999')) {
              if (denyOtherServer) {
                status = 503;
                data = {
                  message: 'This community could not be loaded. Try again.',
                };
              } else {
                data = {
                  ...data,
                  server: {
                    id: '999999999999999999',
                    name: 'Another community',
                  },
                  rules: [
                    {
                      ...structuredClone(base),
                      id: 6,
                      server_id: '999999999999999999',
                      role_name: 'Other collectors',
                    },
                  ],
                };
              }
            }
            if (sessionExpired) {
              status = 401;
              data = { message: 'Please sign in again.' };
            }
          } else if (p.endsWith('/suggestions'))
            data = { values: ['pizza-comrades', 'yonder'] };
          else if (p.endsWith('/activity')) {
            if (holdActivity) {
              holdActivity = false;
              activityEntered();
              await new Promise((resolve) => {
                releaseActivity = resolve;
              });
            }
            const number = Number(url.searchParams.get('page') || 1);
            data = {
              items: Array.from(
                { length: number === 3 ? 5 : 20 },
                (_, index) => ({
                  id: 'a' + index,
                  user_name:
                    number === 2
                      ? 'A collector with a long display name ' + index
                      : 'Collector ' + index,
                  role_name: 'Comrade',
                  status: 'active',
                  kind: 'edit',
                  after_rule: base,
                  reversible: true,
                  created_at: new Date().toISOString(),
                }),
              ),
              page: Number(url.searchParams.get('page') || 1),
              pages: 3,
              total: 45,
            };
            if (failActivity) {
              failActivity = false;
              status = 503;
              data = { message: 'Activity is unavailable. Try again.' };
            }
          } else if (p.endsWith('/edit')) {
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
      await initialServerStarted;
      await page.locator('.server-placeholder').waitFor();
      assert.equal(
        await page
          .locator('link[rel="preload"][as="font"]')
          .getAttribute('href'),
        '/assets/fonts/pizzascript.woff2',
      );
      await page.screenshot({
        path: `${artifacts}/loading-${width}.png`,
        fullPage: true,
      });
      releaseServer();
      await page
        .getByRole('heading', { name: 'NoMoreLabs', exact: true })
        .waitFor();
      await page
        .getByRole('heading', { name: 'Control room', exact: true })
        .waitFor();
      assert.equal(
        await page.locator('.portal-heading .community-title h2').textContent(),
        'NoMoreLabs',
        'active server summary sits beside the control room title',
      );
      assert.equal(
        await page.getByRole('link', { name: 'Sign in with Discord' }).count(),
        0,
        'signed-in users do not see the sign-in link',
      );
      await page.evaluate(() => document.fonts.ready);
      const assetPicker = page.getByRole('combobox', {
        name: 'Asset type',
        exact: true,
      });
      await assetPicker.hover();
      const closedPicker = await assetPicker.boundingBox();
      await page.mouse.down();
      assert.deepEqual(
        await assetPicker.boundingBox(),
        closedPicker,
        'holding a dropdown does not move or resize it',
      );
      await page.mouse.up();
      await page
        .getByRole('listbox', { name: 'Asset type', exact: true })
        .waitFor();
      assert.deepEqual(
        await assetPicker.boundingBox(),
        closedPicker,
        'opening a dropdown does not change its dimensions',
      );
      assert.equal(await assetPicker.getAttribute('aria-expanded'), 'true');
      const popupBox = await page.getByRole('listbox').boundingBox();
      assert.ok(
        popupBox.x >= 0 && popupBox.x + popupBox.width <= width,
        'popup fits viewport',
      );
      await page.screenshot({
        path: `${artifacts}/dropdown-open-${width}.png`,
      });
      await assetPicker.press('ArrowDown');
      await assetPicker.press('Escape');
      assert.equal(
        (await assetPicker.textContent()).trim(),
        'All assets',
        'Escape cancels pending selection',
      );
      await assetPicker.press('n');
      await assetPicker.press('Enter');
      assert.equal(
        (await assetPicker.textContent()).trim(),
        'NFTs',
        'type-ahead and Enter select an option',
      );
      await chooseOption(page, assetPicker, 'All assets');
      await assetPicker.press('ArrowDown');
      await assetPicker.press('ArrowDown');
      await assetPicker.press('Tab');
      assert.equal(
        (await assetPicker.textContent()).trim(),
        'Ordinals',
        'Tab commits keyboard selection',
      );
      await chooseOption(page, assetPicker, 'All assets');
      await assetPicker.click();
      await page
        .getByRole('heading', { name: 'Control room', exact: true })
        .click();
      await page.waitForFunction(
        () =>
          document
            .querySelector('[role=combobox]')
            ?.getAttribute('aria-expanded') === 'false',
      );
      assert.equal(
        (await assetPicker.textContent()).trim(),
        'All assets',
        'outside click preserves selection',
      );
      await page
        .getByRole('button', { name: 'Light theme', exact: true })
        .click();
      await assetPicker.click();
      await page.screenshot({
        path: `${artifacts}/dropdown-light-${width}.png`,
      });
      await assetPicker.press('Escape');
      await page
        .getByRole('button', { name: 'Dark theme', exact: true })
        .click();
      await page
        .getByRole('navigation', { name: 'Server settings' })
        .getByRole('button', { name: 'Bot Settings', exact: true })
        .click();
      const defaultChannel = page.getByRole('combobox', {
        name: 'Default verification channel',
        exact: true,
      });
      await chooseOption(page, defaultChannel, '#verify-collections');
      await chooseOption(page, defaultChannel, 'No default');
      await page
        .getByRole('button', { name: 'Save settings', exact: true })
        .click();
      await page.getByText('Settings saved.', { exact: true }).waitFor();
      assert.ok(
        requests.some(
          (r) =>
            r.path.endsWith('/settings') &&
            r.body?.verification_channel_id === null,
        ),
        'null default channel remains null in submitted settings',
      );
      await page
        .getByRole('navigation', { name: 'Server settings' })
        .getByRole('button', { name: 'Rules', exact: true })
        .click();

      if (width <= 800) {
        await assetPicker.tap();
        await page
          .getByRole('option', { name: 'Ethscriptions', exact: true })
          .tap();
        assert.equal(
          (await assetPicker.textContent()).trim(),
          'Ethscriptions',
          'touch selects an option',
        );
        await assetPicker.tap();
        await page
          .getByRole('option', { name: 'All assets', exact: true })
          .tap();
      }
      const paneSize = await page.locator('.portal-content').boundingBox();
      holdServer = true;
      const refreshStarted = new Promise((resolve) => {
        serverEntered = resolve;
      });
      await page
        .locator('.server-list')
        .getByRole('button', { name: 'NoMoreLabs', exact: true })
        .click();
      await refreshStarted;
      assert.equal(
        await page.locator('.rule-card').count(),
        4,
        'keep current rules while refreshing',
      );
      assert.equal(
        await page.locator('.portal-content').getAttribute('inert'),
        '',
      );
      assert.deepEqual(
        await page.locator('.portal-content').boundingBox(),
        paneSize,
        'refresh should not collapse the page',
      );
      releaseServer();
      await page.waitForFunction(
        () => !document.querySelector('.portal-content').hasAttribute('inert'),
      );
      assert.deepEqual(
        await page.locator('.portal-content').boundingBox(),
        paneSize,
      );
      holdServer = true;
      const failedServerStarted = new Promise((resolve) => {
        serverEntered = resolve;
      });
      await page
        .locator('.server-list')
        .getByRole('button', { name: 'Another community', exact: true })
        .click();
      await failedServerStarted;
      assert.equal(
        await page.locator('.community-title h2').textContent(),
        'NoMoreLabs',
      );
      assert.equal(
        await page.locator('.portal-content').getAttribute('inert'),
        '',
      );
      releaseServer();
      await page
        .getByRole('alert')
        .filter({ hasText: 'could not be loaded' })
        .waitFor();
      assert.equal(
        await page.locator('.server-list button.selected').textContent(),
        ' NoMoreLabs ',
      );
      assert.deepEqual(
        await page.locator('.portal-content').boundingBox(),
        paneSize,
        'failure notification should not move content',
      );
      await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
      assert.equal(await page.locator('.portal-feedback').count(), 0);
      assert.deepEqual(
        await page.locator('.portal-content').boundingBox(),
        paneSize,
        'dismissing feedback should not move content',
      );
      denyOtherServer = false;
      holdServer = true;
      const switchStarted = new Promise((resolve) => {
        serverEntered = resolve;
      });
      await page
        .locator('.server-list')
        .getByRole('button', { name: 'Another community', exact: true })
        .click();
      await switchStarted;
      assert.equal(
        await page.locator('.community-title h2').textContent(),
        'NoMoreLabs',
      );
      assert.equal(
        (
          await page.locator('.server-list button.selected').textContent()
        ).trim(),
        'NoMoreLabs',
      );
      releaseServer();
      await page
        .getByRole('heading', { name: 'Another community', exact: true })
        .waitFor();
      assert.equal(
        (
          await page.locator('.server-list button.selected').textContent()
        ).trim(),
        'Another community',
      );
      await page
        .getByRole('heading', { name: 'Other collectors', exact: true })
        .waitFor();
      await page
        .locator('.server-list')
        .getByRole('button', { name: 'NoMoreLabs', exact: true })
        .click();
      await page
        .getByRole('heading', { name: 'NoMoreLabs', exact: true })
        .waitFor();
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
      await chooseOption(
        page,
        page.getByRole('combobox', { name: /^Asset type/ }),
        'Ordinals',
      );
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
        (
          await page
            .getByRole('combobox', { name: /^Asset type/ })
            .textContent()
        ).trim(),
        'Ordinals',
      );
      await chooseOption(
        page,
        page.getByRole('combobox', { name: /^Asset type/ }),
        'All assets',
      );
      const cardHeights = await page
        .locator('.rule-card')
        .evaluateAll((cards) =>
          cards.map((card) => card.getBoundingClientRect().height),
        );
      assert.ok(
        Math.max(...cardHeights) - Math.min(...cardHeights) < 1,
        'all rule cards should have equal heights',
      );
      const actionInsets = await page
        .locator('.rule-card')
        .evaluateAll((cards) =>
          cards.map(
            (card) =>
              card.getBoundingClientRect().bottom -
              card
                .querySelector('.rule-card-footer .actions')
                .getBoundingClientRect().bottom,
          ),
        );
      assert.ok(
        Math.max(...actionInsets) - Math.min(...actionInsets) < 1,
        'actions should align at the bottom of every card',
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
      const titleBeforeNotice = await page
        .locator('.community-title')
        .evaluate((el) => el.getBoundingClientRect().top + scrollY);
      await page
        .getByRole('status')
        .filter({ hasText: 'Rule saved' })
        .waitFor();
      assert.equal(
        await page
          .locator('.community-title')
          .evaluate((el) => el.getBoundingClientRect().top + scrollY),
        titleBeforeNotice,
        'success notification should not move content',
      );
      assert.equal(
        await page
          .locator('.portal-feedback')
          .evaluate((el) => getComputedStyle(el).position),
        'fixed',
      );
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await page.getByRole('button', { name: 'Redo', exact: true }).waitFor();
      await page
        .locator('#rule-1')
        .getByRole('button', { name: 'Edit', exact: true })
        .click();
      const rolePicker = page.getByRole('combobox', {
        name: 'Discord role',
        exact: true,
      });
      await rolePicker.click();
      assert.equal(
        await page
          .getByRole('option', { name: 'Cannot assign', exact: true })
          .getAttribute('aria-disabled'),
        'true',
      );
      await rolePicker.press('ArrowDown');
      const activeRole = await rolePicker.getAttribute('aria-activedescendant');
      assert.equal(
        (await page.locator('#' + activeRole).textContent()).trim(),
        'New Comrade',
        'keyboard skips unassignable roles',
      );
      await rolePicker.press('End');
      const lastRoleId = await rolePicker.getAttribute('aria-activedescendant');
      const longMenu = await page.getByRole('listbox').boundingBox();
      const lastRole = await page.locator('#' + lastRoleId).boundingBox();
      assert.ok(
        longMenu.y >= 0 && longMenu.y + longMenu.height <= 901,
        'long menus fit the viewport',
      );
      assert.ok(
        lastRole.y >= longMenu.y &&
          lastRole.y + lastRole.height <= longMenu.y + longMenu.height,
        'keyboard keeps the focused option visible in a long menu',
      );
      await rolePicker.press('Home');
      await rolePicker.press('Escape');
      await chooseOption(
        page,
        page.getByRole('combobox', { name: /^Discord role/ }),
        'New Comrade',
      );
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
      await chooseOption(
        page,
        page.getByRole('combobox', { name: /^Discord role/ }),
        'Create a new role',
      );
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
      holdActivity = true;
      const activityStarted = new Promise((resolve) => {
        activityEntered = resolve;
      });
      const auditTab = page.getByRole('button', {
        name: 'Audit Log',
        exact: true,
      });
      await auditTab.click();
      await activityStarted;
      assert.equal(await auditTab.getAttribute('aria-current'), 'page');
      assert.equal(
        await auditTab.isEnabled(),
        true,
        'tab is active while data loads',
      );
      assert.equal(
        await auditTab.evaluate((el) => getComputedStyle(el).opacity),
        '1',
      );
      assert.equal(await page.locator('.activity-panel').isVisible(), true);
      assert.equal(
        await page.locator('.activity-results').getAttribute('aria-busy'),
        'true',
      );
      assert.equal(
        await page
          .locator('.activity-results')
          .evaluate((el) => getComputedStyle(el).opacity),
        '1',
      );
      assert.equal(
        await page.getByText('No activity yet.', { exact: true }).count(),
        0,
        'no false empty state before data arrives',
      );
      assert.equal(
        await page.locator('.activity-results .history-row').count(),
        0,
      );
      const pendingPager = await page.locator('.pagination').boundingBox();
      await page.screenshot({
        path: `${artifacts}/audit-pending-${width}.png`,
        fullPage: true,
      });
      releaseActivity();
      await page.getByText('1 / 3 · 45 entries').waitFor();
      assert.deepEqual(
        await page.locator('.pagination').boundingBox(),
        pendingPager,
        'loading data does not move pagination',
      );
      const pager = await page.locator('.pagination').evaluate((el) => ({
        top: el.getBoundingClientRect().top + scrollY,
        height: el.getBoundingClientRect().height,
      }));
      await page
        .locator('.activity-results')
        .evaluate((el) => (el.scrollTop = 200));
      await page.getByRole('button', { name: 'Next →', exact: true }).click();
      await page.getByText('2 / 3 · 45 entries').waitFor();
      assert.deepEqual(
        await page.locator('.pagination').evaluate((el) => ({
          top: el.getBoundingClientRect().top + scrollY,
          height: el.getBoundingClientRect().height,
        })),
        pager,
        'long rows should not move pagination',
      );
      await page.waitForFunction(
        () => document.querySelector('.activity-results').scrollTop === 0,
      );
      await page.getByRole('button', { name: 'Next →', exact: true }).click();
      await page.getByText('3 / 3 · 45 entries').waitFor();
      assert.deepEqual(
        await page.locator('.pagination').evaluate((el) => ({
          top: el.getBoundingClientRect().top + scrollY,
          height: el.getBoundingClientRect().height,
        })),
        pager,
        'short pages should not move pagination',
      );
      await page.screenshot({
        path: `${artifacts}/audit-${width}.png`,
        fullPage: true,
      });
      failActivity = true;
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      await page
        .getByRole('alert')
        .filter({ hasText: 'Activity is unavailable' })
        .waitFor();
      assert.equal(await auditTab.isEnabled(), true);
      assert.equal(
        await page.getByText('3 / 3 · 45 entries').isVisible(),
        true,
        'failed refresh keeps previous results',
      );
      await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
      holdActivity = true;
      const refreshStartedActivity = new Promise((resolve) => {
        activityEntered = resolve;
      });
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      await refreshStartedActivity;
      assert.equal(
        await page.getByText('3 / 3 · 45 entries').isVisible(),
        true,
        'refresh preserves current page until replacement arrives',
      );
      const canceledActivity = page.waitForEvent('requestfailed', {
        predicate: (request) =>
          new URL(request.url()).pathname.endsWith('/activity'),
        timeout: 10000,
      });
      await page
        .getByRole('button', { name: 'Member Lookup', exact: true })
        .click();
      await canceledActivity;
      releaseActivity();
      assert.equal(
        await page.locator('.activity-panel').count(),
        0,
        'navigation does not wait for the old tab request',
      );
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
      if (width === 1280) {
        await page
          .getByRole('button', { name: 'Sign out · Snepsid', exact: true })
          .click();
      } else {
        sessionExpired = true;
        await page.locator('.server-list button.selected').click();
      }
      const signIn = page.getByRole('link', {
        name: 'Sign in with Discord',
        exact: true,
      });
      await signIn.waitFor();
      assert.equal(
        await page
          .locator('.brand-header')
          .getByRole('link', { name: 'Sign in with Discord', exact: true })
          .count(),
        1,
        'sign-in lives in the header',
      );
      assert.equal(
        await page.locator('.portal-heading .community-title').count(),
        0,
        'signed-out and expired sessions hide the server summary',
      );
      assert.equal(
        await signIn.getAttribute('href'),
        '/api/portal/auth/login?return_to=/admin',
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        'signed-out header fits viewport',
      );
      const dismiss = page.getByRole('button', {
        name: 'Dismiss',
        exact: true,
      });
      if (await dismiss.count()) await dismiss.click();
      await page.screenshot({
        path: `${artifacts}/signed-out-header-${width}.png`,
        fullPage: true,
      });
      await page.getByRole('link', { name: 'Help', exact: true }).click();
      await page
        .getByRole('heading', {
          name: 'Verify your wallet. Get your roles.',
          exact: true,
        })
        .waitFor();
      assert.equal(
        await signIn.count(),
        0,
        'route changes clear the prior admin sign-in state',
      );
      await page
        .getByRole('link', { name: 'Control room', exact: true })
        .click();
      await signIn.waitFor();
      oauthConfigured = false;
      await page.reload();
      await page
        .getByText('Discord sign-in is being configured.', { exact: false })
        .waitFor();
      assert.equal(
        await signIn.count(),
        0,
        'unconfigured OAuth does not show a sign-in action',
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
