const { createECDH } = require('node:crypto');
const { writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { Address, Signer, Verifier } = require('bip322-js');
const wif = require('wif');

function createWallet() {
  const key = createECDH('secp256k1');
  key.generateKeys();
  const publicKey = key.getPublicKey(undefined, 'compressed');
  const raw = key.getPrivateKey();
  const privateKey = Buffer.concat([Buffer.alloc(32 - raw.length), raw]);
  const privateWif = wif.encode({ version: 0x80, privateKey, compressed: true });
  const ordinalsAddress = Address.convertPubKeyIntoAddress(publicKey, 'p2tr').mainnet;
  const paymentAddress = Address.convertPubKeyIntoAddress(publicKey, 'p2wpkh').mainnet;
  for (const address of [ordinalsAddress, paymentAddress]) {
    const message = 'Bouncer ord.net test wallet configuration';
    if (!Verifier.verifySignature(address, message, Signer.sign(privateWif, address, message))) throw new Error('Wallet signing self-check failed.');
  }
  return { ordinalsAddress, paymentAddress, privateWif };
}

function saveWallet(filename) {
  const wallet = createWallet();
  // Exclusive creation prevents replacing an existing or funded wallet, including symlinks.
  const contents = ['# Private ord.net API test wallet. Keep this file and its key private.',
    'ORDINALS_PROVIDER=ordnet', 'ORDNET_SESSION_TOKEN=',
    `ORDNET_ORDINALS_ADDRESS=${wallet.ordinalsAddress}`,
    `ORDNET_PAYMENT_ADDRESS=${wallet.paymentAddress}`,
    `ORDNET_ORDINALS_WIF=${wallet.privateWif}`, 'ORDNET_PAYMENT_WIF=', ''].join('\n');
  writeFileSync(filename, contents, { flag: 'wx', mode: 0o600 });
  return { ordinalsAddress: wallet.ordinalsAddress, paymentAddress: wallet.paymentAddress };
}

if (require.main === module) {
  try {
    if (process.argv.length > 2) throw new Error('Run this command without arguments; it creates backend/.env.ordnet.');
    const filename = resolve(__dirname, '../.env.ordnet');
    const wallet = saveWallet(filename);
    console.log(JSON.stringify({ walletFile: filename, ...wallet,
      funding: 'The payment address needs at least 0.001 BTC (100,000 sats) confirmed for ord.net API login.',
      next: 'Run yarn build, then yarn ordnet:check. The signing key is only in the private wallet file.' }, null, 2));
  } catch (error) {
    console.error(error.code === 'EEXIST' ? 'A wallet file already exists. Refusing to overwrite it.' : 'Could not create the ord.net wallet file. Check Node.js and file permissions.');
    process.exitCode = 1;
  }
}

module.exports = { createWallet, saveWallet };
