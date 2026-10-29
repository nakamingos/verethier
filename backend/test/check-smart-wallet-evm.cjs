const fs = require("node:fs");
const { createRequire } = require("node:module");
const assert = require("node:assert/strict");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const tools = process.env.BOUNCER_SMART_TEST_TOOLS;
if (!tools)
  throw new Error(
    "Set BOUNCER_SMART_TEST_TOOLS to a directory with solc 0.8.30 and ganache 7.9.2 installed. See docs/smart-wallet-verification.md.",
  );
const testRequire = createRequire(
  path.join(path.resolve(tools), "package.json"),
);
const ganache = testRequire("ganache"),
  solc = testRequire("solc");
const projectRequire = createRequire(path.join(root, "package.json"));
const {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  encodeFunctionData,
  serializeErc6492Signature,
} = projectRequire("viem");
const { privateKeyToAccount } = projectRequire("viem/accounts");
// Resolve compiled Nest aliases to this isolated build.
const Module = require("node:module"),
  resolve = Module._resolveFilename;
Module._resolveFilename = function (name, ...args) {
  return resolve.call(
    this,
    name.startsWith("@/") ? path.join(root, "dist", name.slice(2)) : name,
    ...args,
  );
};
const { EvmSignatureService } = require(
  path.join(root, "dist/services/evm-signature.service.js"),
);
(async () => {
  const owner = privateKeyToAccount("0x" + "11".repeat(32)),
    other = privateKeyToAccount("0x" + "22".repeat(32));
  const source = fs.readFileSync(
    path.join(__dirname, "fixtures/SmartWallet.sol"),
    "utf8",
  );
  const output = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        sources: { "SmartWallet.sol": { content: source } },
        settings: {
          evmVersion: "shanghai",
          outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
        },
      }),
    ),
  );
  assert.equal(
    (output.errors || []).filter((e) => e.severity === "error").length,
    0,
  );
  const fixture = output.contracts["SmartWallet.sol"].SmartWallet;
  const factoryFixture = output.contracts["SmartWallet.sol"].SmartWalletFactory;
  for (const chainId of [1, 8453, 4663]) {
    const provider = ganache.provider({
      chain: { chainId },
      logging: { quiet: true },
      wallet: {
        accounts: [
          {
            secretKey: "0x" + "11".repeat(32),
            balance: "0x3635C9ADC5DEA00000",
          },
        ],
      },
    });
    try {
      const chain = defineChain({
        id: chainId,
        name: "Local fixture",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: ["http://localhost"] } },
      });
      const wallet = createWalletClient({
          chain,
          account: owner,
          transport: custom(provider),
        }),
        rpc = createPublicClient({ chain, transport: custom(provider) });
      const deployment = await rpc.waitForTransactionReceipt({
        hash: await wallet.deployContract({
          abi: fixture.abi,
          bytecode: "0x" + fixture.evm.bytecode.object,
          args: [owner.address],
        }),
      });
      const service = new EvmSignatureService();
      service.client = () => rpc;
      const typed = {
        domain: { name: "Bouncer", version: "1", chainId },
        types: { Verification: [{ name: "Nonce", type: "string" }] },
        primaryType: "Verification",
        message: { Nonce: "local-only-fresh-proof" },
      };
      const signature = await owner.signTypedData(typed),
        contract = deployment.contractAddress;
      assert.deepEqual(await service.verify(contract, typed, signature), {
        chainId,
      });
      await assert.rejects(
        service.verify(contract, typed, await other.signTypedData(typed)),
        /Invalid wallet signature/,
      );
      await assert.rejects(
        service.verify(
          contract,
          { ...typed, message: { Nonce: "tampered" } },
          signature,
        ),
        /Invalid wallet signature/,
      );
      await assert.rejects(
        service.verify(
          contract,
          {
            ...typed,
            domain: { ...typed.domain, chainId: chainId === 1 ? 8453 : 1 },
          },
          signature,
        ),
        /Could not check/,
      );
      await rpc.waitForTransactionReceipt({
        hash: await wallet.writeContract({
          address: contract,
          abi: fixture.abi,
          functionName: "changeOwner",
          args: [other.address],
        }),
      });
      await assert.rejects(
        service.verify(contract, typed, signature),
        /Invalid wallet signature/,
      );
      assert.deepEqual(
        await service.verify(contract, typed, await other.signTypedData(typed)),
        { chainId },
      );
      const factoryDeployment = await rpc.waitForTransactionReceipt({
        hash: await wallet.deployContract({
          abi: factoryFixture.abi,
          bytecode: "0x" + factoryFixture.evm.bytecode.object,
        }),
      });
      const factory = factoryDeployment.contractAddress,
        salt = "0x" + "12".repeat(32);
      const predicted = await rpc.readContract({
        address: factory,
        abi: factoryFixture.abi,
        functionName: "getAddress",
        args: [owner.address, salt],
      });
      const creation = encodeFunctionData({
        abi: factoryFixture.abi,
        functionName: "create",
        args: [owner.address, salt],
      });
      const wrap = (
        factoryData,
        innerSignature = signature,
        factoryAddress = factory,
      ) =>
        serializeErc6492Signature({
          address: factoryAddress,
          data: factoryData,
          signature: innerSignature,
        });
      const nonceBefore = await rpc.getTransactionCount({
        address: owner.address,
      });
      assert.equal(await rpc.getCode({ address: predicted }), undefined);
      assert.deepEqual(await service.verify(predicted, typed, wrap(creation)), {
        chainId,
      });
      assert.equal(
        await rpc.getCode({ address: predicted }),
        undefined,
        "Counterfactual proof must not actually deploy its account",
      );
      assert.equal(
        await rpc.getTransactionCount({ address: owner.address }),
        nonceBefore,
        "Verification must not submit transactions",
      );
      await assert.rejects(
        service.verify(
          predicted,
          typed,
          wrap(creation, await other.signTypedData(typed)),
        ),
      );
      await assert.rejects(
        service.verify(
          predicted,
          { ...typed, message: { Nonce: "altered" } },
          wrap(creation),
        ),
      );
      await assert.rejects(
        service.verify(
          predicted,
          {
            ...typed,
            domain: { ...typed.domain, chainId: chainId === 1 ? 8453 : 1 },
          },
          wrap(creation),
        ),
        /Could not check/,
      );
      const wrongCreation = encodeFunctionData({
        abi: factoryFixture.abi,
        functionName: "create",
        args: [other.address, salt],
      });
      await assert.rejects(
        service.verify(predicted, typed, wrap(wrongCreation)),
      );
      await assert.rejects(
        service.verify(
          predicted,
          typed,
          wrap(
            encodeFunctionData({
              abi: factoryFixture.abi,
              functionName: "fail",
            }),
          ),
        ),
      );
      await assert.rejects(
        service.verify(
          predicted,
          typed,
          wrap(creation, signature, other.address),
        ),
      );
      await assert.rejects(
        service.verify(predicted, typed, signature),
        /not deployed/,
      );
      await assert.rejects(
        service.verify(owner.address, typed, wrap(creation)),
        "Wrapped owner signatures must not become global EOA links",
      );
      assert.equal(await rpc.getCode({ address: predicted }), undefined);
      await rpc.waitForTransactionReceipt({
        hash: await wallet.writeContract({
          address: factory,
          abi: factoryFixture.abi,
          functionName: "create",
          args: [owner.address, salt],
        }),
      });
      assert.deepEqual(await service.verify(predicted, typed, wrap(creation)), {
        chainId,
      });
      // A wrapper can prepare a deployed account, but only within the simulated call.
      await rpc.waitForTransactionReceipt({
        hash: await wallet.writeContract({
          address: predicted,
          abi: fixture.abi,
          functionName: "setReady",
          args: [false],
        }),
      });
      const prepare = encodeFunctionData({
        abi: factoryFixture.abi,
        functionName: "prepare",
        args: [predicted],
      });
      assert.deepEqual(await service.verify(predicted, typed, wrap(prepare)), {
        chainId,
      });
      assert.equal(
        await rpc.readContract({
          address: predicted,
          abi: fixture.abi,
          functionName: "ready",
        }),
        false,
        "Preparation must not persist on-chain",
      );
      await rpc.waitForTransactionReceipt({
        hash: await wallet.writeContract({
          address: predicted,
          abi: fixture.abi,
          functionName: "setReady",
          args: [true],
        }),
      });
      await rpc.waitForTransactionReceipt({
        hash: await wallet.writeContract({
          address: predicted,
          abi: fixture.abi,
          functionName: "changeOwner",
          args: [other.address],
        }),
      });
      await assert.rejects(
        service.verify(predicted, typed, wrap(creation)),
        "A predeployment wrapper must not restore an old owner",
      );
      assert.deepEqual(
        await service.verify(
          predicted,
          typed,
          wrap(creation, await other.signTypedData(typed)),
        ),
        { chainId },
      );
      console.log(
        `PASS: counterfactual chain ${chainId}, no real deployment/transaction, factory failures, signer/hash/chain isolation, deployed wrapper, preparation and owner rotation`,
      );
      console.log(
        `PASS: deployed contract chain ${chainId}, owner authorization, tampering, wrong chain and owner change`,
      );
    } finally {
      await provider.disconnect();
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
