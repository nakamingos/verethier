/**
 * Setup Help Content
 * 
 * Contains all text content for the /setup help command.
 * This file centralizes help text for easy editing and maintenance.
 */

export interface HelpField {
  name: string;
  value: string;
  inline: boolean;
}

export interface SetupHelpContent {
  title: string;
  description: string;
  fields: HelpField[];
  footer: string;
  color: number;
}

export const SETUP_HELP_CONTENT: SetupHelpContent = {
  title: '🔧 Verification Setup Help',
  description: 'Use one collection per rule. Collectible rules in the same verification channel with the same role and minimum combine holdings across protocols; overlapping assets count once. ERC-20 balances stay separate.',
  color: 0x00FF73, // Bouncer green
  footer: 'More help: check the docs or ask in support',
  fields: [
    {
      name: '🚫 Wallet restrictions',
      value: '`/setup block-wallet address:… reason:…`\n' +
             '`/setup unblock-wallet address:…`\n' +
             '`/setup list-blocked-wallets`\n' +
             'Server-only blocks; earned roles are rechecked.',
      inline: false
    },
    {
      name: '🪙 `/setup add-token-rule`',
      value: 'Use **channel**, **role**, **contract_address**, and **min_balance**, such as `1000` or `0.5`.\n' +
             '• **Network**: Ethereum (default) or Robinhood mainnet\n' +
             '• ERC-20 balances are summed across verified EVM wallets\n' +
             '• Name, symbol, and decimals are read from the contract\n' +
             '• Checks tokens held directly in wallets; staking and pool positions need separate rules',
      inline: false
    },
    {
      name: '📝 `/setup add-ethscription-rule`',
      value: '**Create new verification rules**\n' +
             '• **Channel**: Where users will verify\n' +
             '• **Role**: Role to assign (existing or new)\n' +
             '• **Collection**: Specific collection slug or "ALL"\n' +
             '• **Attribute**: Trait filtering (optional)\n' +
             '• **Min Items**: Minimum holdings required\n' +
             '**Example**: `/setup add-ethscription-rule channel:#verify role:Holder slug:misprint-mingos attribute_key:Type attribute_value:Stork`\n\n',
      inline: false
    },
    {
      name: '🖼️ `/setup add-nft-rule`',
      value: 'Use **channel**, **role**, and **contract_address: 0x…**.\n' +
             '• **Network**: Ethereum (default) or Robinhood mainnet\n' +
             '• **ERC-721**: Any token, or **token_ids** such as `1,5,20-30` (up to 1,000 IDs)\n' +
             '• **ERC-1155**: Checks IDs **0–99** by default; set **token_ids** to a list or range such as `1,5,20-30` (up to 1,000 IDs)\n' +
             '• **Min Items**: Total tokens/copies across verified wallets\n' +
             '• **Collection Name**: Optional label; detected when available\n' +
             '• **Attributes**: Optional trait key/value; min items counts matching tokens/copies. Requires Alchemy NFT metadata access.\n' +
             'Contract address is required; the bot detects ERC-721 or ERC-1155.',
      inline: false
    },
    {
      name: '₿ `/setup add-ordinals-rule`',
      value: 'Use **channel**, **role**, **slug: pizza-comrades**, and **min_items: 1**.\n' +
             '• **Wallet**: Xverse or UniSat on Bitcoin mainnet\n' +
             '• **Collection**: One collection slug, validated through the configured provider\n' +
             '• **Attributes**: Optional trait key/value, with suggestions or manual entry\n' +
             '• **Min Items**: Required number of matching inscriptions across verified Bitcoin wallets\n' +
             'Trait setup uses ord.net; existing roles are retained when ownership cannot be checked.',
      inline: false
    },
    {
      name: '🔎 Specific Ethscriptions or Ordinals',
      value: 'Use `/setup add-ethscription-rule` or `/setup add-ordinals-rule`, leaving slug/attributes empty.\n' +
             '• **inscription_ids**: One full ID or comma-separated IDs (Ethscriptions use `0x…`; Ordinals use `…i0`)\n' +
             '• **inscription_numbers**: Global numbers or inclusive ranges, such as `12345,100000-100999`\n' +
             '• Use one input. **min_items: 1** means any match; a list of 3 IDs with **min_items: 3** requires all 3.\n' +
             'Ownership is checked fresh across linked wallets. Specific Ethscriptions use the public Ethscriptions API.',
      inline: false
    },
    {
      name: '🔄 `/setup refresh-collection`',
      value: 'Use **collection_slug** to refresh an Ordinals collection’s stored membership and traits now.\n' +
             'Collections refresh automatically with scheduled role checks, every six hours by default. Wallet ownership is always checked separately.',
      inline: false
    },
    {
      name: '✏️ `/setup edit-rule`',
      value: 'Select **rule_id**, edit the prefilled requirements, then review and Save or Cancel.\n' +
             'Undo/Redo repeats with a fresh 5-minute window. Keeps rule identity; rechecks earned roles.',
      inline: false
    },
    {
      name: '🗑️ `/setup remove-rule`',
      value: 'Remove one or more rules using **rule_id**, such as `1,3,5`. Includes undo. Use `/setup list-rules` to find IDs.',
      inline: false
    },
    {
      name: '📋 `/setup list-rules`',
      value: '**View all verification rules**\n' +
             '• Shows rule IDs, channels, roles, and criteria\n' +
             '• **Asset Type**: Optional Tokens, NFT, Ordinals, or Ethscriptions filter; omit to show all\n' +
             '• Organized by channel for easy reading\n' +
             '• Use rule IDs for editing or removal\n' +
             '**Example**: `/setup list-rules asset_type:Ordinals`\n\n',
      inline: false
    },
    {
      name: '✨ `/setup verification`',
      value: '**Manage the channel\'s verification message**\n' +
             '• **Channel** and **Action** are required\n' +
             '• **Refresh existing**: Update the current message, preserving its link and pins\n' +
             '• **Create new**: Post another message; existing messages keep working\n' +
             '• **Recover missing**: Post only if no existing message is found\n' +
             '• All messages use the channel\'s existing rules\n' +
             '**Example**: `/setup verification channel:#verify action:refresh`\n\n',
      inline: false
    },
    {
      name: '📊 `/setup audit-log`',
      value: '**View role assignment history**\n' +
             '• Shows initial verifications (✅), re-verifications (🔄), and removals (🗑️)\n' +
             '• **Days**: Number of days to look back (1-30, default: 1)\n' +
             '• Previous/Next buttons browse up to 20 complete entries per page\n' +
             '• Clickable Ethereum and Bitcoin wallet links\n' +
             '• Admin-only access for security and privacy\n' +
             '**Example**: `/setup audit-log days:7`\n\n',
      inline: false
    },
    {
      name: '💡 **Pro Tips**',
      value: '• **Autocomplete**: Shows 25 rarest options, but you can type any valid option\n' +
             '• **Manual Entry**: Don\'t see your option? Just type it! Bot validates everything\n' +
             '• **Role Creation**: Type new role names to create them automatically\n' +
             '• **Duplicate Rules**: Bot warns about conflicts before creating\n' +
             '• **Undo System**: Most actions can be undone within a few minutes\n' +
             '• **Case Sensitivity**: Role names preserve your exact casing',
      inline: false
    },
    {
      name: '⚠️ **Common Issues & Solutions**',
      value: '**"Role hierarchy issue"** → Move bot role higher in server settings\n' +
             '**"Verification message missing"** → Use `/setup verification` with `action:recover`\n' +
             '**"Duplicate role warning"** → Decide if intentional, bot will prevent conflicts\n' +
             '**"Rule not found"** → Check with list-rules first to confirm IDs\n' +
             '**"Permission denied"** → Ensure admin permissions for the user\n' +
             '**"Option not in autocomplete"** → Just type it manually! Bot supports all valid options',
      inline: false
    },
    {
      name: '🔧 **Workflow Example**',
      value: '1. `/setup add-ethscription-rule channel:#verify role:Holder slug:misprint-mingos`\n' +
             '2. `/setup list-rules` (to check what was created)\n' +
             '3. `/setup add-ethscription-rule channel:#verify role:RareHolder slug:misprint-mingos attribute_key:Type attribute_value:Stork`\n' +
             '4. Test verification in the channel\n' +
             '5. Use `/setup edit-rule` to change requirements',
      inline: false
    }
  ]
};
