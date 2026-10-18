const { chromium } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
async function chooseOption(page, control, name) {
  await control.locator('.pixel-select-arrow').click();
  await page
    .getByRole('listbox')
    .getByRole('option', { name, exact: true })
    .click();
}
async function openHelp(page) {
  await page.getByRole('link', { name: 'Help', exact: true }).click();
  await page
    .getByRole('heading', {
      name: 'Verify your wallet. Get your roles.',
      exact: true,
    })
    .waitFor();
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
      let failLogout = false;
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
      await page.addInitScript((id) => {
        sessionStorage.setItem('bouncer-admin-server', id);
      }, server);
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
            search: url.search,
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
            if (failLogout) {
              failLogout = false;
              status = 503;
              data = { message: 'Logout unavailable' };
            } else sessionExpired = true;
          } else if (p === '/servers')
            data = {
              servers: [
                {
                  id: '800000000000000010',
                  name: 'alpha 10',
                  installed: false,
                  invite:
                    'https://discord.com/oauth2/authorize?guild_id=800000000000000010',
                },
                { id: '700000000000000010', name: 'Zeta 10', installed: true },
                {
                  id: server,
                  name: 'NoMoreLabs',
                  installed: true,
                  icon: '/assets/bouncer.svg',
                },
                {
                  id: '800000000000000002',
                  name: 'Alpha 2',
                  installed: false,
                  invite:
                    'https://discord.com/oauth2/authorize?guild_id=800000000000000002',
                },
                { id: '700000000000000002', name: 'zeta 2', installed: true },
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
            const limit = Number(url.searchParams.get('limit') || 20);
            data = {
              items: Array.from(
                {
                  length: Math.max(
                    0,
                    Math.min(limit, 45 - (number - 1) * limit),
                  ),
                },
                (_, index) => ({
                  id: 'a' + index,
                  user_name:
                    number === 2
                      ? 'A collector with a long display name ' + index
                      : 'Collector ' + index,
                  role_name: 'Comrade',
                  status:
                    url.searchParams.get('kind') === 'jobs'
                      ? 'failed'
                      : 'active',
                  role_id: role,
                  result: { verified: 2, revoked: 1, errors: 1 },
                  kind: 'edit',
                  after_rule: base,
                  reversible: true,
                  created_at: new Date().toISOString(),
                }),
              ),
              page: Number(url.searchParams.get('page') || 1),
              pages: Math.ceil(45 / limit),
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
            '.png': 'image/png',
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
        .getByRole('heading', { name: 'NoMoreLabs Control Room', exact: true })
        .waitFor();
      assert.equal(
        await page
          .locator('.portal-heading .community-title .server-title')
          .textContent(),
        'NoMoreLabs',
        'server name precedes Control Room in one heading',
      );
      assert.equal(
        await page.getByRole('link', { name: 'Sign in with Discord' }).count(),
        0,
        'signed-in users do not see the sign-in link',
      );
      assert.equal(
        await page
          .locator('.brand-header')
          .getByRole('button', { name: 'Sign out · Snepsid', exact: true })
          .count(),
        1,
        'signed-in account action lives in the header',
      );
      assert.equal(await page.locator('.portal-heading button').count(), 0);
      assert.equal(
        await page
          .locator('.app-footer')
          .evaluate((el) => getComputedStyle(el).borderTopWidth),
        '0px',
        'footer has no separator line',
      );
      const headingParts = await page
        .locator('.portal-title h1')
        .evaluate((el) => ({
          text: el.textContent.replace(/\s+/g, ' ').trim(),
          size: getComputedStyle(el).fontSize,
          serverSize: getComputedStyle(el.querySelector('.server-title'))
            .fontSize,
        }));
      assert.equal(headingParts.text, 'NoMoreLabs Control Room');
      assert.equal(headingParts.size, headingParts.serverSize);
      assert.equal(
        await page
          .locator('.server-menu > h2')
          .evaluate((el) => getComputedStyle(el).color),
        await page
          .locator('.portal-content .toolbar > label')
          .first()
          .evaluate((el) => getComputedStyle(el).color),
      );

      await page.evaluate(() => document.fonts.ready);
      assert.deepEqual(
        await page
          .locator('.server-list > :is(button, a.button) .server-name')
          .evaluateAll((labels) =>
            labels.map((label) =>
              label.textContent.replace(/\s+/g, ' ').trim(),
            ),
          ),
        [
          'Another community',
          'NoMoreLabs',
          'zeta 2',
          'Zeta 10',
          '+ Alpha 2',
          '+ alpha 10',
          'Add Bouncer',
        ],
        'installed servers sort first; each group uses case-insensitive numeric ordering',
      );
      assert.equal(await page.locator('.brand u').count(), 0);
      assert.equal(
        (await page.locator('.brand').textContent()).trim(),
        'Bouncer',
      );
      assert.equal(
        await page.locator('.theme-toggle img').getAttribute('src'),
        '/assets/theme.png',
      );
      assert.equal(await page.locator('.server-list h2').count(), 0);
      const serversTitle = await page
        .locator('.server-menu > h2')
        .boundingBox();
      const assetTitle = await page
        .locator('.portal-content .toolbar > label')
        .first()
        .boundingBox();
      if (width > 800)
        assert.ok(
          Math.abs(serversTitle.y - assetTitle.y) < 1,
          'menu titles align',
        );
      for (const avatar of await page.locator('.server-avatar').all()) {
        assert.equal(
          await avatar.evaluate((el) => getComputedStyle(el).backgroundColor),
          'rgba(0, 0, 0, 0)',
        );
      }
      const ruleSort = page.getByRole('combobox', {
        name: 'Sort by ID',
        exact: true,
      });
      await chooseOption(page, ruleSort, 'Descending');
      assert.deepEqual(
        await page
          .locator('.rule-card')
          .evaluateAll((cards) => cards.map((card) => card.id)),
        ['rule-4', 'rule-3', 'rule-2', 'rule-1'],
      );
      await chooseOption(page, ruleSort, 'Ascending');
      assert.deepEqual(
        await page
          .locator('.rule-card')
          .evaluateAll((cards) => cards.map((card) => card.id)),
        ['rule-1', 'rule-2', 'rule-3', 'rule-4'],
      );
      const assetPicker = page.getByRole('combobox', {
        name: 'Asset type',
        exact: true,
      });
      await assetPicker.locator('.pixel-select-value').click();
      assert.equal(
        await assetPicker.getAttribute('aria-expanded'),
        'false',
        'clicking the value area does not open the menu',
      );
      const arrowControl = assetPicker.locator('.pixel-select-arrow');
      const normalArrowFrame = await arrowControl.evaluate(
        (el) => getComputedStyle(el).borderImageSource,
      );
      await assetPicker.locator('.pixel-select-value').hover();
      assert.equal(
        await arrowControl.evaluate(
          (el) => getComputedStyle(el).borderImageSource,
        ),
        normalArrowFrame,
        'hovering the value leaves arrow colors unchanged',
      );
      await arrowControl.hover();
      assert.notEqual(
        await arrowControl.evaluate(
          (el) => getComputedStyle(el).borderImageSource,
        ),
        normalArrowFrame,
        'hovering the arrow changes its colors',
      );
      const closedPicker = await assetPicker.boundingBox();
      const addRuleBox = await page
        .getByRole('button', { name: '+ Add rule', exact: true })
        .boundingBox();
      assert.equal(
        closedPicker.height,
        addRuleBox.height,
        'dropdowns match the default button height',
      );
      const serverRows = await page
        .locator('.server-list > :is(button, a.button)')
        .evaluateAll((rows) =>
          rows.map((el) => ({
            height: el.getBoundingClientRect().height,
            font: getComputedStyle(el).fontSize,
          })),
        );
      for (const row of serverRows) {
        assert.equal(
          row.height,
          addRuleBox.height,
          'server buttons use default control height',
        );
        assert.equal(row.font, '16px');
      }
      for (const link of await page.locator('.server-invite').all())
        assert.equal(
          await link.evaluate((el) => getComputedStyle(el).color),
          'rgb(153, 155, 159)',
        );
      assert.equal(
        await page
          .locator('.server-list img')
          .first()
          .evaluate((el) => el.getBoundingClientRect().height),
        22,
      );
      assert.ok(
        await page
          .locator('.server-list img')
          .first()
          .evaluate((el) => el.complete && el.naturalWidth > 0),
        'server icon is loaded for the size check',
      );
      const arrowBox = await assetPicker
        .locator('.pixel-select-arrow')
        .boundingBox();
      assert.equal(
        arrowBox.width,
        addRuleBox.height,
        'arrow button matches the default button size',
      );
      const searchBox = await page
        .getByPlaceholder('Role or collection…')
        .boundingBox();
      assert.equal(
        searchBox.height,
        addRuleBox.height,
        'text fields match control height without reducing the font',
      );

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
      if (popupBox.y >= closedPicker.y)
        assert.equal(
          popupBox.y,
          closedPicker.y + closedPicker.height,
          'menu sits directly beneath the arrow',
        );
      const optionBox = await page.getByRole('option').first().boundingBox();
      assert.equal(
        optionBox.height,
        24,
        'single-line menu options have compact vertical spacing',
      );
      const themeFrame = await page.locator('.theme-toggle').boundingBox();
      assert.equal(themeFrame.width, 34);
      assert.equal(themeFrame.height, 34);
      const fieldLabel = page
        .locator('.portal-content .toolbar > label')
        .filter({ has: assetPicker });
      const labelGap = await fieldLabel.evaluate((el) =>
        parseFloat(
          getComputedStyle(el.querySelector('.select-control')).marginTop,
        ),
      );
      assert.equal(
        labelGap,
        0,
        'field titles have no extra gap before the control',
      );
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
        'Ethscriptions',
        'Tab commits keyboard selection',
      );
      await chooseOption(page, assetPicker, 'All assets');
      await assetPicker.locator('.pixel-select-arrow').click();
      await page
        .getByRole('heading', { name: 'NoMoreLabs Control Room', exact: true })
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
      assert.equal(
        await page
          .locator('.search-field > img')
          .first()
          .evaluate((el) => getComputedStyle(el).filter),
        'invert(1)',
      );
      assert.equal(
        await page
          .locator('.brand-header')
          .evaluate((el) => getComputedStyle(el).backgroundColor),
        'rgb(211, 203, 190)',
      );
      assert.equal(
        await page
          .locator('.workspace-surface')
          .evaluate((el) => getComputedStyle(el).backgroundColor),
        'rgb(125, 146, 158)',
      );
      await page.mouse.move(0, 0);
      assert.equal(
        await page
          .locator('.theme-toggle')
          .evaluate((el) => getComputedStyle(el).borderImageSource),
        await page
          .locator('.brand-header nav a.button')
          .first()
          .evaluate((el) => getComputedStyle(el).borderImageSource),
        'theme toggle keeps the ordinary button border in light mode',
      );
      assert.equal(
        await page
          .locator('.brand-header')
          .evaluate((el) => getComputedStyle(el).borderBottomColor),
        'rgba(0, 0, 0, 0)',
        'light header has no visible divider',
      );
      await assetPicker.locator('.pixel-select-arrow').click();
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
      const checkIcon = page.getByRole('checkbox');
      assert.equal(
        await checkIcon.evaluate((el) => getComputedStyle(el).filter),
        'invert(1)',
      );
      assert.equal(
        await checkIcon.evaluate((el) => getComputedStyle(el).backgroundSize),
        '18px 18px',
      );
      await page
        .getByRole('button', { name: 'Light theme', exact: true })
        .click();
      assert.equal(
        await checkIcon.evaluate((el) => getComputedStyle(el).filter),
        'none',
      );
      await page.screenshot({
        path: `${artifacts}/settings-light-${width}.png`,
        fullPage: true,
      });
      await page
        .getByRole('button', { name: 'Dark theme', exact: true })
        .click();
      const settingsButtons = page.getByRole('button', {
        name: /^(Save settings|Update message|Check again)$/,
      });
      const settingsWidths = await settingsButtons.evaluateAll((buttons) =>
        buttons.map((el) => el.getBoundingClientRect().width),
      );
      assert.equal(settingsWidths.length, 3);
      assert.ok(
        Math.max(...settingsWidths) - Math.min(...settingsWidths) < 1,
        'settings actions reserve the widest label',
      );
      for (const form of await page.locator('.settings-actions').all()) {
        const box = await form.boundingBox();
        const button = await form.locator('button[type=submit]').boundingBox();
        assert.ok(
          Math.abs(box.x + box.width - button.x - button.width) < 1,
          'settings actions stay right aligned',
        );
        if (width > 800) {
          const control = await form
            .getByRole('combobox')
            .first()
            .boundingBox();
          assert.ok(
            Math.abs(control.y + control.height - button.y - button.height) < 1,
            'settings actions share dropdown row',
          );
        }
      }
      await page.screenshot({
        path: `${artifacts}/settings-${width}.png`,
        fullPage: true,
      });
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
        await assetPicker.locator('.pixel-select-value').tap();
        assert.equal(
          await assetPicker.getAttribute('aria-expanded'),
          'false',
          'touching the value does not open the dropdown',
        );
        await assetPicker.locator('.pixel-select-arrow').tap();
        await page
          .getByRole('option', { name: 'Ethscriptions', exact: true })
          .tap();
        assert.equal(
          (await assetPicker.textContent()).trim(),
          'Ethscriptions',
          'touch selects an option',
        );
        await assetPicker.locator('.pixel-select-arrow').tap();
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
        await page.locator('.community-title .server-title').textContent(),
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
        (
          await page
            .locator('.server-list button.selected .server-name')
            .textContent()
        ).trim(),
        'NoMoreLabs',
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
        await page.locator('.community-title .server-title').textContent(),
        'NoMoreLabs',
      );
      assert.equal(
        (
          await page
            .locator('.server-list button.selected .server-name')
            .textContent()
        ).trim(),
        'NoMoreLabs',
      );
      releaseServer();
      await page
        .getByRole('heading', {
          name: 'Another community Control Room',
          exact: true,
        })
        .waitFor();
      assert.equal(
        (
          await page
            .locator('.server-list button.selected .server-name')
            .textContent()
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
        .getByRole('heading', { name: 'NoMoreLabs Control Room', exact: true })
        .waitFor();
      const iconSize = await page.locator('.theme-toggle img').boundingBox();
      assert.equal(
        iconSize.width,
        20,
        'theme icon keeps its native integer scale',
      );
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
      assert.equal(
        await page
          .locator('#edit-rule-1')
          .getByRole('button', { name: 'Cancel', exact: true })
          .count(),
        0,
        'existing editor uses only its card Cancel action',
      );
      await page.getByLabel('Minimum items:', { exact: true }).fill('99');
      const collapseSize = await page
        .locator('#rule-1')
        .getByRole('button', { name: 'Cancel', exact: true })
        .boundingBox();
      assert.equal(
        editSize.width,
        collapseSize.width,
        'Edit/Cancel width must stay stable',
      );
      assert.equal(
        editSize.height,
        collapseSize.height,
        'Edit/Cancel height must stay stable',
      );
      await page
        .locator('#rule-1')
        .getByRole('button', { name: 'Cancel', exact: true })
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
      assert.equal(
        await page.getByLabel('Minimum items:', { exact: true }).inputValue(),
        '10',
        'Cancel discards unsaved rule edits',
      );
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
      const editorHeading = page.locator('#edit-rule-1 .editor-heading');
      const headingTitle = await editorHeading.locator('h2').boundingBox();
      const reviewButton = await editorHeading
        .getByRole('button', { name: 'Review changes', exact: true })
        .boundingBox();
      if (width > 320)
        assert.ok(
          Math.abs(
            headingTitle.y +
              headingTitle.height / 2 -
              reviewButton.y -
              reviewButton.height / 2,
          ) < 1,
          'Review changes is centered with the editor title',
        );
      for (const selector of ['#rule-1', '#rule-1 .inline-rule-editor']) {
        assert.ok(
          await page
            .locator(selector)
            .evaluate((el) =>
              getComputedStyle(el).borderImageSource.includes('%234069c2'),
            ),
          'both parts of the expanded card use the blue indicator band',
        );
      }
      await page.screenshot({
        path: `${artifacts}/inline-editor-${width}.png`,
        fullPage: true,
      });
      await page
        .getByRole('button', { name: 'Light theme', exact: true })
        .click();
      await page.screenshot({
        path: `${artifacts}/inline-editor-light-${width}.png`,
        fullPage: true,
      });
      await page
        .getByRole('button', { name: 'Dark theme', exact: true })
        .click();
      await page.getByLabel('Minimum items:', { exact: true }).fill('12');
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
      assert.equal(
        await page
          .locator('.brand-header')
          .getByRole('button', { name: 'Sign out · Snepsid', exact: true })
          .isDisabled(),
        true,
        'header logout retains the mutation busy guard',
      );
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
      await rolePicker.locator('.pixel-select-arrow').click();
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
      const pageScrollBeforeOption = await page.evaluate(() => scrollY);
      await rolePicker.press('End');
      assert.equal(
        await page.evaluate(() => scrollY),
        pageScrollBeforeOption,
        'navigating popup options does not scroll the page',
      );
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
        'keyboard keeps the focused option visible in a long menu: ' +
          JSON.stringify({ longMenu, lastRole }),
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
        .getByLabel('New role name:', { exact: true })
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
      const addRule = page.getByRole('button', {
        name: '+ Add rule',
        exact: true,
      });
      await addRule.click();
      const newRule = page.locator('#new-rule-editor');
      const newAsset = newRule.getByRole('combobox', {
        name: 'Asset type',
        exact: true,
      });
      assert.equal(
        (await newAsset.textContent()).trim(),
        'Ethscriptions',
        'new rules default to Ethscriptions',
      );
      await newAsset.locator('.pixel-select-arrow').click();
      assert.deepEqual(
        (
          await page.getByRole('listbox').getByRole('option').allTextContents()
        ).map((label) => label.trim()),
        ['Ethscriptions', 'Ordinals', 'NFTs', 'Tokens (ERC-20)'],
      );
      await newAsset.press('Escape');
      await page
        .getByLabel('New role name:', { exact: true })
        .fill('Saved draft');
      await chooseOption(page, newAsset, 'Ordinals');
      await page
        .getByLabel('Collection slug:', { exact: true })
        .fill('pizza-comrades');
      await chooseOption(
        page,
        newRule.getByRole('combobox', { name: 'Match by', exact: true }),
        'Global inscription numbers',
      );
      await page
        .getByLabel('Inscription numbers and ranges:', { exact: true })
        .fill('1,2,10-20');
      await page.getByLabel('Minimum items:', { exact: true }).fill('7');
      await page
        .getByRole('button', { name: 'Review changes', exact: true })
        .click();
      const draftPosts = requests.filter(
        (request) => request.method === 'POST',
      ).length;
      await addRule.click();
      assert.equal(
        await newRule.count(),
        0,
        'Add rule toggles the form closed',
      );
      assert.equal(await addRule.getAttribute('aria-expanded'), 'false');
      await page
        .getByRole('button', { name: 'Bot Settings', exact: true })
        .click();
      await page.getByRole('button', { name: 'Rules', exact: true }).click();
      await page
        .locator('.server-list')
        .getByRole('button', { name: 'Another community', exact: true })
        .click();
      await page
        .getByRole('heading', {
          name: 'Another community Control Room',
          exact: true,
        })
        .waitFor();
      await addRule.click();
      assert.equal(
        await page.getByLabel('New role name:', { exact: true }).inputValue(),
        '',
        'drafts are scoped to their server',
      );
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page
        .locator('.server-list')
        .getByRole('button', { name: 'NoMoreLabs', exact: true })
        .click();
      await page
        .getByRole('heading', { name: 'NoMoreLabs Control Room', exact: true })
        .waitFor();
      await addRule.click();
      assert.equal(
        await page.getByLabel('New role name:', { exact: true }).inputValue(),
        'Saved draft',
      );
      assert.equal((await newAsset.textContent()).trim(), 'Ordinals');
      assert.equal(
        await page
          .getByLabel('Inscription numbers and ranges:', { exact: true })
          .inputValue(),
        '1,2,10-20',
      );
      assert.equal(
        await page.getByLabel('Minimum items:', { exact: true }).inputValue(),
        '7',
      );
      assert.equal(
        await page.getByText('Ready to save?', { exact: true }).isVisible(),
        true,
        'reopening preserves review state',
      );
      assert.equal(
        requests.filter((request) => request.method === 'POST').length,
        draftPosts,
        'collapsing and resuming never creates a rule',
      );
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await addRule.click();
      assert.equal((await newAsset.textContent()).trim(), 'Ethscriptions');
      assert.equal(
        await page.getByLabel('New role name:', { exact: true }).inputValue(),
        '',
        'Cancel clears the new-rule draft',
      );
      assert.equal(
        await page.getByText('Ready to save?', { exact: true }).count(),
        0,
      );
      await chooseOption(page, newAsset, 'Ordinals');
      await page.getByLabel('New role name').fill('Yonderling');
      await page.getByLabel('Collection slug:', { exact: true }).fill('yonder');
      await page.getByLabel('Minimum items:', { exact: true }).fill('1');
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
      if (width < 800) {
        const header = await page.locator('.brand-header').evaluate((el) => {
          const brand = el.querySelector('.brand').getBoundingClientRect();
          const nav = el.querySelector('nav').getBoundingClientRect();
          const auth = el
            .querySelector('.header-account')
            .getBoundingClientRect();
          return {
            brandY: brand.y + brand.height / 2,
            navY: nav.y + nav.height / 2,
            navRight: nav.right,
            authRight: auth.right,
            authTop: auth.top,
            navBottom: nav.bottom,
          };
        });
        if (width >= 360)
          assert.ok(
            Math.abs(header.brandY - header.navY) < 2,
            'mobile title and navigation share a row when full-width controls fit',
          );
        assert.equal(
          await page
            .locator('.brand-header nav a.button')
            .first()
            .evaluate((el) => getComputedStyle(el).paddingLeft),
          '12px',
          'mobile header links retain normal button padding',
        );
        assert.ok(header.authTop >= header.navBottom, 'auth uses its own row');
        assert.ok(
          Math.abs(header.navRight - header.authRight) < 2,
          'header actions align right',
        );
        const card = page.locator('.rule-card').first();
        const title = await card.locator('h3').first().boundingBox();
        const count = await card.locator('.item-count').first().boundingBox();
        assert.ok(
          Math.abs(title.y + title.height / 2 - count.y - count.height / 2) < 2,
          'mobile role and count share a row',
        );
      }
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

      await page.screenshot({
        path: `${artifacts}/audit-pending-${width}.png`,
        fullPage: true,
      });
      releaseActivity();
      await page.getByText('1 / 3 · 45 entries').waitFor();
      assert.equal(
        await page
          .locator('.activity-results')
          .evaluate((el) => getComputedStyle(el).overflowY),
        'visible',
      );
      const divider =
        width > 600
          ? page.locator('.history-table tbody tr:first-child td').first()
          : page.locator('.history-table tbody tr').first();
      assert.match(
        await divider.evaluate((el) => getComputedStyle(el).backgroundImage),
        /repeating-linear-gradient/,
      );
      assert.equal(
        await divider.evaluate((el) => getComputedStyle(el).backgroundSize),
        '100% 2px',
      );
      assert.equal(await page.locator('.history-row').count(), 20);
      await page.getByRole('button', { name: 'Next →', exact: true }).click();
      await page.getByText('2 / 3 · 45 entries').waitFor();
      await page.getByRole('button', { name: 'Next →', exact: true }).click();
      await page.getByText('3 / 3 · 45 entries').waitFor();
      await page.screenshot({
        path: `${artifacts}/audit-${width}.png`,
        fullPage: true,
      });
      const lastPage = page.getByRole('button', { name: 'Last', exact: true });
      assert.equal(
        await lastPage.isDisabled(),
        true,
        'Last is disabled on the final page',
      );
      const pagingButtons = await page
        .locator('.pagination-actions button')
        .evaluateAll((buttons) =>
          buttons.map((el) => ({
            x: el.getBoundingClientRect().x,
            y: el.getBoundingClientRect().y,
            right: el.getBoundingClientRect().right,
          })),
        );
      assert.equal(pagingButtons.length, 3);
      assert.ok(
        pagingButtons.every((button) => button.y === pagingButtons[0].y),
        'page navigation stays together in one row',
      );
      assert.ok(
        pagingButtons[1].x - pagingButtons[0].right < 7,
        'Previous sits beside Next',
      );
      await page
        .getByRole('button', { name: '← Previous', exact: true })
        .click();
      await page.getByText('2 / 3 · 45 entries').waitFor();
      await page
        .getByRole('button', { name: '← Previous', exact: true })
        .click();
      await page.getByText('1 / 3 · 45 entries').waitFor();
      await lastPage.click();
      await page.getByText('3 / 3 · 45 entries').waitFor();
      assert.match(
        requests.filter((request) => request.path.endsWith('/activity')).at(-1)
          .search,
        /page=3/,
      );
      const pageSize = page.getByRole('combobox', {
        name: 'Entries per page',
        exact: true,
      });
      await chooseOption(page, pageSize, '10');
      await page.getByText('1 / 5 · 45 entries').waitFor();
      assert.equal(await page.locator('.history-row').count(), 10);
      await chooseOption(page, pageSize, '50');
      await page.getByText('1 / 1 · 45 entries').waitFor();
      assert.equal(await page.locator('.history-row').count(), 45);
      await chooseOption(page, pageSize, '100');
      await page.waitForFunction(
        () =>
          document
            .querySelector('.activity-results')
            .getAttribute('aria-busy') === 'false',
      );
      assert.equal(await page.locator('.history-row').count(), 45);
      await chooseOption(page, pageSize, '20');
      await page.getByText('1 / 3 · 45 entries').waitFor();
      const showActivity = page.getByRole('combobox', {
        name: 'Show',
        exact: true,
      });
      await chooseOption(page, showActivity, 'Rule changes');
      await page
        .getByRole('columnheader', { name: 'Change', exact: true })
        .waitFor({ state: 'attached' });
      assert.equal(
        await page
          .getByRole('button', { name: 'Reverse', exact: true })
          .count(),
        20,
      );
      await chooseOption(page, showActivity, 'Role checks');
      await page
        .getByRole('columnheader', { name: 'Result', exact: true })
        .waitFor({ state: 'attached' });
      assert.equal(
        await page
          .getByRole('button', { name: 'Retry check', exact: true })
          .count(),
        20,
      );
      await chooseOption(page, showActivity, 'Role assignments');
      await page
        .getByRole('columnheader', { name: 'Member', exact: true })
        .waitFor({ state: 'attached' });
      const activitySort = page.getByRole('combobox', {
        name: 'Sort by date',
        exact: true,
      });
      await chooseOption(page, activitySort, 'Oldest first');
      await page.getByText('1 / 3 · 45 entries').waitFor();
      assert.match(
        requests.filter((request) => request.path.endsWith('/activity')).at(-1)
          .search,
        /sort=asc/,
      );
      await chooseOption(page, activitySort, 'Newest first');
      await page.waitForFunction(
        () =>
          document
            .querySelector('.activity-results')
            .getAttribute('aria-busy') === 'false',
      );
      assert.match(
        requests.filter((request) => request.path.endsWith('/activity')).at(-1)
          .search,
        /sort=desc/,
      );
      await page.getByRole('button', { name: 'Next →', exact: true }).click();
      await page.getByText('2 / 3 · 45 entries').waitFor();
      await page.getByRole('button', { name: 'Next →', exact: true }).click();
      await page.getByText('3 / 3 · 45 entries').waitFor();
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
      assert.equal(
        await page
          .getByRole('heading', { name: 'Saved wallets:', exact: true })
          .count(),
        1,
      );
      assert.equal(
        await page
          .getByRole('heading', {
            name: 'Previously earned roles:',
            exact: true,
          })
          .count(),
        1,
      );
      assert.equal(
        await page.getByRole('cell', { name: 'Bitcoin:', exact: true }).count(),
        1,
      );
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
      assert.equal(
        await page
          .locator('.earned-role:last-child td')
          .last()
          .evaluate((el) => getComputedStyle(el).borderBottomWidth),
        '0px',
        'last earned role has no trailing separator',
      );
      await openHelp(page);
      await page
        .getByRole('heading', {
          name: 'Verify your wallet. Get your roles.',
          exact: true,
        })
        .waitFor();
      await page
        .getByRole('button', { name: 'Sign out · Snepsid', exact: true })
        .waitFor();
      await page.reload();
      await page
        .getByRole('button', { name: 'Sign out · Snepsid', exact: true })
        .waitFor();
      assert.equal(
        await page.locator('app-admin').count(),
        0,
        'direct Help loads the session independently of Control Room',
      );
      await page.screenshot({
        path: `${artifacts}/help-signed-in-${width}.png`,
        fullPage: true,
      });
      if (width === 1280) {
        failLogout = true;
        await page
          .getByRole('button', { name: 'Sign out · Snepsid', exact: true })
          .click();
        await page
          .getByRole('alert')
          .filter({ hasText: 'Could not sign out' })
          .waitFor();
        assert.equal(
          await page
            .getByRole('button', { name: 'Sign out · Snepsid', exact: true })
            .isVisible(),
          true,
          'failed Help sign-out retains the account',
        );
        await page
          .getByRole('button', { name: 'Dismiss', exact: true })
          .click();
        await page
          .getByRole('button', { name: 'Sign out · Snepsid', exact: true })
          .click();
      } else {
        await page
          .getByRole('link', { name: 'Control room', exact: true })
          .click();
        await page
          .getByRole('heading', {
            name: 'NoMoreLabs Control Room',
            exact: true,
          })
          .waitFor();
        if (width === 393) {
          await page
            .getByRole('button', { name: 'Sign out · Snepsid', exact: true })
            .click();
        } else {
          sessionExpired = true;
          await page.locator('.server-list button.selected').click();
        }
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
      await openHelp(page);
      await page
        .getByRole('heading', {
          name: 'Verify your wallet. Get your roles.',
          exact: true,
        })
        .waitFor();
      assert.equal(
        await signIn.count(),
        1,
        'Help retains the signed-out sign-in action',
      );
      await page.reload();
      await signIn.waitFor();
      await page
        .getByRole('link', { name: 'Control room', exact: true })
        .click();
      await page
        .getByRole('heading', { name: 'Control Room', exact: true })
        .waitFor();
      await signIn.waitFor();
      assert.equal(
        await page.locator('.portal-heading .community-title').count(),
        0,
        'Help sign-out also clears Control Room identity',
      );
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
      await openHelp(page);
      await page.reload();
      await page
        .getByRole('heading', {
          name: 'Verify your wallet. Get your roles.',
          exact: true,
        })
        .waitFor();
      assert.equal(
        await signIn.count(),
        0,
        'direct Help respects unavailable OAuth configuration',
      );
      assert.ok(
        requests
          .filter((r) => r.path === '/auth/logout')
          .every((r) => r.csrf === 'csrf-test'),
        'Help logout retains CSRF protection',
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
