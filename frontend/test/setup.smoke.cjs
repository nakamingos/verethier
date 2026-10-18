const { chromium } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../dist/frontend/browser');
const artifacts = fs.mkdtempSync('/tmp/bouncer-setup-smoke-');
const server = '111111111111111111',
  actor = '222222222222222222';
const admin = '333333333333333333',
  verification = '444444444444444444';
(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_BIN ||
      '/home/snep/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
    headless: true,
    args: ['--no-sandbox'],
  });
  try {
    for (const width of [1280, 768, 393, 320]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        hasTouch: width < 800,
      });
      const page = await context.newPage();
      const requests = [],
        errors = [],
        operations = new Map();
      let failChannels = true,
        loseRecoveryResponse = true,
        uncertain = false,
        created = 0,
        posted = 0;
      const channels = [];
      let rules = [];
      const settings = {
        admin_channel_id: null,
        verification_channel_id: null,
        background_checks_enabled: true,
      };
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.startsWith('/api/portal')) {
          const p = url.pathname.slice('/api/portal'.length),
            body = route.request().postDataJSON();
          requests.push({
            path: p,
            body,
            csrf: route.request().headers()['x-csrf-token'],
          });
          let data = {},
            status = 200;
          if (p === '/session')
            data = {
              user: { id: actor, name: 'Admin' },
              csrf: 'setup-csrf',
              configured: true,
            };
          else if (p === '/servers')
            data = {
              servers: [
                { id: server, name: 'Setup community', installed: true },
              ],
              invite: '',
            };
          else if (p === `/servers/${server}`)
            data = {
              server: { id: server, name: 'Setup community' },
              rules,
              channels,
              settings,
              roles: [
                { id: '555555555555555555', name: 'Holder', manageable: true },
              ],
              role_actions: [],
              diagnostics: [],
            };
          else if (p.endsWith('/setup/channels/preview')) {
            data = {
              request_id: body.request_id,
              status: 'preview',
              progress: {},
              plan: {
                kind: 'channels',
                before: { ...settings },
                admin: { create: true, name: body.admin_channel_name },
                verification: {
                  create: true,
                  name: body.verification_channel_name,
                },
                recover_verification: false,
              },
            };
            operations.set(data.request_id, data);
          } else if (p.endsWith('/setup/recover/preview')) {
            data = {
              request_id: body.request_id,
              status: 'preview',
              progress: {},
              plan: {
                kind: 'recover',
                channel: { id: verification, name: 'verify' },
              },
            };
            operations.set(data.request_id, data);
          } else if (/\/setup\/[a-f0-9-]+\/apply$/.test(p)) {
            const id = p.split('/').at(-2),
              operation = operations.get(id);
            assert.ok(operation, 'confirmation requires the stored preview');
            operation.started_at = '2026-10-18T12:00:00Z';
            if (operation.plan.kind === 'channels') {
              if (!channels.find((c) => c.id === admin)) {
                channels.push({ id: admin, name: 'bouncer-admin' });
                created++;
              }
              operation.progress.admin_channel_id = admin;
              if (failChannels) {
                failChannels = false;
                operation.status = 'retry';
                status = 503;
                data = {
                  message: 'Setup interrupted. Retry the reviewed request.',
                };
              } else {
                if (!channels.find((c) => c.id === verification)) {
                  channels.push({ id: verification, name: 'verify' });
                  created++;
                }
                Object.assign(operation.progress, {
                  verification_channel_id: verification,
                  admin_message_id: '666666666666666666',
                });
                Object.assign(settings, {
                  admin_channel_id: admin,
                  verification_channel_id: verification,
                });
                operation.status = 'completed';
                data = operation;
              }
            } else {
              if (operation.status !== 'completed' && !posted) posted++;
              operation.progress = {
                verification_channel_id: verification,
                verification_message_id: '777777777777777777',
              };
              operation.status = 'completed';
              data = operation;
              if (loseRecoveryResponse) {
                loseRecoveryResponse = false;
                status = 503;
                data = { message: 'Response interrupted' };
              }
            }
          } else if (/\/setup\/[a-f0-9-]+$/.test(p))
            data = operations.get(p.split('/').at(-1));
          else if (p.endsWith('/setup/check'))
            data = {
              checked_at: '2026-10-18T12:00:00Z',
              issues: [
                {
                  id: 'message',
                  status: uncertain ? 'unavailable' : 'warning',
                  message: uncertain
                    ? 'Message search unavailable.'
                    : 'Verification message missing in #verify.',
                  remedy: uncertain
                    ? 'Pin the existing message and retry.'
                    : 'Review recovery.',
                  rule_ids: [1],
                  channel_id: verification,
                  repairable: !uncertain,
                },
              ],
              providers: [
                {
                  id: 'rpc',
                  label: 'Ethereum RPC',
                  status: 'unavailable',
                  detail:
                    'Could not confirm availability. Existing roles are retained.',
                  rule_ids: [1],
                },
                {
                  id: 'numbers',
                  label: 'Ordinals number inventories',
                  status: 'not_checked',
                  detail: 'Use Check Roles to test a member inventory.',
                  rule_ids: [1],
                },
              ],
              channels: [],
            };
          else {
            status = 404;
            data = { message: 'Unexpected test route: ' + p };
          }
          return route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify(data),
          });
        }
        if (url.origin === 'https://bouncer.test') {
          const requested = path.join(root, url.pathname);
          const file =
            fs.existsSync(requested) && fs.statSync(requested).isFile()
              ? requested
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
            body: fs.readFileSync(file),
            contentType:
              types[path.extname(file)] || 'application/octet-stream',
          });
        }
        return route.abort();
      });
      await page.goto('https://bouncer.test/admin');
      await page
        .getByRole('heading', { name: 'Channel setup', exact: true })
        .waitFor();
      assert.equal(
        requests.filter((r) => r.path.endsWith('/setup/check')).length,
        0,
        'opening setup starts no provider probes',
      );
      await page
        .getByRole('button', { name: 'Set up channels', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Review setup', exact: true })
        .click();
      await page
        .getByRole('heading', { name: 'Review channel setup', exact: true })
        .waitFor();
      assert.equal(created, 0, 'preview creates nothing');
      await page.screenshot({
        path: `${artifacts}/review-${width}.png`,
        fullPage: true,
      });
      await page
        .getByRole('button', { name: 'Confirm setup', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Retry setup', exact: true })
        .waitFor();
      assert.equal(created, 1);
      const previewId = requests.find((r) =>
        r.path.endsWith('/setup/channels/preview'),
      ).body.request_id;
      await page.reload();
      await page
        .getByRole('button', { name: 'Retry setup', exact: true })
        .waitFor();
      await page
        .getByRole('button', { name: 'Retry setup', exact: true })
        .click();
      await page
        .getByRole('link', { name: 'Open admin channel ↗', exact: true })
        .waitFor();
      assert.equal(created, 2, 'retry uses the already-created channel');
      assert.equal(
        requests.filter((r) => r.path.endsWith(`/setup/${previewId}/apply`))
          .length,
        2,
      );
      rules = [
        {
          id: 1,
          asset_type: 'ordinal',
          slug: 'nakamingos',
          min_items: 1,
          channel_id: verification,
          role_id: '555555555555555555',
          role_name: 'Holder',
          fields: [],
          version: 'v1',
        },
      ];
      await page
        .getByRole('button', { name: 'Check setup', exact: true })
        .click();
      await page
        .getByRole('table', { name: 'Verification provider checks' })
        .waitFor();
      assert.ok(await page.getByText('Not checked', { exact: true }).count());
      await page
        .getByRole('button', { name: 'Review recovery', exact: true })
        .click();
      await page
        .getByRole('heading', { name: 'Review message recovery', exact: true })
        .waitFor();
      assert.equal(posted, 0);
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.equal(posted, 0, 'cancelling a preview posts no message');
      await page
        .getByRole('button', { name: 'Review recovery', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Confirm setup', exact: true })
        .click();
      await page
        .getByText('Verification message recovered.', { exact: true })
        .waitFor();
      assert.equal(
        posted,
        1,
        'lost completion response is resolved from the saved receipt',
      );
      const actionPicker = page.getByRole('combobox', {
        name: 'Action',
        exact: true,
      });
      await actionPicker.locator('.pixel-select-arrow').click();
      await page
        .getByRole('option', { name: 'Recover missing', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Update message', exact: true })
        .click();
      await page
        .getByRole('heading', { name: 'Review message recovery', exact: true })
        .waitFor();
      assert.equal(
        requests.filter((r) => r.path.endsWith('/message')).length,
        0,
        'manual Recover uses the reviewed durable path',
      );
      await page
        .getByRole('button', { name: 'Confirm setup', exact: true })
        .click();
      await page
        .getByText('Verification message recovered.', { exact: true })
        .waitFor();
      assert.equal(posted, 1, 'recovering an existing message reuses it');
      uncertain = true;
      await page
        .getByRole('button', { name: 'Check setup', exact: true })
        .click();
      await page
        .getByText('Message search unavailable.', { exact: true })
        .first()
        .waitFor();
      assert.equal(
        await page
          .getByRole('button', { name: 'Review recovery', exact: true })
          .count(),
        0,
        'incomplete reads offer no repair',
      );
      const widths = await page
        .getByRole('button', {
          name: /^(Save settings|Update message|Check setup|Set up channels)$/,
        })
        .evaluateAll((buttons) =>
          buttons.map((b) => b.getBoundingClientRect().width),
        );
      assert.ok(
        Math.max(...widths) - Math.min(...widths) < 1,
        'settings action widths remain equal',
      );
      for (const theme of ['dark', 'light']) {
        if (theme === 'light')
          await page
            .getByRole('button', { name: 'Light theme', exact: true })
            .click();
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          'setup fits the viewport',
        );
        await page.screenshot({
          path: `${artifacts}/checks-${theme}-${width}.png`,
          fullPage: true,
        });
      }
      assert.ok(
        requests.filter((r) => r.body).every((r) => r.csrf === 'setup-csrf'),
      );
      assert.deepEqual(errors, []);
      console.log(
        JSON.stringify({ scenario: `setup-${width}`, result: 'passed' }),
      );
      await context.close();
    }
    console.log('Setup screenshots: ' + artifacts);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
