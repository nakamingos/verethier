const { chromium } = require("playwright-core");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, "../dist/frontend/browser"),
  artifacts = fs.mkdtempSync("/tmp/bouncer-privacy-browser-");
const server = "111111111111111111",
  user = "222222222222222222",
  channel = "333333333333333333",
  role = "444444444444444444",
  epoch = "00000000-0000-4000-8000-000000000001",
  notice = "2026-10-27";
(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_BIN ||
      "/home/snep/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    for (const width of [1280, 393, 320]) {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        hasTouch: width < 800,
        acceptDownloads: true,
      });
      const page = await context.newPage(),
        errors = [],
        writes = [];
      let operator = true,
        requests = [],
        failRequest = true,
        exportJob;
      page.on("pageerror", (e) => errors.push(e.message));
      page.setDefaultTimeout(12000);
      let privacy = {
        server_id: server,
        sharing_enabled: true,
        epoch,
        notice,
        share_since: null,
        export_since: null,
      };
      const community = {
        id: server,
        name: "Privacy community",
        icon: null,
        defaultChannel: channel,
        channels: [],
        roles: [],
        privacy,
      };
      await page.route("**/*", async (route) => {
        const req = route.request(),
          url = new URL(req.url());
        if (url.pathname.startsWith("/api/")) {
          const p = url.pathname.replace("/api/portal", ""),
            body = req.postDataJSON();
          let data = {},
            status = 200;
          if (req.method() === "POST") {
            assert.equal(req.headers()["x-csrf-token"], "test-csrf");
            writes.push({ p, body });
          }
          if (p === "/session")
            data = {
              user: { id: user, name: "Member" },
              csrf: "test-csrf",
              configured: true,
              operator,
            };
          else if (p === "/servers")
            data = {
              servers: [{ id: server, name: community.name, installed: true }],
              invite: "",
            };
          else if (p === `/servers/${server}`)
            data = {
              server: { id: server, name: community.name },
              rules: [1, 2].map((id) => ({
                id, role_id: role, role_name: "Holder", asset_type: "ethscription",
                slug: "nakamingos", min_items: 1, trait_filter: null,
              })),
              roles: [
                { id: role, name: "Holder", manageable: true },
                { id: "555555555555555555", name: "Other community role", manageable: true },
              ],
              channels: [{ id: channel, name: "verify" }],
              role_actions: [],
              settings: {
                reverify_enabled: true,
                verification_channel_id: channel,
                verification_message_id: null,
              },
              capabilities: { multi_trait: true, operator },
              privacy,
              diagnostics: [],
            };
          else if (p === `/servers/${server}/privacy`) {
            privacy = { ...privacy, sharing_enabled: body.sharing_enabled };
            data = privacy;
          } else if (p === "/member")
            data = {
              wallets: [],
              communities: [{ ...community, privacy }],
              counts: { wallets: 0, communities: 1, roles: 0 },
              pending: null,
              actions: [],
            };
          else if (p === `/member/privacy/${server}`) {
            assert.equal(body.epoch, epoch);
            assert.equal(body.notice, notice);
            privacy = {
              ...privacy,
              share_since: body.share ? new Date().toISOString() : null,
              export_since: body.exports ? new Date().toISOString() : null,
            };
            data = privacy;
          } else if (
            p === "/member/deletion-requests" &&
            req.method() === "POST"
          ) {
            if (failRequest) {
              failRequest = false;
              status = 503;
              data = { message: "Deletion requests temporarily unavailable." };
            } else {
              data = {
                id: body.request_id,
                user_id: user,
                status: "pending",
                created_at: new Date().toISOString(),
              };
              requests.push(data);
            }
          } else if (
            p === "/member/deletion-requests" ||
            p === "/operator/deletion-requests"
          )
            data = requests;
          else if (p.startsWith("/operator/deletion-requests/")) {
            assert.ok(body.outcome.trim());
            const r = requests.find((r) => r.id === p.split("/").at(-1));
            r.status = body.approve ? "processing" : "declined";
            r.outcome = body.outcome;
            data = r;
          } else if (
            p === `/servers/${server}/exports` &&
            req.method() === "POST"
          ) {
            assert.equal(body.exclude_blocked, true);
            assert.equal(body.identities, false);
            assert.equal(body.operator_override, true);
            assert.ok(body.reason.trim());
            data = exportJob = {
              id: body.request_id,
              status: "completed",
              count: 2,
              before_dedup: 3,
              checked_at: new Date().toISOString(),
              operator_override: true,
            };
          } else if (p.endsWith("/download"))
            data = {
              filename: "bouncer-test.csv",
              csv: "wallet_address,network\r\n0xabc,ethereum\r\n",
              count: 1,
            };
          else if (p === `/servers/${server}/exports/${exportJob?.id}`)
            data = exportJob;
          else {
            status = 404;
            data = { message: "Unexpected privacy smoke API path " + p };
            errors.push(data.message);
          }
          return route.fulfill({
            status,
            contentType: "application/json",
            body: JSON.stringify(data),
          });
        }
        if (url.origin === "https://bouncer.test") {
          const wanted = path.join(root, url.pathname),
            file =
              fs.existsSync(wanted) && fs.statSync(wanted).isFile()
                ? wanted
                : path.join(root, "index.html");
          return route.fulfill({
            body: fs.readFileSync(file),
            contentType:
              {
                ".js": "application/javascript",
                ".css": "text/css",
                ".woff2": "font/woff2",
                ".svg": "image/svg+xml",
                ".png": "image/png",
                ".html": "text/html",
              }[path.extname(file)] || "application/octet-stream",
          });
        }
        return route.abort();
      });
      await page.goto("https://bouncer.test/member");
      await page
        .getByRole("button", { name: "Communities", exact: true })
        .click();
      await page
        .getByLabel(
          "Let this community's admins see which wallets belong to me.",
        )
        .check();
      await page
        .getByLabel(
          "Include my wallets in this community's downloadable exports.",
        )
        .check();
      await page
        .getByRole("button", { name: "Save privacy choices", exact: true })
        .click();
      await page
        .getByText("Privacy choices saved.", { exact: false })
        .waitFor();
      assert.ok(privacy.share_since && privacy.export_since);
      await page.getByRole("button", { name: "Privacy", exact: true }).click();
      const confirm = page.getByLabel(
        "I understand that deletion can remove roles supported by my saved wallets.",
      );
      await confirm.check();
      await page
        .getByRole("button", { name: "Request account deletion", exact: true })
        .click();
      await page
        .getByText("Deletion requests temporarily unavailable.", {
          exact: true,
        })
        .waitFor();
      await page
        .getByRole("button", { name: "Request account deletion", exact: true })
        .click();
      await page.getByText("pending", { exact: true }).waitFor();
      await page.goto("https://bouncer.test/admin");
      await page.getByRole("button", { name: "Exports", exact: true }).click();
      await page.getByRole("combobox", { name: "Include role", exact: true })
        .locator(".pixel-select-arrow").click();
      assert.deepEqual((await page.getByRole("listbox").getByRole("option").allTextContents()).map(text => text.trim()),
        ["Choose a role", "Holder"]);
      await page.getByRole("option", { name: "Holder", exact: true }).click();
      await page.getByRole("button", { name: "Add role", exact: true }).click();
      await page.getByRole("button", { name: "Include Holder · Remove", exact: true }).waitFor();
      await page.getByRole("combobox", { name: "Exclude role", exact: true })
        .locator(".pixel-select-arrow").click();
      await page.getByRole("option", { name: "Other community role", exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await page.getByLabel("Operator override: include wallets regardless of community sharing/export choices.").check();
      await page
        .getByLabel("Override reason:")
        .fill("Support review requested by operator");
      await page.screenshot({
        path: path.join(artifacts, `exports-${width}.png`),
        fullPage: true,
      });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "Export page overflows viewport",
      );
      await page
        .getByRole("button", { name: "Check and preview export", exact: true })
        .click();
      await page.getByText("2 wallet rows ready.", { exact: false }).waitFor();
      const download = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Download CSV", exact: true })
        .click();
      assert.equal((await download).suggestedFilename(), "bouncer-test.csv");
      await page.getByRole("button", { name: "Operator", exact: true }).click();
      await page
        .getByLabel("Review outcome:")
        .fill("Confirmed by member; ordinary deletion approved.");
      page.once("dialog", (d) => d.accept());
      await page
        .getByRole("button", { name: "Approve deletion", exact: true })
        .click();
      await page.getByText("processing", { exact: true }).waitFor();
      operator = false;
      await page.reload();
      await page.getByRole("button", { name: "Exports", exact: true }).click();
      assert.equal(
        await page
          .getByRole("button", { name: "Operator", exact: true })
          .count(),
        0,
      );
      assert.equal(
        await page.getByLabel("Operator override: include wallets regardless of community sharing/export choices.").count(),
        0,
      );
      await page.goto("https://bouncer.test/privacy");
      await page
        .getByRole("heading", { name: "Bouncer privacy policy", exact: true })
        .waitFor();
      await page
        .getByText("Private means hidden from ordinary community admins.", {
          exact: false,
        })
        .waitFor();
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "Policy overflows viewport",
      );
      assert.deepEqual(errors, []);
      assert.ok(writes.some((w) => w.p.endsWith("/download")));
      await context.close();
      console.log(
        `PASS: privacy choices, error/retry, exports, operator review and policy at ${width}px`,
      );
    }
    console.log("Browser artifacts: " + artifacts);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
