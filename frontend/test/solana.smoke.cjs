const { chromium } = require("playwright-core");
const { generateKeyPairSync, sign } = require("node:crypto");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const {
  solanaBase58,
  solanaMessage,
  verifySolanaMessage,
} = require("../../backend/dist/utils/solana.util.js");
const root = path.resolve(__dirname, "../dist/frontend/browser"),
  origin = "https://bouncer.test";
const keys = generateKeyPairSync("ed25519");
const address = solanaBase58(
  new Uint8Array(
    keys.publicKey.export({ format: "der", type: "spki" }).subarray(-32),
  ),
);
const nonce = "a".repeat(64),
  expiry = Math.floor(Date.now() / 1000) + 600;
const data = {
  userId: "111111111111111111",
  userTag: "Collector",
  discordId: "222222222222222222",
  discordName: "Solana community",
  avatar: "",
  discordIcon: "",
  nonce,
  expiry,
  address: "",
};
const artifacts = fs.mkdtempSync("/tmp/bouncer-solana-smoke-");
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
        viewport: { width, height: 900 },
        hasTouch: width < 800,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      let challenge,
        submitted = 0;
      await page.exposeFunction("__signSolana", (bytes) =>
        Array.from(sign(null, new Uint8Array(bytes), keys.privateKey)),
      );
      await page.addInitScript(
        ({ address }) => {
          window.phantom = {
            solana: {
              isPhantom: true,
              publicKey: { toString: () => address },
              connect: async () => ({ publicKey: { toString: () => address } }),
              on: () => {},
              removeListener: () => {},
              signMessage: async (bytes) => ({
                signature: new Uint8Array(
                  await window.__signSolana(Array.from(bytes)),
                ),
              }),
            },
          };
        },
        { address },
      );
      await page.routeWebSocket("**", (socket) => socket.close());
      await page.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === "/api/verification-context")
          return route.fulfill({
            json: { walletTypes: ["solana"], expiry, data },
          });
        if (url.pathname === "/api/solana-challenge") {
          const input = route.request().postDataJSON();
          assert.equal(input.address, address);
          assert.equal(input.nonce, nonce);
          challenge = solanaMessage({
            origin,
            purpose: "verification",
            address,
            userId: data.userId,
            serverId: data.discordId,
            nonce,
            expiry,
          });
          return route.fulfill({
            json: { address, message: challenge, expiry },
          });
        }
        if (url.pathname === "/api/verify-signature") {
          const proof = route.request().postDataJSON();
          assert.equal(proof.data.walletType, "solana");
          assert.equal(proof.data.address, address);
          assert.equal(proof.data.chainId, undefined);
          verifySolanaMessage(address, challenge, proof.signature);
          submitted++;
          return route.fulfill({
            json: { message: "Verified", address, assignedRoles: [] },
          });
        }
        if (url.origin === origin) {
          if (url.pathname.startsWith("/verify/"))
            return route.fulfill({ path: path.join(root, "index.html") });
          const file = path.resolve(root, "." + url.pathname);
          if (
            file.startsWith(root + "/") &&
            fs.existsSync(file) &&
            fs.statSync(file).isFile()
          )
            return route.fulfill({ path: file });
        }
        return route.fulfill({ json: {} });
      });
      await page.goto(origin + "/verify/" + nonce);
      await page.getByRole("button", { name: "Connect", exact: true }).click();
      await page.waitForFunction(
        () =>
          getComputedStyle(document.querySelector(".step-2.active")).opacity ===
          "1",
      );
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "Connected form horizontal overflow",
      );
      await page.screenshot({
        path: path.join(artifacts, `${width}-connected.png`),
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "Sign Message", exact: true })
        .click();
      await page.locator(".step-3.active").waitFor();
      await page.waitForFunction(
        () =>
          getComputedStyle(document.querySelector(".step-3.active")).opacity ===
          "1",
      );
      assert.equal(submitted, 1);
      assert.deepEqual(errors, []);
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "Horizontal overflow",
      );
      await page.screenshot({
        path: path.join(artifacts, `${width}.png`),
        fullPage: true,
      });
      console.log(
        JSON.stringify({ width, result: "passed", signature: "real Ed25519" }),
      );
      await context.close();
    }
  } finally {
    await browser.close();
  }
  console.log("Artifacts: " + artifacts);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
