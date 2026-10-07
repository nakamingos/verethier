import { Inject, Injectable, Logger, forwardRef, OnModuleInit } from '@nestjs/common';
import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, CacheType, ChannelType, ChatInputCommandInteraction, Client, EmbedBuilder, Events, GatewayIntentBits, GuildTextBasedChannel, InteractionResponse, MessageFlags, PermissionFlagsBits, REST, Routes, SlashCommandBuilder, AutocompleteInteraction } from 'discord.js';
import { EnvironmentConfig } from '@/config/environment.config';
import { NonceService } from '@/services/nonce.service';
import { DbService } from '@/services/db.service';
import { DiscordMessageService } from '@/services/discord-message.service';
import { DiscordVerificationService } from '@/services/discord-verification.service';
import { DiscordCommandsService } from '@/services/discord-commands.service';
import { DataService } from '@/services/data.service';
import { VerificationService } from '@/services/verification.service';
import { CacheService } from '@/services/cache.service';
import { CONSTANTS } from '@/constants';
import { SETUP_HELP_CONTENT } from '@/content/setup-help.content';
import { NFT_NETWORKS } from '@/utils/nft-network.util';

/**
 * Discord Bot Service
 * 
 * This service manages the Discord bot integration for the verification system.
 * It handles:
 * - Bot initialization and client management
 * - Slash command registration and handling
 * - Role autocomplete functionality
 * - Integration with verification, messaging, and command services
 * 
 * The service automatically initializes the Discord bot on startup unless:
 * - Discord is disabled via environment variables
 * - No bot token is provided
 * - Running in test environment
 * 
 * @example
 * ```typescript
 * // The service is automatically initialized by NestJS
 * // Methods can be called through dependency injection
 * await discordService.initializeBot();
 * ```
 */
@Injectable()
export class DiscordService implements OnModuleInit {

  /** The Discord.js client instance, null until initialized */
  private client: Client | null = null;
  
  /** REST API instance for Discord API calls */
  private rest = new REST({ version: '10' }).setToken(EnvironmentConfig.DISCORD_BOT_TOKEN!);
  
  /** Flag to track if the service is fully initialized */
  private isInitialized = false;
  
  /**
   * Creates an instance of DiscordService.
   * 
   * Automatically initializes the Discord bot if conditions are met:
   * - Discord is enabled via DISCORD environment variable
   * - Bot token is provided via DISCORD_BOT_TOKEN
   * - Not running in test environment
   * 
   * @param nonceSvc - Service for managing verification nonces
   * @param dbSvc - Database service for data persistence
   * @param discordMessageSvc - Service for Discord message management
   * @param discordVerificationSvc - Service for handling verification flows
   * @param discordCommandsSvc - Service for Discord slash command handling
   */
  constructor(
    @Inject(NonceService) private nonceSvc: NonceService,
    private readonly dbSvc: DbService,
    private readonly discordMessageSvc: DiscordMessageService,
    private readonly discordVerificationSvc: DiscordVerificationService,
    @Inject(forwardRef(() => DiscordCommandsService))
    private readonly discordCommandsSvc: DiscordCommandsService,
    private readonly verificationSvc: VerificationService,
    private readonly dataSvc: DataService,
    private readonly cacheSvc: CacheService,
  ) {
    // Don't initialize during tests when Discord is disabled
    const isTestEnvironment = EnvironmentConfig.IS_TEST;
    
    if (isTestEnvironment) {
      Logger.debug('Discord initialization skipped in test environment');
    } else if (!EnvironmentConfig.DISCORD_ENABLED || !EnvironmentConfig.DISCORD_BOT_TOKEN) {
      Logger.warn('Discord integration disabled or bot token missing - continuing without Discord functionality');
    }
    // Initialization moved to onModuleInit for proper lifecycle management
  }

  /**
   * NestJS lifecycle hook - called after all modules have been initialized.
   * This ensures all dependencies are ready before Discord bot initialization.
   */
  async onModuleInit(): Promise<void> {
    const isTestEnvironment = EnvironmentConfig.IS_TEST;
    
    // Initialize Discord bot only after all modules are ready
    if (EnvironmentConfig.DISCORD_ENABLED && EnvironmentConfig.DISCORD_BOT_TOKEN && !isTestEnvironment) {
      try {
        await this.initializeBot();
        await this.createSlashCommands();
        this.isInitialized = true;
        Logger.log('Discord bot fully initialized and ready');
        
        // Start cache warming in background
        this.warmAutocompleteCache().catch(error => 
          Logger.warn('Cache warming failed:', error.message)
        );
      } catch (error) {
        Logger.error('Failed to initialize Discord bot - continuing without Discord functionality', error.message);
      }
    }
  }

  /**
   * Start autocomplete cache warming (non-blocking)
   */
  private async warmAutocompleteCache(): Promise<void> {
    try {
      const isFresh = await this.cacheSvc.isComprehensiveCacheFresh();
      if (isFresh) {
        Logger.log('📋 Autocomplete cache is already fresh, skipping warming');
        return;
      }

      Logger.log('🔥 Starting autocomplete cache warming in background...');
      await this.cacheSvc.cacheAllCollectionData(this.dataSvc);
      
    } catch (error) {
      Logger.warn('Cache warming failed, will retry later:', error.message);
    }
  }

  /**
   * Initializes the Discord bot client with proper event handlers.
   * 
   * Sets up the Discord client with:
   * - Required intents for guild operations
   * - Ready event handler for successful connection
   * - Interaction event handlers for commands and autocomplete
   * - Timeout protection to prevent hanging initialization
   * 
   * @returns Promise that resolves when the bot is successfully initialized
   * @throws Error if initialization fails or times out after 10 seconds
   */
  async initializeBot(): Promise<void> {
    if (this.client) return Promise.resolve();

    return new Promise((resolve, reject) => {
      this.client = new Client({ intents: [GatewayIntentBits.Guilds] });

      // Set a timeout to prevent hanging
      const timeout = setTimeout(() => {
        reject(new Error(`Discord bot initialization timed out after ${CONSTANTS.DISCORD_INITIALIZATION_TIMEOUT / 1000} seconds`));
      }, CONSTANTS.DISCORD_INITIALIZATION_TIMEOUT);

      this.client.on(Events.ClientReady, (readyClient) => {
        clearTimeout(timeout);
        Logger.debug('Discord bot initialized.', readyClient.user.tag);
        // Initialize the new services with the client
        this.discordMessageSvc.initialize(this.client);
        this.discordVerificationSvc.initialize(this.client);
        this.discordCommandsSvc.initialize(this.client);
        resolve();
      });

      this.client.on('error', (error) => {
        clearTimeout(timeout);
        Logger.error('Discord bot initialization failed:', error);
        reject(error);
      });

      this.client.login(EnvironmentConfig.DISCORD_BOT_TOKEN).catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }


  /**
   * Creates and registers slash commands for the Discord bot.
   * 
   * This method:
   * - Registers the '/setup' command with subcommands for rule management
   * - Sets up event listeners for interaction handling:
   *   - Autocomplete interactions for role selection
   *   - Chat input command interactions for admin commands
   *   - Button interactions for user verification requests
   * 
   * The '/setup' command includes subcommands for:
   * - add-rule: Create new verification rules
   * - remove-rule: Delete existing rules
   * - list-rules: Display all rules
   * - recover-verification: Recover verification messages
   * - help: Show comprehensive setup help and usage guide
   * 
   * @returns Promise that resolves when slash commands are registered and handlers are set up
   */
  async createSlashCommands(): Promise<void> {
    await this.registerSlashCommands();

    this.client.on('interactionCreate', async (interaction) => {
      // Handle autocomplete interactions for role and slug selection
      if (interaction.isAutocomplete()) {
        if (interaction.commandName === 'setup' && interaction.options.getSubcommand() === 'add-rule') {
          const focusedOption = interaction.options.getFocused(true);
          if (focusedOption.name === 'role') {
            await this.handleRoleAutocomplete(interaction);
          } else if (interaction.options.getString('asset_type') === 'nft') {
            await interaction.respond([]);
          } else if (focusedOption.name === 'slug') {
            await this.handleSlugAutocomplete(interaction);
          } else if (focusedOption.name === 'attribute_key') {
            await this.handleAttributeKeyAutocomplete(interaction);
          } else if (focusedOption.name === 'attribute_value') {
            await this.handleAttributeValueAutocomplete(interaction);
          }
        }
        return;
      }

      // Handle slash command interactions (admin functions)
      if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;
        if (commandName === 'setup') {
          await this.handleSetup(interaction);
        }
      }

      // Handle button interactions (user verification)
      if (interaction.isButton()) {
        if (interaction.customId === 'requestVerification') {
          await this.handleVerificationRequest(interaction);
        } else if (interaction.customId.startsWith('list-rules-')) {
          // Handle pagination buttons for list-rules command
          await this.discordCommandsSvc.handleListRulesPagination(interaction);
        }
      }
    });
  }

  /**
   * Handles Discord slash command interactions for the '/setup' command.
   * 
   * Routes subcommands to their respective handlers in the DiscordCommandsService:
   * - 'add-rule': Creates new verification rules
   * - 'remove-rule': Deletes existing verification rules  
   * - 'list-rules': Displays all verification rules for the channel
   * - 'recover-verification': Recovers lost verification messages
   * - 'help': Shows comprehensive help and usage information
   * 
   * Includes comprehensive error handling to ensure users receive feedback
   * even when operations fail, with appropriate ephemeral responses.
   * 
   * @param interaction - The chat input command interaction from Discord
   */
  async handleSetup(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      // 🔒 SECURITY: Check for Administrator permissions
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({
          content: '🚫 **Access Denied**\n\nThis command requires **Administrator** permissions to use.',
          flags: MessageFlags.Ephemeral
        });
        Logger.warn(`Unauthorized setup command attempt by user ${interaction.user.id} (${interaction.user.tag}) in guild ${interaction.guildId}`);
        return;
      }

      const sub = interaction.options.getSubcommand();
      
      if (sub === 'add-rule') {
        await this.discordCommandsSvc.handleAddRule(interaction);
      } else if (sub === 'remove-rule') {
        await this.discordCommandsSvc.handleRemoveRule(interaction);
      } else if (sub === 'list-rules') {
        await this.discordCommandsSvc.handleListRules(interaction);
      } else if (sub === 'recover-verification') {
        await this.discordCommandsSvc.handleRecoverVerification(interaction);
      } else if (sub === 'audit-log') {
        await this.handleAuditLog(interaction);
      } else if (sub === 'help') {
        await this.handleSetupHelp(interaction);
      }
    } catch (error) {
      Logger.error('Error in handleSetup:', error);
      
      // Check if interaction has been deferred or replied to to avoid API errors
      try {
        if (interaction.deferred) {
          await interaction.editReply({
            content: 'An error occurred while processing your request.'
          });
        } else if (!interaction.replied) {
          await interaction.reply({
            content: 'An error occurred while processing your request.',
            flags: MessageFlags.Ephemeral
          });
        }
      } catch (replyError) {
        Logger.error('Failed to send error message to user:', replyError);
      }
    }
  }

  /**
   * Handles the '/setup help' subcommand.
   * Provides comprehensive guidance on using all setup commands.
   * 
   * @param interaction - The chat input command interaction from Discord
   */
  async handleSetupHelp(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const embed = new EmbedBuilder()
        .setColor(SETUP_HELP_CONTENT.color)
        .setTitle(SETUP_HELP_CONTENT.title)
        .setDescription(SETUP_HELP_CONTENT.description)
        .addFields(SETUP_HELP_CONTENT.fields)
        .setFooter({ text: SETUP_HELP_CONTENT.footer });

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      Logger.error('Error in handleSetupHelp:', error);
      
      try {
        if (interaction.deferred) {
          await interaction.editReply({
            content: 'An error occurred while loading help information.'
          });
        } else if (!interaction.replied) {
          await interaction.reply({
            content: 'An error occurred while loading help information.',
            flags: MessageFlags.Ephemeral
          });
        }
      } catch (replyError) {
        Logger.error('Failed to send help error message to user:', replyError);
      }
    }
  }

  /**
   * Verification request handler for all rule types.
   * 
   * This handler processes verification requests using the verification engine.
   * The system automatically applies verification logic for all verification rules.
   * 
   * @param interaction - The button interaction triggered when a user clicks "Verify Now"
   */
  async handleVerificationRequest(interaction: ButtonInteraction<CacheType>): Promise<void> {
    try {
      // Defer the reply early to prevent timeout
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      
      const guild = interaction.guild;
      if (!guild) throw new Error('Guild not found');
      
      const channel = interaction.channel;
      if (!channel || !('id' in channel)) throw new Error('Channel not found');
      
      // Get all rules for this channel (simplified approach - no more message_id tracking)
      const rules = await this.verificationSvc.getRulesForChannel(
        guild.id,
        channel.id
      );
      
      // If no channel rules found, fall back to all server rules for backwards compatibility
      let serverRules = [];
      if (!rules || rules.length === 0) {
        serverRules = await this.verificationSvc.getAllRulesForServer(guild.id);
      }
      
      const allRules = rules && rules.length > 0 ? rules : serverRules;
      
      if (!allRules || allRules.length === 0) {
        throw new Error('No verification rules found for this server or channel.');
      }
      
      // Route to verification handling
      await this.handleUnifiedVerification(interaction);
      
    } catch (error) {
      Logger.error('Error in handleVerificationRequest:', error);
      if (interaction.deferred) {
        await interaction.editReply({
          content: `Error: ${error.message}`
        });
      } else {
        try {
          await interaction.reply({
            content: `Error: ${error.message}`,
            flags: MessageFlags.Ephemeral
          });
        } catch (replyError) {
          Logger.error('Failed to reply with error:', replyError);
        }
      }
    }
  }

  /**
   * Handles verification flow using the verification system.
   * 
   * @param interaction - The button interaction for verification
   */
  async handleUnifiedVerification(interaction: ButtonInteraction<CacheType>): Promise<void> {
    Logger.debug('Routing to unified verification flow');
    return this.discordVerificationSvc.requestVerification(interaction);
  }

  /**
   * Delegates verification request handling to the Discord verification service.
   * 
   * This method serves as a bridge between the main Discord service and the
   * specialized verification service, maintaining separation of concerns.
   * 
   * @param interaction - The button interaction triggered when a user clicks "Verify Now"
   * @returns Promise that resolves when verification request is processed
   * @deprecated Use handleUnifiedVerification() instead for unified routing
   */
  async requestVerification(interaction: ButtonInteraction<CacheType>): Promise<void> {
    return this.discordVerificationSvc.requestVerification(interaction);
  }

  /**
   * Adds a role to a user in a guild.
   * 
   * @param userId - The ID of the user.
   * @param roleId - The ID of the role to be added.
   * @param guildId - The ID of the guild.
   * @throws Error if the Discord bot is not initialized, guild is not found, or member is not found.
   */
  async addUserRole(
    userId: string, 
    roleId: string,
    guildId: string,
    nonce: string
  ): Promise<void> {
    await this.discordVerificationSvc.addUserRole(userId, roleId, guildId, nonce);
  }

  /**
   * Registers slash commands for the bot.
   * This method sends a POST request to the Discord API to register the slash commands.
   * @returns A Promise that resolves when the slash commands are successfully registered.
   */
  async registerSlashCommands(): Promise<void> {
    const commands = [
      new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Setup the bot for the first time or manage rules')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) // 🔒 ADMIN ONLY
        .addSubcommand(sc =>
          sc.setName('add-rule')
            .setDescription('Add a new verification rule')
            .addChannelOption(option => option.setName('channel').setDescription('Channel').setRequired(true))
            .addStringOption(option => option.setName('role').setDescription('Select existing role or type new role name to create').setRequired(true).setAutocomplete(true))
            .addStringOption(option => option.setName('asset_type').setDescription('Collection type (default: Ethscriptions)').addChoices({ name: 'Ethscriptions', value: 'ethscription' }, { name: 'NFT', value: 'nft' }))
            .addStringOption(option => option.setName('network').setDescription('NFT network (default: Ethereum)').addChoices(...NFT_NETWORKS.map(({ name, value }) => ({ name, value }))))
            .addStringOption(option => option.setName('contract_address').setDescription('NFT contract address on the selected network (requires asset_type:NFT)'))
            .addStringOption(option => option.setName('token_ids').setDescription('NFT token ID, list, or range; ERC-1155 defaults to 0-99'))
            .addStringOption(option => option.setName('collection_name').setDescription('Optional NFT collection name override').setMaxLength(100))
            .addStringOption(option => option.setName('slug').setDescription('Asset slug (leave empty for ALL collections)').setAutocomplete(true))
            .addStringOption(option => option.setName('attribute_key').setDescription('Attribute key (leave empty for ALL attributes)').setAutocomplete(true))
            .addStringOption(option => option.setName('attribute_value').setDescription('Attribute value (leave empty for ALL values)').setAutocomplete(true))
            .addIntegerOption(option => option.setName('min_items').setDescription('Minimum items (default: 1)').setMinValue(1))
        )
        .addSubcommand(sc =>
          sc.setName('remove-rule')
            .setDescription('Remove verification rule(s)')
            .addStringOption(option => option.setName('rule_id').setDescription('Rule ID(s) - single (e.g., 5) or multiple comma-separated (e.g., 1,2,3)').setRequired(true))
        )
        .addSubcommand(sc =>
          sc.setName('list-rules')
            .setDescription('List all verification rules')
        )
        .addSubcommand(sc =>
          sc.setName('recover-verification')
            .setDescription('Recover verification setup for a channel (creates new message, updates orphaned rules)')
            .addChannelOption(option => option.setName('channel').setDescription('Channel to recover verification for').setRequired(true))
        )
        .addSubcommand(sc =>
          sc.setName('help')
            .setDescription('Show help and information about setup commands')
        )
        .addSubcommand(sc =>
          sc.setName('audit-log')
            .setDescription('View role assignment audit log for this server')
            .addIntegerOption(option => 
              option.setName('days')
                .setDescription('Number of days of history to show (default: 1, max: 30)')
                .setMinValue(1)
                .setMaxValue(30)
            )
        )
    ];
    Logger.debug('Reloading application /slash commands.', `${commands.length} commands`);
    try {
      await this.rest.put(
        Routes.applicationCommands(EnvironmentConfig.DISCORD_CLIENT_ID!),
        { body: commands },
      );
      Logger.debug('Successfully reloaded application /slash commands.', `${commands.length} commands`);
    } catch (error) {
      Logger.error('Failed to register slash commands:', error);
    }
  }

  /**
   * Throws an error by editing the stored interaction with an error message.
   * @param nonce - The nonce associated with the stored interaction.
   * @param message - The error message to display.
   */
  async throwError(nonce: string, message: string): Promise<void> {
    return this.discordVerificationSvc.throwError(nonce, message);
  }

  /**
   * Check if there's already a verification message in the specified channel
   * @param channel - The Discord channel to search in
   * @returns True if a verification message exists, false otherwise
   */
  async findExistingVerificationMessage(channel: GuildTextBasedChannel): Promise<boolean> {
    return this.discordMessageSvc.findExistingVerificationMessage(channel);
  }

  /**
   * Get Discord user information by user ID
   */
  async getUser(userId: string): Promise<any> {
    try {
      if (!this.client) {
        // Silently return null when client isn't initialized (for non-critical name resolution)
        return null;
      }
      const user = await this.client.users.fetch(userId);
      return user;
    } catch (error) {
      Logger.warn(`Failed to fetch user ${userId}:`, error.message);
      return null;
    }
  }

  /**
   * Get Discord guild information by guild ID
   */
  async getGuild(guildId: string): Promise<any> {
    try {
      if (!this.client) {
        // Silently return null when client isn't initialized (for non-critical name resolution)
        return null;
      }
      const guild = await this.client.guilds.fetch(guildId);
      return guild;
    } catch (error) {
      Logger.warn(`Failed to fetch guild ${guildId}:`, error.message);
      return null;
    }
  }

  /**
   * Get Discord role information by guild ID and role ID
   */
  async getRole(guildId: string, roleId: string): Promise<any> {
    try {
      if (!this.client) {
        // Silently return null when client isn't initialized (for non-critical name resolution)
        return null;
      }
      const guild = await this.client.guilds.fetch(guildId);
      const role = await guild.roles.fetch(roleId);
      return role;
    } catch (error) {
      Logger.warn(`Failed to fetch role ${roleId} in guild ${guildId}:`, error.message);
      return null;
    }
  }

  /**
   * Handles role autocomplete for the add-rule command.
   * @param interaction - The autocomplete interaction.
   */
  async handleRoleAutocomplete(interaction: any): Promise<void> {
    try {
      // Guard against handling interactions before full initialization
      if (!this.isInitialized) {
        Logger.debug('Ignoring autocomplete interaction - service not fully initialized yet');
        await this.safeRespond(interaction, []);
        return;
      }

      const focusedValue = interaction.options.getFocused(); // Keep original casing
      const focusedValueLower = focusedValue.toLowerCase(); // Use for filtering only
      const guild = interaction.guild;
      
      if (!guild) {
        await this.safeRespond(interaction, []);
        return;
      }

      // Get bot member to check role hierarchy
      const botMember = guild.members.me;
      if (!botMember) {
        await this.safeRespond(interaction, []);
        return;
      }

      // Get bot's highest role position
      const botHighestRole = botMember.roles.highest;

      // Get all roles in the guild that the bot can assign
      const roles = guild.roles.cache
        .filter(role => role.name !== '@everyone')
        .filter(role => role.name.toLowerCase().includes(focusedValueLower))
        .filter(role => {
          // Bot can only assign roles that are lower in hierarchy than its highest role
          return role.position < botHighestRole.position;
        })
        .filter(role => {
          // Also check if the role is manageable by the bot
          return role.editable;
        })
        .sort((a, b) => a.name.localeCompare(b.name))
        .first(24); // Discord allows max 25 choices, save 1 for "create new" option

      const choices = roles.map(role => {
        // Format with @ prefix for better UX
        return {
          name: `@${role.name}`,
          value: role.name
        };
      });

      // Check if any role (manageable or not) already exists with the focused value
      const existingRoleWithName = guild.roles.cache.find(role => 
        role.name.toLowerCase() === focusedValueLower
      );

      // Add option to create new role if there's space, user has typed something, 
      // and no role with that name already exists
      if (choices.length < 25 && focusedValue.length > 0 && !existingRoleWithName) {
        choices.push({
          name: `💡 Create new role: "${focusedValue}"`, // Use original casing in display
          value: focusedValue // Use original casing as value
        });
      }

      await this.safeRespond(interaction, choices);
    } catch (error) {
      Logger.error('Error in handleRoleAutocomplete:', error);
      // Use safeRespond for graceful error handling
      await this.safeRespond(interaction, []);
    }
  }

  /**
   * Handles slug autocomplete for the add-rule command.
   * Only allows selection of existing slugs from the marketplace database.
   * @param interaction - The autocomplete interaction.
   */
  async handleSlugAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
    try {
      // Guard against handling interactions before full initialization
      if (!this.isInitialized) {
        Logger.debug('Ignoring autocomplete interaction - service not fully initialized yet');
        await this.safeRespond(interaction, []);
        return;
      }

      const focusedValue = interaction.options.getFocused().toLowerCase();
      
      // Get all available slugs with cache and timeout protection
      const allSlugs = await Promise.race([
        this.dataSvc.getAllSlugs(),
        this.timeoutPromise(2000, [])
      ]);
      
      // Filter slugs based on user input and exclude 'all-collections' as it's handled by leaving slug empty
      const filteredSlugs = allSlugs
        .filter(slug => slug !== 'all-collections') // Exclude the special 'all-collections' option
        .filter(slug => slug.toLowerCase().includes(focusedValue))
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 25); // Discord allows max 25 choices

      const choices = filteredSlugs.map(slug => ({
        name: slug,
        value: slug
      }));

      await this.safeRespond(interaction, choices);
    } catch (error) {
      Logger.error('Error in handleSlugAutocomplete:', error);
      // Use safeRespond for graceful error handling
      await this.safeRespond(interaction, []);
    }
  }

  /**
   * Handles attribute key autocomplete for the add-rule command.
   * Only shows attribute keys if a slug has been selected.
   * @param interaction - The autocomplete interaction.
   */
  async handleAttributeKeyAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
    try {
      // Guard against handling interactions before full initialization
      if (!this.isInitialized) {
        Logger.debug('Ignoring autocomplete interaction - service not fully initialized yet');
        await this.safeRespond(interaction, []);
        return;
      }

      const focusedValue = interaction.options.getFocused().toLowerCase();
      const selectedSlug = interaction.options.getString('slug');
      
      // Only provide autocomplete if a slug has been specifically selected
      if (!selectedSlug) {
        await this.safeRespond(interaction, [
          { name: 'Please select a collection first', value: 'ALL' }
        ]);
        return;
      }
      
      // Add debug logging to track context
      Logger.debug(`Autocomplete for attribute_key: slug="${selectedSlug}", search="${focusedValue}"`);
      
      // Get all available attribute keys for the selected slug with cache and timeout protection
      const allKeys = await Promise.race([
        this.cacheSvc.getAttributeKeys(selectedSlug, this.dataSvc),
        this.timeoutPromise(2000, [])
      ]);
      
      // Improved filtering: show all options if user is editing "ALL" or field is empty
      // Also show all options if focused value is very short (1-2 chars) to avoid over-filtering
      let filteredKeys;
      if (!focusedValue || focusedValue === 'all' || focusedValue.length <= 2) {
        // Show all options when starting fresh or editing "ALL"
        filteredKeys = allKeys.slice(0, 25);
      } else {
        // Only filter when user has typed something specific (3+ chars)
        filteredKeys = allKeys
          .filter(key => key.toLowerCase().includes(focusedValue))
          .slice(0, 25);
      }
      
      // Sort the results alphabetically (no need to handle 'ALL' since it's not included)
      filteredKeys.sort((a, b) => a.localeCompare(b));

      const choices = filteredKeys.map(key => ({
        name: key,
        value: key
      }));

      // Ensure we always have at least one option
      if (choices.length === 0) {
        choices.push({ name: 'No attributes found', value: 'ALL' });
      }

      await this.safeRespond(interaction, choices);
    } catch (error) {
      Logger.error('Error in handleAttributeKeyAutocomplete:', error);
      // Use safeRespond for graceful error handling
      await this.safeRespond(interaction, [
        { name: 'Error loading attributes', value: 'ALL' }
      ]);
    }
  }

  /**
   * Enhanced attribute value autocomplete that allows manual entry
   * Prioritizes user input and includes typed values even if not in "rarest 25"
   * Only shows attribute values if both slug and attribute key have been selected.
   * @param interaction - The autocomplete interaction.
   */
  async handleAttributeValueAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
    try {
      // Guard against handling interactions before full initialization
      if (!this.isInitialized) {
        Logger.debug('Ignoring autocomplete interaction - service not fully initialized yet');
        await this.safeRespond(interaction, []);
        return;
      }

      const focusedValue = interaction.options.getFocused();
      const selectedSlug = interaction.options.getString('slug');
      const selectedAttributeKey = interaction.options.getString('attribute_key');
      
      // Only provide autocomplete if both slug and attribute key have been specifically selected
      if (!selectedSlug || !selectedAttributeKey) {
        await this.safeRespond(interaction, [
          { name: 'Please select collection and attribute key first', value: 'ALL' }
        ]);
        return;
      }
      
      Logger.debug(`Autocomplete for attribute_value: slug="${selectedSlug}", key="${selectedAttributeKey}", search="${focusedValue}"`);

      // Handle empty or very short input - show rarest 25
      if (!focusedValue || focusedValue.length <= 2) {
        const values = await Promise.race([
          this.cacheSvc.getAttributeValues(selectedSlug, selectedAttributeKey, this.dataSvc),
          this.timeoutPromise(2000, [])
        ]);

        const choices = values.slice(0, 25).map(value => ({
          name: value,
          value: value
        }));

        await this.safeRespond(interaction, choices.length > 0 ? choices : [
          { name: 'No values available', value: 'ALL' }
        ]);
        return;
      }

      // For longer input, get ALL values and prioritize user's input
      const allValues = await Promise.race([
        this.cacheSvc.getAllAttributeValues(selectedSlug, selectedAttributeKey, this.dataSvc),
        this.timeoutPromise(2000, [])
      ]);

      if (allValues.length === 0) {
        await this.safeRespond(interaction, [
          { name: 'No values found', value: 'ALL' }
        ]);
        return;
      }

      // Smart filtering with user input priority
      const userInput = focusedValue.toLowerCase();
      const choices = [];

      // 1. Exact match (highest priority)
      const exactMatch = allValues.find(value => 
        value.toLowerCase() === userInput
      );
      if (exactMatch) {
        choices.push({ name: `✓ ${exactMatch}`, value: exactMatch });
      }

      // 2. Starts with user input
      const startsWith = allValues.filter(value => 
        value.toLowerCase().startsWith(userInput) && 
        value.toLowerCase() !== userInput // Don't duplicate exact match
      );
      
      // 3. Contains user input
      const contains = allValues.filter(value => 
        value.toLowerCase().includes(userInput) && 
        !value.toLowerCase().startsWith(userInput) // Don't duplicate starts-with
      );

      // Combine results, limiting to 25 total
      const combinedResults = [
        ...startsWith.slice(0, 12), // Up to 12 "starts with" matches
        ...contains.slice(0, 12)    // Up to 12 "contains" matches
      ];

      // Add to choices
      combinedResults.forEach(value => {
        choices.push({ name: value, value: value });
      });

      // If no matches found but user typed something, allow manual entry
      if (choices.length === 0) {
        choices.push({ 
          name: `✏️ Use "${focusedValue}" (manual entry)`, 
          value: focusedValue 
        });
      }

      // Ensure we don't exceed Discord's 25 choice limit
      await this.safeRespond(interaction, choices.slice(0, 25));

    } catch (error) {
      Logger.error('Error in handleAttributeValueAutocomplete:', error);
      await this.safeRespond(interaction, [
        { name: 'Error loading values', value: 'ALL' }
      ]);
    }
  }

  /**
   * Handles the audit-log subcommand to show role assignment history
   * 
   * Displays a Discord embed with role assignment/removal history for the server.
   * Shows username, role name, wallet address (truncated), and timestamp for each entry.
   * Supports configurable time range (1-30 days, default 7).
   * 
   * Data is pulled from verifier_user_roles table joined with user_wallets table
   * to support both single-address and multi-wallet users.
   * 
   * @param interaction - Discord slash command interaction
   */
  async handleAuditLog(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      
      const serverId = interaction.guildId;
      if (!serverId) {
        await interaction.editReply({
          content: '❌ This command can only be used in a server.'
        });
        return;
      }

      const days = interaction.options.getInteger('days') || 1;
      
      // Validate days parameter
      if (days < 1 || days > 30) {
        await interaction.editReply({
          content: '❌ Days parameter must be between 1 and 30.'
        });
        return;
      }
      
      Logger.log(`Admin ${interaction.user.tag} requested ${days}-day audit log for server ${serverId}`);
      
      // Get audit data from database with error handling
      let auditEntries;
      try {
        auditEntries = await this.dbSvc.getServerAuditLog(serverId, days);
        Logger.debug(`Retrieved ${auditEntries?.length || 0} audit entries from database`);
      } catch (dbError) {
        Logger.error(`Database error fetching audit log:`, dbError);
        await interaction.editReply({
          content: `❌ **Database Error**\n\nFailed to retrieve audit log data. This may be due to:\n• No data available for the selected time period\n• Database connectivity issues\n\nPlease try again with a different time range or contact support if the issue persists.`
        });
        return;
      }
      
      try {
        // Create simple, bulletproof embed
        const embed = new EmbedBuilder()
          .setTitle(`Role Assignment Audit Log`)
          .setDescription(`**Server:** ${interaction.guild?.name || 'Unknown'}`)
          .setColor(0xc3ff00)
          .setTimestamp();

        Logger.debug(`Created base embed for ${auditEntries?.length || 0} entries`);

        // Build simple field content without markdown links
        let fieldValue = '';
        
        if (auditEntries && auditEntries.length > 0) {
          Logger.debug(`Processing ${auditEntries.length} audit entries`);
          
          for (let i = 0; i < auditEntries.length; i++) {
            const entry = auditEntries[i];
            try {
              // Use updated_at for more accurate activity timestamps (especially for reactivated roles)
              const date = new Date(entry.updated_at || entry.created_at);
              if (isNaN(date.getTime())) {
                Logger.warn(`Invalid date for entry ${i + 1}: ${entry.updated_at || entry.created_at}`);
                continue;
              }
              
              const formattedDate = `<t:${Math.floor(date.getTime() / 1000)}:R>`;
              
              // Get the wallet address and create clickable link
              let walletDisplay = 'Unknown';
              if (entry.user_wallets && Array.isArray(entry.user_wallets) && entry.user_wallets.length > 0) {
                const fullAddress = entry.user_wallets[0].address;
                if (fullAddress && typeof fullAddress === 'string' && fullAddress.length > 10) {
                  const truncatedAddress = `${fullAddress.substring(0, 5)}...${fullAddress.substring(fullAddress.length - 5)}`;
                  const walletLink = `[${truncatedAddress}](https://ethscriptions.com/${fullAddress})`;
                  walletDisplay = walletLink;
                }
              }
              
              const userName = entry.user_name || 'Unknown User';
              const roleName = entry.role_name || entry.role_id || 'Unknown Role';
              
              // Determine action type based on status and timestamps
              let actionText = '✅'; // Default for active roles
              if (entry.status === 'revoked') {
                actionText = '🗑️';
              } else if (entry.status === 'active') {
                // Check if this was a reactivation (re-verification)
                const createdDate = new Date(entry.created_at);
                const updatedDate = new Date(entry.updated_at);
                const timeDiffHours = Math.abs(updatedDate.getTime() - createdDate.getTime()) / (1000 * 60 * 60);
                
                // If updated more than 1 hour after creation, consider it a re-verification
                if (timeDiffHours > 1) {
                  actionText = '🔄'; // Re-verification
                } else {
                  actionText = '✅'; // Initial verification
                }
              }
              
              const entryLine = `${actionText}│${userName}│${roleName} (${walletDisplay}) ${formattedDate}\n`;
              
              fieldValue += entryLine;
              
            } catch (entryError) {
              Logger.error(`Error processing entry ${i + 1}:`, entryError);
              // Continue with next entry
            }
          }
        } else {
          fieldValue = 'No activity found in the specified time period.';
          Logger.debug('No entries found, using default message');
        }

        // Ensure field value isn't too long (Discord limit is 1024 chars per field)
        if (fieldValue.length > 1000) {
          fieldValue = fieldValue.substring(0, 900) + '\n... (truncated)';
        }

        Logger.debug(`Final field value length: ${fieldValue.length}`);

        // Add the field to the embed
        embed.addFields({
          name: 'Activity:',
          value: fieldValue.trim() || 'No activity found',
          inline: false
        });

        // Add emoji key field only if there are results
        if (auditEntries && auditEntries.length > 0) {
          embed.addFields({
            name: '​', // Zero-width space for invisible field name
            value: '**Legend:**\u2003✅ = Initial\u2003🔄 = Re-verified\u2003🗑️ = Removed',
            inline: false
          });
        }

        // Add footer with entry count and period
        const entryCount = auditEntries ? auditEntries.length : 0;
        embed.setFooter({ 
          text: `Showing ${entryCount} entries │ Period: Last ${days} day${days > 1 ? 's' : ''}` 
        });

        Logger.debug('Attempting to send embed...');

        await interaction.editReply({
          embeds: [embed]
        });
        
        Logger.debug('Successfully sent audit log embed');
        
      } catch (embedError) {
        Logger.error('Error creating or sending embed:', embedError);
        Logger.error('Embed error details:', {
          message: embedError.message,
          code: embedError.code,
          stack: embedError.stack
        });
        
        // Fallback to simple text response
        const entryCount = auditEntries ? auditEntries.length : 0;
        const fallbackContent = `📋 **Audit Log (Last ${days} day${days > 1 ? 's' : ''})**\n\n` +
          `Found ${entryCount} role assignment${entryCount !== 1 ? 's' : ''} in the specified period.\n\n` +
          `⚠️ **Display Issue**: Unable to format detailed view due to technical error.`;
        
        await interaction.editReply({
          content: fallbackContent
        });
      }
      
    } catch (error) {
      Logger.error('Error in handleAuditLog:', error);
      Logger.error('Error details:', {
        message: error.message,
        code: error.code,
        stack: error.stack,
        name: error.name
      });
      
      try {
        await interaction.editReply({
          content: '❌ An error occurred while retrieving the audit log. Please try again later.'
        });
      } catch (editError) {
        Logger.error('Failed to edit reply in handleAuditLog:', editError);
      }
    }
  }

  /**
   * Safe response helper that handles expired interactions
   */
  private async safeRespond(interaction: AutocompleteInteraction, choices: any[]): Promise<void> {
    try {
      await interaction.respond(choices.slice(0, 25)); // Ensure max 25 choices
    } catch (error) {
      if (error.code === 10062) {
        Logger.debug('Autocomplete interaction expired - ignoring');
      } else {
        Logger.warn('Failed to respond to autocomplete:', error.message);
      }
    }
  }

  /**
   * Helper method to create timeout promises for autocomplete operations
   */
  private timeoutPromise<T>(timeoutMs: number, defaultValue: T): Promise<T> {
    return new Promise<T>((resolve) => setTimeout(() => resolve(defaultValue), timeoutMs));
  }
}
