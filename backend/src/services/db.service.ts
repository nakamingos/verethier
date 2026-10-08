import { Injectable, Logger, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { CONSTANTS } from '@/constants';
import { DbResult, ServerRecord, RoleRecord } from '@/models/db.interface';
import { NftRuleFields, VerifierRole } from '@/models/verifier-role.interface';

/**
 * Database Service
 * 
 * This service provides data access layer for the verification system using Supabase.
 * It handles:
 * - Server and user management
 * - Verification rule CRUD operations
 * - Role management and migration
 * - Asset verification tracking
 * 
 * Database Schema:
 * - verifier_servers: Discord server information
 * - verifier_users: User verification data
 * - verifier_roles: Verification rules configuration
 * - verification_queue: Pending verifications
 * 
 * @example
 * ```typescript
 * // Add or update a server
 * await dbService.addUpdateServer('123456789', 'My Server', 'role123');
 * 
 * // Get verification rules
 * const rules = await dbService.getVerificationRules('123456789', 'channel123');
 * ```
 */
@Injectable()
export class DbService {
  private readonly logger = new Logger(DbService.name);

  constructor(
    @Inject('SUPABASE_CLIENT') private readonly supabase: SupabaseClient
  ) {}

  /**
   * Adds or updates a Discord server in the database.
   * 
   * Uses upsert operation to either create new server record or update existing one.
   * This is typically called when the bot joins a new server or when server
   * configuration changes.
   * 
   * @param serverId - Discord server (guild) ID
   * @param serverName - Human-readable server name
   * @param roleId - Default role ID for this server
   * @returns Promise resolving to the server record or null on error
   * @throws Error if database operation fails
   */
  async addUpdateServer(
    serverId: string, 
    serverName: string,
    roleId: string
  ): Promise<DbResult<ServerRecord> | null> {

    const { data, error } = await this.supabase
      .from('verifier_servers')
      .upsert({
        id: serverId,
        name: serverName,
        role_id: roleId
      });

    if (error) throw error;
    return data;
  }
  
  /**
   * Retrieves user data for a specific Discord user.
   * 
   * Returns user verification history and associated server data.
   * Used for user verification status checks and history tracking.
   * 
   * @param userId - Discord user ID
   * @returns Promise resolving to user data object or null if not found
   * @throws Error if database query fails
   */
  async getUserServers(userId: string): Promise<any> {
    const { data, error } = await this.supabase
      .from('verifier_users')
      .select('*')
      .eq('user_id', userId);

    if (error) throw error;
    return data[0];
  }

  async addServerToUser(
    userId: string, 
    serverId: string, 
    role: string
  ) {
  
    // Step 1: Retrieve the current user data with the servers JSONB object
    let { data: userData, error: fetchError } = await this.supabase
      .from('verifier_users')
      .select('servers')
      .eq('user_id', userId);
  
    if (fetchError) throw fetchError;
  
    const servers = userData[0]?.servers || {};
    servers[serverId] = role;
  
    const { data, error } = await this.supabase
      .from('verifier_users')
      .upsert({
        user_id: userId,
        servers: servers
      }, {
        onConflict: 'user_id'
      });
  
    if (error) throw error;
    return data;
  }  

  async getServerRole(serverId: string): Promise<any> {
    const { data, error } = await this.supabase
      .from('verifier_servers')
      .select('role_id')
      .eq('id', serverId);

    if (error) throw error;
    return data[0]?.role_id;
  }

  // New methods for v2:

  private filterRuleAsset(query: any, slug: string, assetFields?: NftRuleFields): any {
    if (assetFields?.asset_type === 'ordinal') return query.eq('asset_type', 'ordinal').eq('slug', slug);
    if (assetFields?.asset_type !== 'nft') return query.eq('asset_type', 'ethscription').eq('slug', slug);
    query = query.eq('asset_type', 'nft').eq('chain_id', assetFields.chain_id)
      .eq('contract_address', assetFields.contract_address).eq('token_standard', assetFields.token_standard);
    return assetFields.token_ids === null
      ? query.is('token_ids', null)
      : query.eq('token_ids', `{${assetFields.token_ids.join(',')}}`);
  }

  async saveRoleCheckDetails(assignmentId: string, details: any): Promise<void> {
    const { error } = await this.supabase.from('verifier_user_roles')
      .update({ verification_data: details }).eq('id', assignmentId);
    if (error) throw error;
  }
  
  /**
   * Check if a rule with the same criteria already exists for a different role
   */
  async checkForDuplicateRule(
    serverId: string,
    channelId: string,
    slug: string,
    attributeKey: string,
    attributeValue: string,
    minItems: number,
    excludeRoleId?: string,
    assetFields?: NftRuleFields
  ): Promise<any> {
    // Use the same defaults as addRoleMapping for consistent comparison
    const finalSlug = slug || 'ALL';
    const finalAttrKey = attributeKey || 'ALL';
    const finalAttrVal = attributeValue || 'ALL';
    const finalMinItems = minItems != null ? minItems : 1;

    let query = this.supabase
      .from('verifier_rules')
      .select('*')
      .eq('server_id', serverId)
      .eq('channel_id', channelId)
      .eq('attribute_key', finalAttrKey)
      .eq('attribute_value', finalAttrVal)
      .eq('min_items', finalMinItems);

    query = this.filterRuleAsset(query, finalSlug, assetFields);

    // Exclude the current role if we're checking for updates
    if (excludeRoleId) {
      query = query.neq('role_id', excludeRoleId);
    }

    const { data, error } = await query;

    if (error) {
      Logger.error('Error checking for duplicate rules:', error);
      throw error;
    }

    return data && data.length > 0 ? data[0] : null;
  }

  async addRoleMapping(
    serverId: string,
    serverName: string,
    channelId: string,
    channelName: string,
    slug: string,
    roleId: string,
    roleName: string,
    attrKey: string,
    attrVal: string,
    minItems: number,
    assetFields?: NftRuleFields
  ): Promise<any> {
    // Use meaningful defaults instead of NULLs for better database constraints
    const finalSlug = slug || 'ALL';
    const finalAttrKey = attrKey || 'ALL';
    const finalAttrVal = attrVal || 'ALL';
    const finalMinItems = minItems != null ? minItems : 1;

    const { data, error } = await this.supabase
      .from('verifier_rules')
      .insert({
        server_id: serverId,
        server_name: serverName,
        channel_id: channelId,
        channel_name: channelName,
        slug: assetFields?.asset_type === 'nft' ? null : finalSlug,
        role_id: roleId,
        role_name: roleName,
        attribute_key: finalAttrKey,
        attribute_value: finalAttrVal,
        min_items: finalMinItems,
        ...(assetFields?.asset_type === 'nft' || assetFields?.asset_type === 'ordinal' ? assetFields : {})
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async getRoleMappings(serverId: string, channelId?: string): Promise<any[]> {
    try {
      let query = this.supabase
        .from('verifier_rules')
        .select('*')
        .eq('server_id', serverId);
      if (channelId) {
        query = query.eq('channel_id', channelId);
      }
      const { data, error } = await query;
      if (error) {
        this.logger.error('Supabase error in getRoleMappings:', error);
        this.logger.error('Error details:', JSON.stringify(error, null, 2));
        throw error;
      }
      return data || [];
    } catch (error) {
      this.logger.error('Exception in getRoleMappings:', error);
      throw error;
    }
  }

  async deleteRoleMapping(ruleId: string, serverId: string): Promise<void> {
    // Only delete if rule belongs to this server
    const { data, error: fetchError } = await this.supabase
      .from('verifier_rules')
      .select('server_id')
      .eq('id', ruleId);
    if (fetchError) throw fetchError;
    if (!data || data.length === 0 || data[0].server_id !== serverId) {
      throw new Error('Rule does not belong to this server');
    }
    const { error } = await this.supabase
      .from('verifier_rules')
      .delete()
      .eq('id', ruleId)
      .eq('server_id', serverId);
    if (error) throw error;
  }

  async logUserRole(
    userId: string, 
    serverId: string, 
    roleId: string,
    userName?: string,
    serverName?: string,
    roleName?: string
  ): Promise<void> {
    const { error } = await this.supabase
      .from('verifier_user_roles')
      .insert({
        user_id: userId,
        server_id: serverId,
        role_id: roleId,
        verified_at: new Date().toISOString(),
        user_name: userName || null,
        server_name: serverName || null,
        role_name: roleName || null
      });

    if (error) {
      Logger.error('Error logging user role:', error);
      throw error;
    }

    // Role assignment logged successfully
  }

  // Get all verification rules for a server (unified approach)
  async getAllRulesForServer(serverId: string): Promise<any[]> {
    const { data: rules, error } = await this.supabase
      .from('verifier_rules')
      .select('*')
      .eq('server_id', serverId);
    if (error) throw error;
    return rules || [];
  }

  // Method maintained for backwards compatibility - now uses unified approach
  async getAllRulesWithCompat(serverId: string): Promise<any[]> {
    return await this.getAllRulesForServer(serverId);
  }

  // Methods maintained for backwards compatibility but simplified
  // Note: These methods now work with the unified verifier_rules table only
  async removeAllRoles(serverId: string): Promise<{ removed: Array<{ role_id: string, name: string }> }> {
    // In the unified system, roles are identified by special slug/attributes
    const { data: roles, error } = await this.supabase
      .from('verifier_rules')
      .select('role_id, role_name')
      .eq('server_id', serverId)
      .eq('slug', 'simple_collection');
    
    if (error) throw error;
    if (!roles || roles.length === 0) {
      return { removed: [] };
    }

    // Remove rules
    await this.supabase
      .from('verifier_rules')
      .delete()
      .eq('server_id', serverId)
      .eq('slug', 'simple_collection');

    return { 
      removed: roles.map(rule => ({ 
        role_id: rule.role_id, 
        name: rule.role_name || 'Role' 
      }))
    };
  }

  // Get all rules for a server (now using unified table)
  async getRoles(serverId: string): Promise<DbResult<RoleRecord[]>> {
    const { data, error } = await this.supabase
      .from('verifier_rules')
      .select('role_id, role_name')
      .eq('server_id', serverId)
      .eq('slug', 'simple_collection');
    
    // Transform to match expected format
    const transformedData = data?.map(rule => ({
      role_id: rule.role_id,
      name: rule.role_name || 'Role'
    })) || [];

    return { data: transformedData, error };
  }

  // Check if a rule already exists for server, channel, role, and slug
  async ruleExists(serverId: string, channelId: string, roleId: string, slug: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('verifier_rules')
      .select('id')
      .eq('server_id', serverId)
      .eq('channel_id', channelId)
      .eq('role_id', roleId)
      .eq('slug', slug);
    if (error) throw error;
    return !!(data && data.length > 0);
  }

  /**
   * Finds the first rule with a non-null message_id for a given guild and channel.
   */
  async findRuleWithMessage(guildId: string, channelId: string): Promise<VerifierRole | null> {
    const { data, error } = await this.supabase
      .from('verifier_rules')
      .select('*')
      .eq('server_id', guildId)
      .eq('channel_id', channelId)
      .not('message_id', 'is', null)
      .limit(1);
    if (error) throw error;
    return data && data.length > 0 ? data[0] as VerifierRole : null;
  }

  /**
   * Updates the message_id for a specific rule.
   */
  async updateRuleMessageId(ruleId: number, messageId: string): Promise<void> {
    const { error } = await this.supabase
      .from('verifier_rules')
      .update({ message_id: messageId })
      .eq('id', ruleId);
    if (error) throw error;
  }

  /**
   * Finds a rule by message_id for a given guild and channel.
   */
  async findRuleByMessageId(guildId: string, channelId: string, messageId: string): Promise<VerifierRole | null> {
    const { data, error } = await this.supabase
      .from('verifier_rules')
      .select('*')
      .eq('server_id', guildId)
      .eq('channel_id', channelId)
      .eq('message_id', messageId)
      .limit(1);
    if (error) throw error;
    return data && data.length > 0 ? data[0] as VerifierRole : null;
  }

  /**
   * Finds ALL rules by message_id for a given guild and channel.
   * This supports multiple roles being assigned for the same verification criteria.
   */
  async findRulesByMessageId(guildId: string, channelId: string, messageId: string): Promise<VerifierRole[]> {
    const { data, error } = await this.supabase
      .from('verifier_rules')
      .select('*')
      .eq('server_id', guildId)
      .eq('channel_id', channelId)
      .eq('message_id', messageId);
    if (error) throw error;
    return (data || []) as VerifierRole[];
  }

  /**
   * Gets all rules for a specific channel in a guild.
   * This includes both channel-specific rules AND universal rules (channel_id='ALL').
   * Universal rules allow legacy migrations and server-wide verification buttons.
   */
  async getRulesByChannel(guildId: string, channelId: string): Promise<VerifierRole[]> {
    const { data, error } = await this.supabase
      .from('verifier_rules')
      .select('*')
      .eq('server_id', guildId)
      .or(`channel_id.eq.${channelId},channel_id.eq.ALL`);
    if (error) throw error;
    return data || [];
  }

  async findConflictingRule(
    serverId: string,
    channelId: string,
    roleId: string,
    slug: string,
    attrKey: string,
    attrVal: string,
    minItems: number
  ): Promise<any> {
    // Use the same defaults as addRoleMapping for consistent conflict detection
    const finalSlug = slug || 'ALL';
    const finalAttrKey = attrKey || 'ALL';
    const finalAttrVal = attrVal || 'ALL';
    const finalMinItems = minItems != null ? minItems : 1;

    const { data, error } = await this.supabase
      .from('verifier_rules')
      .select('*')
      .eq('server_id', serverId)
      .eq('channel_id', channelId)
      .eq('role_id', roleId)
      .eq('slug', finalSlug)
      .eq('attribute_key', finalAttrKey)
      .eq('attribute_value', finalAttrVal)
      .eq('min_items', finalMinItems)
      .single();
    
    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
      throw error;
    }
    return data;
  }

  async checkForExactDuplicateRule(
    serverId: string,
    channelId: string,
    slug: string,
    attributeKey: string,
    attributeValue: string,
    minItems: number,
    roleId: string,
    assetFields?: NftRuleFields
  ): Promise<any> {
    // Use the same defaults as addRoleMapping for consistent comparison
    const finalSlug = slug || 'ALL';
    const finalAttrKey = attributeKey || 'ALL';
    const finalAttrVal = attributeValue || 'ALL';
    const finalMinItems = minItems != null ? minItems : 1;

    let query = this.supabase
      .from('verifier_rules')
      .select('*')
      .eq('server_id', serverId)
      .eq('channel_id', channelId)
      .eq('attribute_key', finalAttrKey)
      .eq('attribute_value', finalAttrVal)
      .eq('min_items', finalMinItems)
      .eq('role_id', roleId);

    query = this.filterRuleAsset(query, finalSlug, assetFields);
    const { data, error } = await query;

    if (error) {
      Logger.error('Error checking for exact duplicate rules:', error);
      throw error;
    }

    return data && data.length > 0 ? data[0] : null;
  }

  // =======================================
  // DYNAMIC ROLE MANAGEMENT METHODS
  // =======================================

  /**
   * Dynamic Role Management Methods
   * These methods support the DynamicRoleService for automatic role verification
   */

  /**
   * Get all active role assignments that need verification
   */
  async getActiveRoleAssignments(): Promise<any[]> {
    try {
      const { data, error } = await this.supabase
        .from('verifier_user_roles')
        .select('*')
        .eq('status', 'active')
        .order('last_checked', { ascending: true });

      if (error) {
        this.logger.error('Error fetching active role assignments:', error);
        throw error;
      }

      return data || [];
    } catch (error) {
      this.logger.error('Error fetching active role assignments:', error);
      throw error;
    }
  }

  /**
   * Get a rule by ID
   */
  async getRuleById(ruleId: string): Promise<any> {
    try {
      const { data, error } = await this.supabase
        .from('verifier_rules')
        .select('*')
        .eq('id', ruleId)
        .single();

      if (error) {
        this.logger.error(`Error fetching rule ${ruleId}:`, error);
        throw error;
      }

      return data;
    } catch (error) {
      this.logger.error(`Error fetching rule ${ruleId}:`, error);
      throw error;
    }
  }

  /**
   * Update role assignment status
   */
  async updateRoleAssignmentStatus(assignmentId: string, status: string): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('verifier_user_roles')
        .update({ 
          status,
          updated_at: new Date().toISOString()
        })
        .eq('id', assignmentId);

      if (error) {
        this.logger.error(`Error updating role assignment ${assignmentId} status:`, error);
        throw error;
      }
    } catch (error) {
      this.logger.error(`Error updating role assignment ${assignmentId} status:`, error);
      throw error;
    }
  }

  /**
   * Update last verified timestamp
   */
  async updateLastVerified(assignmentId: string): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('verifier_user_roles')
        .update({ 
          last_checked: new Date().toISOString(),
          verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', assignmentId);

      if (error) {
        this.logger.error(`Error updating last verified for assignment ${assignmentId}:`, error);
        throw error;
      }
    } catch (error) {
      this.logger.error(`Error updating last verified for assignment ${assignmentId}:`, error);
      throw error;
    }
  }

  /**
   * Get active assignments for a specific user
   */
  async getUserActiveAssignments(userId: string): Promise<any[]> {
    try {
      const { data, error } = await this.supabase
        .from('verifier_user_roles')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active');

      if (error) {
        this.logger.error(`Error fetching active assignments for user ${userId}:`, error);
        throw error;
      }

      return data || [];
    } catch (error) {
      this.logger.error(`Error fetching active assignments for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get active assignments for a specific rule
   */
  async getRuleActiveAssignments(ruleId: string): Promise<any[]> {
    try {
      const { data, error } = await this.supabase
        .from('verifier_user_roles')
        .select('*')
        .eq('rule_id', ruleId)
        .eq('status', 'active');

      if (error) {
        this.logger.error(`Error fetching active assignments for rule ${ruleId}:`, error);
        throw error;
      }

      return data || [];
    } catch (error) {
      this.logger.error(`Error fetching active assignments for rule ${ruleId}:`, error);
      throw error;
    }
  }

  /**
   * Count active assignments
   */
  async countActiveAssignments(): Promise<number> {
    try {
      const { count, error } = await this.supabase
        .from('verifier_user_roles')
        .select('*', { count: 'exact' })
        .eq('status', 'active');

      if (error) {
        this.logger.error('Error counting active assignments:', error);
        throw error;
      }

      return count || 0;
    } catch (error) {
      this.logger.error('Error counting active assignments:', error);
      throw error;
    }
  }

  /**
   * Count revoked assignments
   */
  async countRevokedAssignments(): Promise<number> {
    try {
      const { count, error } = await this.supabase
        .from('verifier_user_roles')
        .select('*', { count: 'exact' })
        .eq('status', 'revoked');

      if (error) {
        this.logger.error('Error counting revoked assignments:', error);
        throw error;
      }

      return count || 0;
    } catch (error) {
      this.logger.error('Error counting revoked assignments:', error);
      throw error;
    }
  }

  /**
   * Count assignments expiring soon
   */
  async countExpiringSoonAssignments(): Promise<number> {
    try {
      const soonDate = new Date();
      soonDate.setHours(soonDate.getHours() + 24); // Next 24 hours

      const { count, error } = await this.supabase
        .from('verifier_user_roles')
        .select('*', { count: 'exact' })
        .eq('status', 'active')
        .lte('expires_at', soonDate.toISOString());

      if (error) {
        this.logger.error('Error counting expiring assignments:', error);
        throw error;
      }

      return count || 0;
    } catch (error) {
      this.logger.error('Error counting expiring assignments:', error);
      throw error;
    }
  }

  /**
   * Get last reverification time (placeholder - could be stored in a settings table)
   */
  async getLastReverificationTime(): Promise<string | null> {
    try {
      const { data, error } = await this.supabase
        .from('verifier_user_roles')
        .select('updated_at')
        .eq('status', 'active')
        .order('updated_at', { ascending: false })
        .limit(1);

      if (error) {
        this.logger.error('Error getting last reverification time:', error);
        throw error;
      }

      return data?.[0]?.updated_at || null;
    } catch (error) {
      this.logger.error('Error getting last reverification time:', error);
      throw error;
    }
  }

  /**
   * Track role assignment in the verifier_user_roles table
   */
  async trackRoleAssignment(assignment: {
    userId: string;
    serverId: string;
    roleId: string;
    ruleId?: string;
    userName?: string;
    serverName?: string;
    roleName?: string;
    verificationData?: any;
    expiresInHours?: number;
  }): Promise<any> {
    try {
      // Calculate expiration date if provided
      let expiresAt = null;
      if (assignment.expiresInHours && assignment.expiresInHours > 0) {
        const expiration = new Date();
        expiration.setHours(expiration.getHours() + assignment.expiresInHours);
        expiresAt = expiration.toISOString();
      }

      // First, check if there's an existing record for this user/server/role combination
      const { data: existingRecord, error: selectError } = await this.supabase
        .from('verifier_user_roles')
        .select('id, status, verification_data')
        .eq('user_id', assignment.userId)
        .eq('server_id', assignment.serverId)
        .eq('role_id', assignment.roleId)
        .maybeSingle(); // Use maybeSingle to avoid error if no record found

      if (selectError) {
        this.logger.error('Error checking existing role assignment:', selectError);
        throw selectError;
      }

      if (existingRecord) {
        // If record exists and is revoked/expired, reactivate it
        if (existingRecord.status === 'revoked' || existingRecord.status === 'expired') {
          const { data, error: updateError } = await this.supabase
            .from('verifier_user_roles')
            .update({
              status: 'active',
              verified_at: new Date().toISOString(),
              last_checked: new Date().toISOString(),
              expires_at: expiresAt,
              rule_id: assignment.ruleId,
              user_name: assignment.userName || '',
              server_name: assignment.serverName || '',
              role_name: assignment.roleName || '',
              verification_data: { ...(existingRecord.verification_data || {}), ...(assignment.verificationData || {}) },
              updated_at: new Date().toISOString()
            })
            .eq('id', existingRecord.id)
            .select()
            .single();

          if (updateError) {
            this.logger.error('Error reactivating role assignment:', updateError);
            throw updateError;
          }

          this.logger.debug(`Reactivated role assignment for user ${assignment.userId}, role ${assignment.roleId}`);
          return data;
        } else if (existingRecord.status === 'active') {
          // Record exists and is active - update the metadata but keep it active
          const { data, error: updateError } = await this.supabase
            .from('verifier_user_roles')
            .update({
              last_checked: new Date().toISOString(),
              expires_at: expiresAt,
              rule_id: assignment.ruleId,
              user_name: assignment.userName || '',
              server_name: assignment.serverName || '',
              role_name: assignment.roleName || '',
              verification_data: { ...(existingRecord.verification_data || {}), ...(assignment.verificationData || {}) },
              updated_at: new Date().toISOString()
            })
            .eq('id', existingRecord.id)
            .select()
            .single();

          if (updateError) {
            this.logger.error('Error updating existing active role assignment:', updateError);
            throw updateError;
          }

          this.logger.debug(`Updated existing active role assignment for user ${assignment.userId}, role ${assignment.roleId}`);
          return data;
        }
      }

      // No existing record, create new one
      const { data, error } = await this.supabase
        .from('verifier_user_roles')
        .insert({
          user_id: assignment.userId,
          server_id: assignment.serverId,
          role_id: assignment.roleId,
          rule_id: assignment.ruleId,
          user_name: assignment.userName || '',
          server_name: assignment.serverName || '',
          role_name: assignment.roleName || '',
          verification_data: assignment.verificationData || {},
          status: 'active',
          verified_at: new Date().toISOString(),
          last_checked: new Date().toISOString(),
          expires_at: expiresAt,
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) {
        this.logger.error('Error creating new role assignment:', error);
        throw error;
      }

      this.logger.debug(`Created new role assignment for user ${assignment.userId}, role ${assignment.roleId}`);
      return data;

    } catch (error) {
      this.logger.error('Error tracking role assignment:', error);
      throw error;
    }
  }

  /**
   * Get user role history for a specific server
   */
  async getUserRoleHistory(userId: string, serverId: string): Promise<any[]> {
    try {
      const { data, error } = await this.supabase
        .from('verifier_user_roles')
        .select('*')
        .eq('user_id', userId)
        .eq('server_id', serverId)
        .order('created_at', { ascending: false });

      if (error) {
        this.logger.error(`Error fetching user role history for ${userId} in server ${serverId}:`, error);
        throw error;
      }

      return data || [];
    } catch (error) {
      this.logger.error(`Error fetching user role history for ${userId} in server ${serverId}:`, error);
      throw error;
    }
  }

  /**
   * Update role verification status
   */
  async updateRoleVerification(assignmentId: string, isValid: boolean): Promise<any> {
    try {
      const { data, error } = await this.supabase
        .from('verifier_user_roles')
        .update({
          status: isValid ? 'active' : 'revoked',
          verified_at: new Date().toISOString(),
          last_checked: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', assignmentId)
        .select()
        .single();

      if (error) {
        this.logger.error(`Error updating role verification for assignment ${assignmentId}:`, error);
        throw error;
      }

      return data;
    } catch (error) {
      this.logger.error(`Error updating role verification for assignment ${assignmentId}:`, error);
      throw error;
    }
  }

  /**
   * Get unique users for a server
   */
  async getServerUniqueUsers(serverId: string): Promise<string[]> {
    try {
      const { data, error } = await this.supabase
        .from('verifier_user_roles')
        .select('user_id')
        .eq('server_id', serverId)
        .eq('status', 'active');

      if (error) {
        this.logger.error(`Error fetching unique users for server ${serverId}:`, error);
        throw error;
      }

      // Get unique user IDs
      const uniqueUsers = [...new Set(data?.map(row => row.user_id) || [])];
      return uniqueUsers;
    } catch (error) {
      this.logger.error(`Error fetching unique users for server ${serverId}:`, error);
      throw error;
    }
  }

  /**
   * Restore a rule with its original ID (for undo operations)
   */
  async restoreRuleWithOriginalId(removedRule: any): Promise<any> {
    try {
      const { data, error } = await this.supabase
        .from('verifier_rules')
        .insert({
          id: removedRule.id,
          server_id: removedRule.server_id,
          server_name: removedRule.server_name,
          channel_id: removedRule.channel_id,
          channel_name: removedRule.channel_name,
          role_id: removedRule.role_id,
          role_name: removedRule.role_name,
          slug: removedRule.slug,
          attribute_key: removedRule.attribute_key,
          attribute_value: removedRule.attribute_value,
          min_items: removedRule.min_items,
          created_at: removedRule.created_at,
          ...(removedRule.asset_type === 'nft' || removedRule.asset_type === 'ordinal' ? {
            asset_type: removedRule.asset_type, chain_id: removedRule.chain_id,
            contract_address: removedRule.contract_address, token_standard: removedRule.token_standard,
            token_ids: removedRule.token_ids, collection_name: removedRule.collection_name,
          } : {})
        })
        .select()
        .single();

      if (error) {
        this.logger.error('Error restoring rule with original ID:', error);
        throw error;
      }

      return data;
    } catch (error) {
      this.logger.error('Error restoring rule with original ID:', error);
      throw error;
    }
  }

  /**
   * Get audit log of all role changes for a server within a date range
   */
  async getServerAuditLog(serverId: string, daysBack: number = 1): Promise<any[]> {
    try {
      // Validate inputs
      if (!serverId) {
        throw new Error('Server ID is required');
      }
      
      if (daysBack < 1 || daysBack > 365) {
        throw new Error('Days back must be between 1 and 365');
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysBack);
      
      this.logger.debug(`Fetching audit log for server ${serverId}, looking back ${daysBack} days from ${cutoffDate.toISOString()}`);
      
      // Query role assignments within the specified time range
      // Use updated_at OR created_at to catch both new assignments and status changes
      const { data, error } = await this.supabase
        .from('verifier_user_roles')
        .select(`
          id,
          user_id,
          server_id,
          role_id,
          rule_id,
          user_name,
          server_name,
          role_name,
          status,
          verified_at,
          created_at,
          updated_at
        `)
        .eq('server_id', serverId)
        .or(`created_at.gte.${cutoffDate.toISOString()},updated_at.gte.${cutoffDate.toISOString()}`)
        .order('updated_at', { ascending: false });

      if (error) {
        this.logger.error(`Error fetching audit log for server ${serverId}:`, error);
        throw error;
      }

      this.logger.debug(`Found ${data?.length || 0} role assignments for server ${serverId} in the last ${daysBack} days`);

      // For each role assignment, get the user's wallet addresses
      const enrichedData = [];
      if (data && data.length > 0) {
        for (const roleEntry of data) {
          try {
            // Get user's wallet addresses
            const { data: wallets, error: walletError } = await this.supabase
              .from('user_wallets')
              .select('address, last_verified_at')
              .eq('user_id', roleEntry.user_id)
              .order('last_verified_at', { ascending: false });

            if (walletError) {
              this.logger.warn(`Error fetching wallets for user ${roleEntry.user_id}:`, walletError);
              // Continue with empty wallets array instead of failing completely
            }

            enrichedData.push({
              ...roleEntry,
              user_wallets: wallets || []
            });
          } catch (walletError) {
            this.logger.warn(`Error processing wallets for user ${roleEntry.user_id}:`, walletError);
            // Add entry without wallet data instead of failing
            enrichedData.push({
              ...roleEntry,
              user_wallets: []
            });
          }
        }
      }

      this.logger.debug(`Returning ${enrichedData.length} enriched audit entries`);
      return enrichedData;
    } catch (error) {
      this.logger.error(`Error fetching audit log for server ${serverId}:`, error);
      throw error;
    }
  }

}
