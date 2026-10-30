const { chromium } = require("playwright-core");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, "../dist/frontend/browser"),
  origin = "https://bouncer.test";
const server = "111111111111111111",
  channel = "222222222222222222",
  role = "333333333333333333";
const address = "So11111111111111111111111111111111111111112";
const artifacts = fs.mkdtempSync("/tmp/bouncer-editions-smoke-");
async function choose(page, name, label) {
  await page
    .getByRole("combobox", { name, exact: true })
    .last()
    .locator(".pixel-select-arrow")
    .click();
  await page
    .getByRole("listbox")
    .getByRole("option", { name: label, exact: true })
    .click();
}
(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_BIN ||
      "/home/snep/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    for (const [width, theme] of [
      [1280, "dark"],
      [393, "dark"],
      [320, "light"],
    ]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        hasTouch: width < 800,
      });
      const page = await context.newPage(),
        errors = [],
        creations = [];
      page.setDefaultTimeout(15000);
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(
        (theme) => localStorage.setItem("bouncer-theme", theme),
        theme,
      );
      await page.routeWebSocket("**", (socket) => socket.close());
      await page.route("**/*", async (route) => {
        const request = route.request(),
          url = new URL(request.url());
        if (url.origin !== origin) return route.abort();
        if (url.pathname.startsWith("/api/portal")) {
          const p = url.pathname.slice("/api/portal".length);
          let body;
          if (p === "/session")
            body = {
              user: { id: "444444444444444444", name: "Collector" },
              csrf: "test-csrf",
              configured: true,
            };
          else if (p === "/servers")
            body = {
              servers: [{ id: server, name: "NoMoreLabs", installed: true }],
            };
          else if (p === `/servers/${server}`)
            body = {
              server: { id: server, name: "NoMoreLabs" },
              rules: [],
              role_actions: [],
              diagnostics: [],
              channels: [{ id: channel, name: "verify" }],
              roles: [{ id: role, name: "Holder", manageable: true }],
              settings: {
                verification_channel_id: channel,
                background_checks_enabled: true,
              },
              capabilities: {
                multi_trait: true,
                solana: true,
                solana_editions: true,
              },
            };
          else if (p === `/servers/${server}/rules`) {
            assert.equal(request.method(), "POST");
            assert.equal(request.headers()["x-csrf-token"], "test-csrf");
            const input = request.postDataJSON();
            creations.push(input);
            assert.equal(input.asset_type, "solana_nft");
            assert.equal(input.channel_id, channel);
            assert.equal(input.role_id, role);
            assert.equal(input.network, undefined);
            assert.equal(input.contract_address, undefined);
            body = { id: "created-" + creations.length, kind: "create" };
          } else throw new Error("Unexpected API request " + p);
          return route.fulfill({ json: body });
        }
        if (url.pathname === "/admin" || url.pathname === "/")
          return route.fulfill({
            path: root + "/index.html",
            contentType: "text/html",
          });
        const file = path.resolve(root, "." + url.pathname);
        if (
          file.startsWith(root + "/") &&
          fs.existsSync(file) &&
          fs.statSync(file).isFile()
        )
          return route.fulfill({ path: file });
        return route.abort();
      });
      async function openRule() {
        await page.getByRole("button", { name: "Rules", exact: true }).click();
        await page
          .getByRole("button", { name: "+ Add rule", exact: true })
          .click();
        await choose(page, "Asset type", "Solana NFTs");
      }
      await page.goto(origin + "/admin");
      await openRule();
      await choose(page, "Solana match scope", "Printed editions");
      await page
        .getByText(
          "Count printed NFTs belonging to any listed master mint. Each owned print counts once; the master NFT itself is excluded. Token Metadata editions only.",
          { exact: true },
        )
        .waitFor();
      assert.equal(
        await page
          .getByRole("combobox", { name: "Solana NFT formats", exact: true })
          .count(),
        0,
      );
      await choose(page, "Discord role", "Holder");
      await page.locator('[name="solanaAddresses"]').fill(address);
      await page
        .getByRole("button", { name: "+ Add rule", exact: true })
        .click();
      await openRule();
      assert.match(
        await page
          .getByRole("combobox", { name: "Solana match scope", exact: true })
          .innerText(),
        /Printed editions/,
      );
      assert.equal(
        await page.locator('[name="solanaAddresses"]').inputValue(),
        address,
      );
      await page.evaluate(() => document.fonts.ready);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        "Editor must fit the viewport",
      );
      await page.screenshot({
        path: path.join(artifacts, `${width}-${theme}.png`),
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "Review changes", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Save rule", exact: true })
        .click();
      await page.getByText("Rule created.", { exact: true }).waitFor();
      assert.deepEqual(creations[0].solana_criteria, {
        kind: "master_edition",
        addresses: [address],
        formats: ["metadata"],
      });
      assert.deepEqual(errors, []);
      console.log(
        `PASS: print scope available with Solana, Metadata-only requirements, collapse/restore, review and save at ${width}px (${theme})`,
      );
      await context.close();
    }
    console.log("Screenshots: " + artifacts);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
