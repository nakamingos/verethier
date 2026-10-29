const { chromium } = require("playwright-core");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, "../dist/frontend/browser");
const artifacts = fs.mkdtempSync("/tmp/bouncer-nft-collection-smoke-");
const origin = "https://bouncer.test";
const server = "111111111111111111",
  channel = "222222222222222222",
  role = "333333333333333333";
const address = "0x" + "ab".repeat(20),
  other = "0x" + "cd".repeat(20);
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
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      await page.addInitScript(
        (theme) => localStorage.setItem("bouncer-theme", theme),
        theme,
      );
      let mode = "multi",
        creations = [];
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", async (route) => {
        const request = route.request(),
          url = new URL(request.url());
        if (url.origin !== origin) return route.abort();
        if (url.pathname.startsWith("/api/portal")) {
          const p = url.pathname.slice("/api/portal".length);
          let body,
            status = 200;
          if (p === "/session")
            body = {
              user: { id: "444444444444444444", name: "Collector" },
              csrf: "test-csrf",
              configured: true,
            };
          else if (p === "/servers")
            body = {
              servers: [{ id: server, name: "NoMoreLabs", installed: true }],
              invite: "https://discord.com/oauth2/authorize",
            };
          else if (p === `/servers/${server}`)
            body = {
              server: { id: server, name: "NoMoreLabs" },
              rules: [],
              role_actions: [],
              settings: {
                verification_channel_id: channel,
                background_checks_enabled: true,
              },
              channels: [{ id: channel, name: "verify" }],
              roles: [{ id: role, name: "Holder", manageable: true }],
              capabilities: { multi_trait: true },
              diagnostics: [],
            };
          else if (p === `/servers/${server}/nft-collection`) {
            if (mode === "unavailable") {
              status = 503;
              body = {
                message:
                  "OpenSea lookup is not configured. You can still enter a contract address.",
              };
            } else if (url.searchParams.has("contract")) {
              assert.equal(url.searchParams.get("network"), "ethereum");
              if (mode === "large") {
                status = 400;
                body = {
                  message:
                    "This collection is too large for a fixed token-ID lookup.",
                };
              } else {
                assert.equal(url.searchParams.get("contract"), other);
                body = {
                  collection: "test-art",
                  collection_name: "Test Art",
                  contract_address: other,
                  network: "ethereum",
                  token_standard: "erc1155",
                  token_ids: ["100", "101", "102"],
                  token_ids_input: "100-102",
                  resolved_at: "2026-10-28T12:00:00Z",
                };
              }
            } else
              body = {
                source: "opensea",
                slug: "test-art",
                name: "Test Art",
                url: "https://opensea.io/collection/test-art",
                contracts: (mode === "multi"
                  ? [address, other]
                  : [address]
                ).map((contract_address) => ({
                  chain: "ethereum",
                  network: "ethereum",
                  network_name: "Ethereum",
                  contract_address,
                  token_standard: mode === "multi" ? "erc1155" : "erc721",
                  supported: true,
                })),
              };
          } else if (p === `/servers/${server}/rules`) {
            assert.equal(request.method(), "POST");
            assert.equal(request.headers()["x-csrf-token"], "test-csrf");
            const input = request.postDataJSON();
            creations.push(input);
            assert.equal(input.asset_type, "nft");
            assert.equal(input.slug, undefined);
            assert.equal(input.channel_id, channel);
            assert.equal(input.role_id, role);
            body = { id: "created-" + creations.length, kind: "create" };
          } else throw new Error("Unexpected portal API request " + p);
          return route.fulfill({ status, json: body });
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
      await page.goto(origin + "/admin");
      async function createNft() {
        await page.getByRole("button", { name: "Rules", exact: true }).click();
        await page
          .getByRole("button", { name: "+ Add rule", exact: true })
          .click();
        await choose(page, "Asset type", "NFTs");
        await choose(page, "Discord role", "Holder");
      }
      await createNft();
      await page
        .locator('[name="openSeaCollection"]')
        .fill("https://opensea.io/collection/test-art");
      await page
        .getByRole("button", { name: "Find collection", exact: true })
        .click();
      await page.getByLabel("OpenSea collection preview").waitFor();
      assert.equal(
        await page.locator('[name="contract"]').inputValue(),
        "",
        "Finding a collection must not change the draft",
      );
      assert.equal(creations.length, 0);
      await choose(page, "Collection contract", "Ethereum · " + other);
      await page
        .getByRole("button", { name: "Load token IDs", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Use these token IDs", exact: true })
        .waitFor();
      assert.equal(
        await page.locator('[name="contract"]').inputValue(),
        "",
        "Token discovery still needs explicit use",
      );
      await page
        .getByRole("button", { name: "Use these token IDs", exact: true })
        .click();
      assert.equal(await page.locator('[name="contract"]').inputValue(), other);
      assert.equal(
        await page.locator('[name="tokenIds"]').inputValue(),
        "100-102",
      );
      await page.locator('[name="minimum"]').fill("3");
      await page.evaluate(() => document.fonts.ready);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        "Lookup must fit the viewport",
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
      assert.equal(creations[0].expected_token_standard, "erc1155");
      assert.equal(creations[0].token_ids, "100-102");
      assert.equal(creations[0].min_items, 3);
      mode = "large";
      await createNft();
      await page.locator('[name="tokenIds"]').fill("1-5");
      await page.locator('[name="openSeaCollection"]').fill("test-art");
      await page
        .getByRole("button", { name: "Find collection", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Load token IDs", exact: true })
        .click();
      await page.getByRole("alert").filter({ hasText: "too large" }).waitFor();
      assert.equal(
        await page.locator('[name="tokenIds"]').inputValue(),
        "1-5",
        "Failed discovery must not overwrite chosen requirements",
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Use these token IDs", exact: true })
          .count(),
        0,
      );
      await choose(page, "Collection rule scope", "Entire ERC-721 contract");
      await page
        .getByText(
          "This accepts every NFT from this contract, including future mints and any other collections sharing it.",
          { exact: true },
        )
        .waitFor();
      await page
        .getByRole("button", { name: "Use entire contract", exact: true })
        .click();
      assert.equal(await page.locator('[name="tokenIds"]').inputValue(), "");
      await page
        .getByRole("button", { name: "Review changes", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Save rule", exact: true })
        .click();
      await page.getByText("Rule created.", { exact: true }).waitFor();
      assert.equal(creations[1].expected_token_standard, "erc721");
      assert.equal(creations[1].token_ids, undefined);
      mode = "unavailable";
      await createNft();
      await page.locator('[name="openSeaCollection"]').fill("test-art");
      await page
        .getByRole("button", { name: "Find collection", exact: true })
        .click();
      await page
        .getByRole("alert")
        .filter({ hasText: "not configured" })
        .waitFor();
      await page.locator('[name="contract"]').fill(address);
      await page
        .getByRole("button", { name: "Review changes", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Save rule", exact: true })
        .click();
      await page.getByText("Rule created.", { exact: true }).waitFor();
      assert.equal(creations[2].expected_token_standard, undefined);
      assert.deepEqual(errors, []);
      console.log(
        JSON.stringify({
          width,
          theme,
          result: "passed",
          scenarios: [
            "multi-contract ERC-1155 snapshot",
            "explicit whole ERC-721 contract",
            "unconfigured manual entry",
          ],
        }),
      );
      await context.close();
    }
  } catch (error) {
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .at(-1);
    if (page) {
      await page.screenshot({
        path: path.join(artifacts, "failure.png"),
        fullPage: true,
      });
      console.log((await page.locator("body").ariaSnapshot()).slice(0, 6000));
    }
    throw error;
  } finally {
    await browser.close();
    console.log("Artifacts: " + artifacts);
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
