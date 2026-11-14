import { Injectable, Logger, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { CONSTANTS } from '@/constants';
import { NftRuleFields, VerifierRole } from '@/models/verifier-role.interface';
import { NftMetadataRow } from '@/utils/nft-trait.util';
import { OrdinalTraitSnapshot, OrdinalAttributeRow } from '@/models/ordinal-collection.interface';
import { RULE_EDIT_GUARD_FIELDS, RULE_EDIT_MUTABLE_FIELDS } from '@/utils/rule-edit.util';
import { ruleTraits, traitFilterKey } from '@/utils/trait-filter.util';
import { WalletVerificationActivity } from '@/models/wallet-activity.interface';

/**
 * Database Service
 * 
 * This service provides data access layer for the verification system using Supabase.
 * It handles:
 * - Verification rule CRUD operations
 * - Earned role assignments and their check history
 * - Wallet activity and metadata caches
 *
 * Main tables:
 * - verifier_rules: Verification rules configuration
 * - verifier_user_roles: Earned role assignments
 *
 * @example
 * ```typescript
 * const rules = await dbService.getRulesByChannel('123456789', 'channel123');
 * ```
 */
@Injectable()
export class DbService {
  private readonly logger = new Logger(DbService.name);

  constructor(
    @Inject('SUPABASE_CLIENT') private readonly supabase: SupabaseClient
  ) {}

  async recordWalletVerification(userId: string, address: string, activity: WalletVerificationActivity): Promise<void> {
    const { error } = await this.supabase.from('verifier_member_actions').upsert({
      id: activity.id,
      user_id: userId,
      kind: 'wallet_verify',
      address: address.toLowerCase(),
      wallet_type: activity.walletType,
      source: activity.source,
      server_id: activity.serverId,
      channel_id: activity.channelId || null,
      last_proven_at: activity.provenAt,
    }, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw new Error('Could not save wallet activity.');
  }

  async getOrdinalCollection(slug: string): Promise<unknown> {
    const { data, error } = await this.supabase.rpc('get_ordinal_collection', { p_slug: slug });
    if (error) throw new Error('Ordinals collection cache could not be read.');
    return data;
  }

  async getDisabledBackgroundServers(): Promise<Set<string>> {
    const { data, error } = await this.supabase.from('verifier_server_settings').select('server_id').eq('background_checks_enabled', false);
    if (error) throw new Error('Could not read background-check settings.');
    return new Set((data || []).map(row => row.server_id));
  }

  async replaceOrdinalCollection(slug: string, fetchedAt: string, items: OrdinalAttributeRow[]): Promise<boolean> {
    const { data, error } = await this.supabase.rpc('replace_ordinal_collection', {
      p_slug: slug, p_fetched_at: fetchedAt, p_items: items,
    });
    if (error || typeof data !== 'boolean') throw new Error('Ordinals collection cache could not be saved.');
    return data;
  }

  async reserveOrdinalProviderRequest(): Promise<boolean> {
    const { data, error } = await this.supabase.rpc('reserve_ordinal_provider_request');
    // Missing accounting must never let a restart silently reset the free allowance.
    if (error) throw new Error('Ordinals provider usage could not be reserved.');
    return data === true;
  }

  async getOrdinalCatalogRules(): Promise<Array<{ slug: string | null; inscription_criteria: unknown }>> {
    const rules: Array<{ slug: string | null; inscription_criteria: unknown }> = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await this.supabase.from('verifier_rules').select('slug,inscription_criteria')
        .eq('asset_type', 'ordinal').order('id').range(offset, offset + 999);
      if (error || !Array.isArray(data)) throw new Error('Ordinals collection rules could not be read.');
      rules.push(...data);
      if (data.length < 1000) return rules;
    }
  }

  /** Public collection slugs only: no member data or external Ordinals API calls. */
  async getKnownOrdinalCollectionSlugs(): Promise<string[]> {
    const catalogs = async (): Promise<Array<{ slug: string }>> => {
      const rows: Array<{ slug: string }> = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await this.supabase.from('ordinal_collections').select('slug')
          .order('slug').range(offset, offset + 999);
        if (error || !Array.isArray(data)) throw new Error('Ordinals collection suggestions could not be read.');
        rows.push(...data);
        if (data.length < 1000) return rows;
      }
    };
    const [rules, cached] = await Promise.all([this.getOrdinalCatalogRules(), catalogs()]);
    return [...new Set([
      ...rules.filter(rule => !rule.inscription_criteria).map(rule => rule.slug),
      ...cached.map(row => row.slug),
    ].filter((slug): slug is string => typeof slug === 'string' && slug !== 'all'
      && /^[a-z0-9][a-z0-9._-]{0,99}$/.test(slug)))].sort((a, b) => a.localeCompare(b));
  }

  async getCachedNftMetadata(chainId: number, contract: string, ids: string[], since: string): Promise<NftMetadataRow[]> {
    // The cache is optional; provider metadata can still be read if it is unavailable.
    try {
      const { data, error } = await this.supabase.from('nft_token_metadata')
        .select('chain_id,contract_address,token_id,attributes,fetched_at')
        .eq('chain_id', chainId).eq('contract_address', contract).in('token_id', ids).gte('fetched_at', since);
      return error ? [] : data || [];
    } catch { return []; }
  }

  async cacheNftMetadata(rows: NftMetadataRow[]): Promise<void> {
    try {
      const { error } = await this.supabase.from('nft_token_metadata')
        .upsert(rows, { onConflict: 'chain_id,contract_address,token_id' });
      if (error) this.logger.warn('NFT metadata cache could not be updated.');
    } catch { this.logger.warn('NFT metadata cache could not be updated.'); }
  }

  async cacheOrdinalTraitSnapshot(rule: VerifierRole, snapshot: OrdinalTraitSnapshot): Promise<void> {
    // Match the criteria as well as the ID: a scan started before a rule edit
    // must never attach its IDs to the edited rule or replace a newer scan.
    let query = this.supabase.from('verifier_rules')
      .update({ ordinal_trait_snapshot: snapshot })
      .eq('id', rule.id).eq('asset_type', 'ordinal').eq('slug', rule.slug);
    const traits = ruleTraits(rule);
    query = traits ? query.eq('trait_filter', JSON.stringify(traits)) : query.is('trait_filter', null);
    const { error } = await query.or(`ordinal_trait_snapshot.is.null,ordinal_trait_snapshot->>criteria_hash.neq.${snapshot.criteria_hash},ordinal_trait_snapshot->>fetched_at.lte.${snapshot.fetched_at}`);
    if (error) throw new Error('Ordinals trait snapshot could not be saved.');
  }

  private filterRuleAsset(query: any, slug: string, assetFields?: NftRuleFields): any {
    if (assetFields?.asset_type === 'stamp') return query.eq('asset_type','stamp').eq('stamp_criteria',JSON.stringify(assetFields.stamp_criteria));
    if (assetFields?.asset_type === 'solana_nft' || assetFields?.asset_type === 'solana_token') {
      query = query.eq('asset_type',assetFields.asset_type).eq('solana_criteria',JSON.stringify(assetFields.solana_criteria));
      return assetFields.asset_type === 'solana_token' ? query.eq('min_balance',assetFields.min_balance) : query;
    }
    if (['erc20','solana_token'].includes(assetFields?.asset_type)) return query.eq('asset_type', 'erc20')
      .eq('chain_id', assetFields.chain_id).eq('contract_address', assetFields.contract_address).eq('min_balance', assetFields.min_balance);
    if (assetFields?.inscription_criteria != null) return query.eq('asset_type', assetFields.asset_type)
      .is('slug', null).eq('inscription_criteria', JSON.stringify(assetFields.inscription_criteria));
    if (assetFields?.asset_type === 'ordinal') {
      return query.eq('asset_type', 'ordinal').eq('slug', slug).is('inscription_criteria', null);
    }
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
      .eq('channel_id', channelId);
    const traits = ruleTraits({ ...assetFields, attribute_key: finalAttrKey, attribute_value: finalAttrVal });
    query = traits ? query.eq('trait_key', traitFilterKey({ trait_filter: traits })) : query.is('trait_key', null);
    query = ['erc20','solana_token'].includes(assetFields?.asset_type) ? query.is('min_items', null) : query.eq('min_items', finalMinItems);

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

    const {attribute_key: _key, attribute_value: _value, ...storedAssetFields}=assetFields || {};
    const { data, error } = await this.supabase
      .from('verifier_rules')
      .insert({
        server_id: serverId,
        server_name: serverName,
        channel_id: channelId,
        channel_name: channelName,
        slug: ['nft', 'erc20', 'solana_nft', 'solana_token', 'stamp'].includes(assetFields?.asset_type) || assetFields?.inscription_criteria != null ? null : finalSlug,
        role_id: roleId,
        role_name: roleName,
        trait_filter: ruleTraits({...assetFields, attribute_key: finalAttrKey, attribute_value: finalAttrVal}),
        min_items: ['erc20','solana_token'].includes(assetFields?.asset_type) ? null : finalMinItems,
        ...storedAssetFields
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

  // Get all verification rules for a server (unified approach)
  async getAllRulesForServer(serverId: string): Promise<any[]> {
    const { data: rules, error } = await this.supabase
      .from('verifier_rules')
      .select('*')
      .eq('server_id', serverId);
    if (error) throw error;
    return rules || [];
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
      .eq('role_id', roleId);
    const traits = ruleTraits({ ...assetFields, attribute_key: finalAttrKey, attribute_value: finalAttrVal });
    query = traits ? query.eq('trait_key', traitFilterKey({ trait_filter: traits })) : query.is('trait_key', null);
    query = ['erc20','solana_token'].includes(assetFields?.asset_type) ? query.is('min_items', null) : query.eq('min_items', finalMinItems);

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

  /** Assignment history is the allowlist for automatic role restoration. */
  async getEarnedRoleAssignments(filters: { userId?: string; ruleId?: string; serverId?: string; roleId?: string } = {}): Promise<any[]> {
    const assignments: any[] = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      let query = this.supabase.from('verifier_user_roles').select('*')
        .in('status', ['active', 'revoked', 'expired']);
      if (filters.userId) query = query.eq('user_id', filters.userId);
      if (filters.serverId) query = query.eq('server_id', filters.serverId);
      if (filters.roleId) query = query.eq('role_id', filters.roleId);
      if (filters.ruleId) query = query.eq('rule_id', filters.ruleId);
      const { data, error } = await query.order('id').range(offset, offset + pageSize - 1);
      if (error) throw error;
      assignments.push(...(data || []));
      if (!data || data.length < pageSize) return assignments;
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

  async getRuleForServer(ruleId: string, serverId: string): Promise<VerifierRole | null> {
    const { data, error } = await this.supabase.from('verifier_rules').select('*')
      .eq('id', ruleId).eq('server_id', serverId).maybeSingle();
    if (error) throw new Error('Could not read this rule. Please try again.');
    return data;
  }

  /** Apply an edit atomically only if the definition still matches the opened form. */
  async editRule(before: VerifierRole, after: VerifierRole): Promise<VerifierRole> {
    const changes = Object.fromEntries(RULE_EDIT_MUTABLE_FIELDS.map(key => [key, key === 'trait_filter' ? ruleTraits(after) : after[key] ?? null]));
    let query = this.supabase.from('verifier_rules').update(changes).eq('id', before.id);
    for (const key of RULE_EDIT_GUARD_FIELDS) {
      const value = key === 'additional_roles' ? before.additional_roles || [] : key === 'trait_filter' ? ruleTraits(before) : before[key] ?? null;
      if (value === null) query = query.is(key, null);
      else {
        const serialized = ['trait_filter', 'inscription_criteria', 'additional_roles'].includes(key) ? JSON.stringify(value)
          : key === 'token_ids' ? `{${(value as string[]).join(',')}}` : value;
        query = query.eq(key, serialized);
      }
    }
    const { data, error } = await query.select().maybeSingle();
    if (error?.code === '23505') throw new Error('An identical rule already exists. The edit was not saved.');
    if (error) throw new Error('Could not save the rule edit. Please try again.');
    if (!data) throw new Error('This rule changed or was removed while the editor was open. Run /setup edit-rule again.');
    return data;
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
          trait_filter: ruleTraits(removedRule),
          min_items: removedRule.min_items,
          created_at: removedRule.created_at,
          ...(removedRule.inscription_criteria != null ? { inscription_criteria: removedRule.inscription_criteria, rule_label: removedRule.rule_label ?? null } : {}),
          ...(['nft', 'ordinal', 'erc20','solana_nft','solana_token','stamp'].includes(removedRule.asset_type) ? {
            asset_type: removedRule.asset_type, ...(removedRule.stamp_criteria ? {stamp_criteria:removedRule.stamp_criteria} : {}), ...(removedRule.solana_criteria ? {solana_criteria:removedRule.solana_criteria} : {}), chain_id: removedRule.chain_id,
            contract_address: removedRule.contract_address, token_standard: removedRule.token_standard,
            token_ids: removedRule.token_ids, collection_name: removedRule.collection_name,
            ...(['erc20','solana_token'].includes(removedRule.asset_type) ? { min_balance: removedRule.min_balance, token_decimals: removedRule.token_decimals, token_symbol: removedRule.token_symbol } : {}),
            ...(removedRule.asset_type === 'ordinal' ? {
              inscription_criteria: removedRule.inscription_criteria ?? null,
              ordinal_trait_snapshot: removedRule.ordinal_trait_snapshot ?? null,
            } : {}),
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
   * Get latest assignment activity for a server within a date range
   */
  async getServerAuditLog(serverId: string, daysBack: number = 1): Promise<any[]> {
    if (!serverId) throw new Error('Server ID is required');
    if (!Number.isInteger(daysBack) || daysBack < 1 || daysBack > 365) throw new Error('Days back must be between 1 and 365');
    const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
    const pageSize = 1000;
    const entries: any[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await this.supabase.from('verifier_user_roles')
        .select('id,user_id,server_id,role_id,rule_id,user_name,server_name,role_name,status,verified_at,created_at,updated_at')
        .eq('server_id', serverId).or(`created_at.gte.${cutoff},updated_at.gte.${cutoff}`)
        .order('updated_at', { ascending: false, nullsFirst: false }).order('id', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      entries.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    // Fetch wallets once per user batch, rather than once per role assignment.
    const walletsByUser = new Map<string, any[]>();
    const users = [...new Set(entries.map(entry => entry.user_id))];
    for (let start = 0; start < users.length; start += 100) {
      const batch = users.slice(start, start + 100);
      try {
        const wallets: any[] = [];
        for (let offset = 0; ; offset += pageSize) {
          const { data, error } = await this.supabase.from('user_wallets')
            .select('user_id,address,last_verified_at').in('user_id', batch)
            .order('last_verified_at', { ascending: false, nullsFirst: false }).order('id', { ascending: true })
            .range(offset, offset + pageSize - 1);
          if (error) throw error;
          wallets.push(...(data || []));
          if (!data || data.length < pageSize) break;
        }
        for (const wallet of wallets) {
          if (!walletsByUser.has(wallet.user_id)) walletsByUser.set(wallet.user_id, []);
          walletsByUser.get(wallet.user_id).push(wallet);
        }
      } catch (error) {
        this.logger.warn('Could not load audit wallet links:', error.message);
      }
    }
    return entries.map(entry => ({ ...entry, user_wallets: walletsByUser.get(entry.user_id) || [] }));
  }

}
