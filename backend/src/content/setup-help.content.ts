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
  description: 'Complete guide to setting up and managing collection verification rules for your server.',
  color: 0xc3ff00, // Bright yellow for visibility
  footer: 'Need more help? Check the docs or ask in support channels',
  fields: [
    {
      name: '📝 `/setup add-rule`',
      value: '**Create new verification rules**\n' +
             '• **Channel**: Where users will verify\n' +
             '• **Role**: Role to assign (existing or new)\n' +
             '• **Collection**: Specific collection slug or "ALL"\n' +
             '• **Attribute**: Trait filtering (optional)\n' +
             '• **Min Items**: Minimum holdings required\n' +
             '**Example**: `/setup add-rule #verify @Holder misprint-mingos attribute_key=Type attribute_value=Stork 1`\n\n',
      inline: false
    },
    {
      name: '🖼️ NFT collections',
      value: 'Use `/setup add-rule` with **asset_type: NFT** and **contract_address: 0x…**.\n' +
             '• **Network**: Ethereum (default) or Robinhood mainnet\n' +
             '• **ERC-721**: Any token in the collection, or one specific **token_ids** value\n' +
             '• **ERC-1155**: Checks IDs **0–99** by default; set **token_ids** to a list or range such as `1,5,20-30` (up to 1,000 IDs)\n' +
             '• **Min Items**: Total tokens/copies across verified wallets\n' +
             '• **Collection Name**: Optional label; detected when available\n' +
             'Leave Ethscriptions slug and trait options empty for NFT rules.',
      inline: false
    },
    {
      name: '₿ Ordinals collections',
      value: 'Use `/setup add-rule` with **asset_type: Ordinals**, **slug: pizza-comrades**, and **min_items: 1**.\n' +
             '• **Wallet**: Xverse on Bitcoin mainnet\n' +
             '• **Collection**: One collection slug, validated through Xverse\n' +
             '• **Min Items**: Required number of inscriptions across verified Bitcoin wallets\n' +
             'Leave NFT network/contract options and attributes empty. Trait verification is not supported yet.',
      inline: false
    },
    {
      name: '🗑️ `/setup remove-rule`',
      value: '**Remove existing verification rules**\n' +
             '• **Rule ID**: Single ID (e.g., `5`) or multiple (`1,2,3`)\n' +
             '• Use `/setup list-rules` to find rule IDs\n' +
             '• Includes undo functionality\n' +
             '**Example**: `/setup remove-rule 1,3,5`\n\n',
      inline: false
    },
    {
      name: '📋 `/setup list-rules`',
      value: '**View all verification rules**\n' +
             '• Shows rule IDs, channels, roles, and criteria\n' +
             '• Organized by channel for easy reading\n' +
             '• Use rule IDs for removal\n' +
             '**Example**: `/setup list-rules`\n\n',
      inline: false
    },
    {
      name: '🔄 `/setup recover-verification`',
      value: '**Fix broken verification setups**\n' +
             '• Recreates verification messages\n' +
             '• Updates orphaned rules\n' +
             '• Use when verification buttons stop working\n' +
             '**Example**: `/setup recover-verification #verify`\n\n',
      inline: false
    },
    {
      name: '📊 `/setup audit-log`',
      value: '**View role assignment history**\n' +
             '• Shows initial verifications (✅), re-verifications (🔄), and removals (🗑️)\n' +
             '• **Days**: Number of days to look back (1-30, default: 1)\n' +
             '• Compact format displays up to 375 entries per embed\n' +
             '• Clickable wallet links to Ethscriptions.com marketplace\n' +
             '• Admin-only access for security and privacy\n' +
             '• Perfect for monitoring bot activity and user engagement\n' +
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
             '• **Case Sensitivity**: Role names preserve your exact casing\n' +
             '• **Audit Trail**: Use audit-log to monitor all role changes',
      inline: false
    },
    {
      name: '⚠️ **Common Issues & Solutions**',
      value: '**"Role hierarchy issue"** → Move bot role higher in server settings\n' +
             '**"Verification not working"** → Use recover-verification command\n' +
             '**"Duplicate role warning"** → Decide if intentional, bot will prevent conflicts\n' +
             '**"Rule not found"** → Check with list-rules first to confirm IDs\n' +
             '**"Permission denied"** → Ensure admin permissions for the user\n' +
             '**"Option not in autocomplete"** → Just type it manually! Bot supports all valid options',
      inline: false
    },
    {
      name: '🔢 **Autocomplete System**',
      value: '**Prioritization**: When you start typing, exact matches appear first\n' +
             '**Rarest First**: For browsing, shows 25 rarest options to help find unique traits\n' +
             '**Manual Entry**: Can\'t find your option? Type it anyway!\n' +
             '**Validation**: Bot checks all entries when you submit\n' +
             '**Empty Fields**: Allow ALL values for that criteria (broader matching)',
      inline: false
    },
    {
      name: '🔄 **How It Works**',
      value: '**Autocomplete**: Start typing to see exact matches prioritized first\n' +
             '**Error Messages**: Clear, specific feedback when something goes wrong\n' +
             '**Manual Entry**: Type any valid option, even if not in autocomplete\n' +
             '**Performance**: Fast response times with daily data refresh\n' +
             '**Validation**: Bot validates combinations using complete datasets',
      inline: false
    },
    {
      name: '🔧 **Workflow Example**',
      value: '1. `/setup add-rule #verify @Holder misprint-mingos`\n' +
             '2. `/setup list-rules` (to check what was created)\n' +
             '3. `/setup add-rule #verify @RareHolder misprint-mingos attribute_value=Stork`\n' +
             '4. Test verification in the channel\n' +
             '5. Use `/setup remove-rule` if changes needed',
      inline: false
    }
  ]
};
