import { Component } from '@angular/core';
@Component({
  selector: 'app-help',
  template: `<article class="panel" style="max-width:76rem;margin:auto">
    <p class="eyebrow">Bouncer help</p>
    <h1>Verify your wallet. Get your roles.</h1>
    <p>
      Start in your community’s verification channel. Click Request
      Verification, open your personal link, connect your wallet, and sign the
      message.
    </p>
    <h2>What am I signing?</h2>
    <p>
      A message proves you control the wallet. Bouncer reads public holdings.
      Verification never asks you to send funds, approve tokens, or share a seed
      phrase or private key.
    </p>
    <h2>Wallets</h2>
    <p>
      Ethereum: use an Ethereum wallet through the connection picker. Bitcoin
      Ordinals: choose Xverse, UniSat or Phantom and use your Bitcoin mainnet
      Taproot Ordinals address. These are separate from your wallet’s payment
      address.
    </p>
    <h2>On mobile</h2>
    <p>
      Approve the connection or signature in your wallet, then return to the
      browser. An approved connection can be reused; each verification still
      needs a fresh signature. If a wallet does not open, use the page’s
      wallet-opening controls or open the link in your regular browser.
    </p>
    <h2>Missing roles?</h2>
    <p>
      Verify again after collecting something new. Requirements can combine
      collections and protocols when the rules share a role and minimum.
      Background checks restore eligible previously earned roles and remove
      roles when holdings no longer qualify. They do not grant never-earned
      roles.
    </p>
    <p>
      Some communities use ranked roles and hide lower ranks when you earn a
      higher one. Ask a server administrator to check Member Lookup if a role
      looks wrong.
    </p>
    <h2>Unavailable or expired?</h2>
    <p>
      A provider outage keeps existing roles until ownership can be checked
      reliably. If a personal verification link expired or was replaced, return
      to Discord and request a new one. Do not share personal verification
      links.
    </p>
    <h2>For administrators</h2>
    <p>
      Use Control room or the existing /setup commands. Keep Bouncer’s role
      above the roles it grants. Channels can be renamed. Recover missing
      recreates a deleted verification message using the channel’s current
      rules.
    </p>
    <p>
      Official verification site: bouncer.up.railway.app. Contact your
      community’s administrators for help. Bouncer support never needs your
      wallet secrets.
    </p>
  </article>`,
})
export class HelpComponent {}
