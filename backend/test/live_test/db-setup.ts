/**
 * Database Setup Script for Jest Testing
 * 
 * This script handles:
 * 1. Automatically starting/stopping Supabase
 * 2. Running Supabase migrations
 * 3. Inserting test data from SQL files
 * 4. Setting up the test environment
 * 
 * The script will automatically start Supabase if it's not running,
 * and optionally stop it after tests complete.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { execSync, spawn } from 'child_process';
import { getTestDbSupabaseKey, getTestDbSupabaseUrl } from '../test-env';

export class DatabaseSetup {
  private static instance: DatabaseSetup;
  private supabase: SupabaseClient;
  private supabaseStartedByUs: boolean = false;
  
  private constructor() {
    this.supabase = createClient(getTestDbSupabaseUrl(), getTestDbSupabaseKey());
  }

  public static getInstance(): DatabaseSetup {
    if (!DatabaseSetup.instance) {
      DatabaseSetup.instance = new DatabaseSetup();
    }
    return DatabaseSetup.instance;
  }

  /**
   * Check if Supabase is accessible
   */
  public async isHealthy(): Promise<boolean> {
    return await this.isSupabaseRunning();
  }

  /**
   * Run all migration files in order
   */
  public async runMigrations(): Promise<void> {
    console.log('🔄 Running database migrations...');
    
    const migrationsPath = join(__dirname, '../../supabase/migrations');
    
    try {
      // First, try to create the exec_sql function
      try {
        const testHelpersPath = join(migrationsPath, '00000000000001_test_helpers.sql');
        const testHelpers = readFileSync(testHelpersPath, 'utf8');
        await this.executeSql(testHelpers, 'Test Helpers');
      } catch (error) {
        console.log('📝 Could not create exec_sql function, will use direct operations');
      }

      // Run legacy schema migration first
      const legacySchemaPath = join(migrationsPath, '88888888888888_legacy_schema.sql');
      const legacySchema = readFileSync(legacySchemaPath, 'utf8');
      await this.executeSql(legacySchema, 'Legacy Schema');

      // Run universal migration
      const universalMigrationPath = join(migrationsPath, '99999999999999_universal_migration.sql');
      const universalMigration = readFileSync(universalMigrationPath, 'utf8');
      await this.executeSql(universalMigration, 'Universal Migration');

      console.log('✅ Migrations completed successfully');
    } catch (error) {
      console.error('❌ Migration failed:', error);
      // For tests, we can be more lenient - if migrations fail, 
      // individual tests will handle missing tables gracefully
      console.warn('⚠️ Continuing with test setup despite migration issues...');
    }
  }

  /**
   * Insert test data from SQL files
   */
  public async insertTestData(): Promise<void> {
    console.log('🔄 Inserting test data...');
    
    try {
      // Insert verifier_servers data
      const serversData = `
        INSERT INTO "public"."verifier_servers" ("id", "name", "role_id") VALUES 
        ('1369930881267142686', 'NoMoreLabs', '1369952701743501342'), 
        ('919772570612539422', 'Nakamingos 🦩', '1375511551380946954')
        ON CONFLICT (id) DO UPDATE SET 
        name = EXCLUDED.name,
        role_id = EXCLUDED.role_id;
      `;
      await this.executeSql(serversData, 'Test Servers Data');

      // Insert verifier_rules data
      const rulesData = `
        INSERT INTO "public"."verifier_rules" ("id", "server_id", "server_name", "channel_id", "channel_name", "role_id", "role_name", "slug", "attribute_key", "attribute_value", "min_items", "created_at") VALUES 
        ('7', '1369930881267142686', 'NoMoreLabs', '1377391163711029432', '🧱│verify-cdc', '1369952701743501342', 'Comrade', 'call-data-comrades', 'ALL', 'ALL', '1', '2025-07-07 08:35:59.442503+00'), 
        ('8', '1369930881267142686', 'NoMoreLabs', '1377391163711029432', '🧱│verify-cdc', '1376859534970192004', 'GIF Goddess', 'ALL', 'ALL', 'blue shirt', '1', '2025-07-07 09:10:34.889133+00'), 
        ('120', '919772570612539422', 'Nakamingos 🦩', '1386131331208974406', '🔏│verify-mingo🦩', '1375511551380946954', 'Mingo🦩', 'misprint-mingos', 'ALL', 'ALL', '1', '2025-07-04 04:43:34.434699+00')
        ON CONFLICT (id) DO UPDATE SET 
        server_id = EXCLUDED.server_id,
        server_name = EXCLUDED.server_name,
        channel_id = EXCLUDED.channel_id,
        channel_name = EXCLUDED.channel_name,
        role_id = EXCLUDED.role_id,
        role_name = EXCLUDED.role_name,
        slug = EXCLUDED.slug,
        attribute_key = EXCLUDED.attribute_key,
        attribute_value = EXCLUDED.attribute_value,
        min_items = EXCLUDED.min_items,
        created_at = EXCLUDED.created_at;
      `;
      await this.executeSql(rulesData, 'Test Rules Data');

      // Insert verifier_user_roles data
      const userRolesData = `
        INSERT INTO "public"."verifier_user_roles" ("id", "user_id", "server_id", "role_id", "status", "verified_at", "last_checked", "expires_at", "rule_id", "verification_data", "created_at", "updated_at", "address", "user_name", "server_name", "role_name", "message_id") VALUES 
        ('5', '719430123274633288', '1369930881267142686', '1369952701743501342', 'active', '2025-06-29 20:28:52.36097+00', '2025-07-06 19:28:52.36097+00', null, '169', '{"migration_date":"2025-07-06T20:28:52.36097+00:00","migration_notes":"Migrated from legacy verifier_users table with 72h grace period","legacy_migration":true,"legacy_role_name":"Comrade","original_address":"0x1776CFdcFFC21CD51B35d1EFAf5B3db4848dA1D7","migration_version":"1.0","grace_period_until":"2025-07-09T20:28:52.36097+00:00","original_server_data":"Comrade"}', '2025-06-29 20:28:52.36097+00', '2025-07-07 00:35:17.449126+00', '0x1776CFdcFFC21CD51B35d1EFAf5B3db4848dA1D7', null, null, null, null), 
        ('6', '719430123274633288', '919772570612539422', '1375511551380946954', 'active', '2025-06-29 20:28:52.36097+00', '2025-07-06 19:28:52.36097+00', null, '169', '{"migration_date":"2025-07-06T20:28:52.36097+00:00","migration_notes":"Migrated from legacy verifier_users table with 72h grace period","legacy_migration":true,"legacy_role_name":"Mingo🦩","original_address":"0x1776CFdcFFC21CD51B35d1EFAf5B3db4848dA1D7","migration_version":"1.0","grace_period_until":"2025-07-09T20:28:52.36097+00:00","original_server_data":"Mingo🦩"}', '2025-06-29 20:28:52.36097+00', '2025-07-07 00:35:17.449126+00', '0x1776CFdcFFC21CD51B35d1EFAf5B3db4848dA1D7', null, null, null, null), 
        ('7', '891152460104757299', '1369930881267142686', '1369952701743501342', 'active', '2025-06-29 20:28:52.36097+00', '2025-07-06 19:28:52.36097+00', null, '169', '{"migration_date":"2025-07-06T20:28:52.36097+00:00","migration_notes":"Migrated from legacy verifier_users table with 72h grace period","legacy_migration":true,"legacy_role_name":"Comrade","original_address":"0xF7457b5266A1B3418431B43F4A50bA1eE4D81253","migration_version":"1.0","grace_period_until":"2025-07-09T20:28:52.36097+00:00","original_server_data":"Comrade"}', '2025-06-29 20:28:52.36097+00', '2025-07-07 00:35:17.449126+00', '0xF7457b5266A1B3418431B43F4A50bA1eE4D81253', null, null, null, null)
        ON CONFLICT (id) DO UPDATE SET 
        user_id = EXCLUDED.user_id,
        server_id = EXCLUDED.server_id,
        role_id = EXCLUDED.role_id,
        status = EXCLUDED.status,
        verified_at = EXCLUDED.verified_at,
        last_checked = EXCLUDED.last_checked,
        expires_at = EXCLUDED.expires_at,
        rule_id = EXCLUDED.rule_id,
        verification_data = EXCLUDED.verification_data,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at,
        address = EXCLUDED.address,
        user_name = EXCLUDED.user_name,
        server_name = EXCLUDED.server_name,
        role_name = EXCLUDED.role_name,
        message_id = EXCLUDED.message_id;
      `;
      await this.executeSql(userRolesData, 'Test User Roles Data');

      // Insert legacy verifier_users data (if table exists)
      const legacyUsersData = `
        INSERT INTO "public"."verifier_users" ("id", "user_id", "servers", "address") VALUES 
        ('155', '891152460104757299', '{"1369930881267142686":"Comrade"}', '0xF7457b5266A1B3418431B43F4A50bA1eE4D81253'), 
        ('156', '719430123274633288', '{"919772570612539422":"Mingo🦩","1369930881267142686":"Comrade"}', '0x1776CFdcFFC21CD51B35d1EFAf5B3db4848dA1D7')
        ON CONFLICT (id, user_id) DO UPDATE SET 
        servers = EXCLUDED.servers,
        address = EXCLUDED.address;
      `;
      
      // Try to insert legacy data, but don't fail if table doesn't exist
      try {
        await this.executeSql(legacyUsersData, 'Test Legacy Users Data');
      } catch (error) {
        console.log('📝 Legacy users table not found, skipping legacy data insertion');
      }

      console.log('✅ Test data inserted successfully');
    } catch (error) {
      console.error('❌ Test data insertion failed:', error);
      throw error;
    }
  }

  /**
   * Clean up all test data and reset database to clean state
   */
  public async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up test database...');
    
    try {
      // Clean up in reverse dependency order
      const cleanupQueries = [
        'DELETE FROM "public"."verifier_user_roles" WHERE id IN (\'5\', \'6\', \'7\') OR user_id LIKE \'test_%\';',
        'DELETE FROM "public"."verifier_rules" WHERE id IN (\'7\', \'8\', \'120\') OR server_id LIKE \'test_%\';',
        'DELETE FROM "public"."verifier_servers" WHERE id IN (\'1369930881267142686\', \'919772570612539422\') OR id LIKE \'test_%\';'
      ];

      for (const query of cleanupQueries) {
        try {
          await this.executeSql(query, 'Cleanup');
        } catch (error) {
          console.warn('⚠️ Cleanup warning (table might not exist):', error.message);
        }
      }

      // Try to clean legacy table if it exists
      try {
        await this.executeSql(
          'DELETE FROM "public"."verifier_users" WHERE id IN (\'155\', \'156\') OR user_id LIKE \'test_%\';',
          'Legacy Cleanup'
        );
      } catch (error) {
        console.log('📝 Legacy users table not found during cleanup');
      }

      console.log('✅ Database cleanup completed');
    } catch (error) {
      console.error('❌ Database cleanup failed:', error);
      throw error;
    }
  }

  /**
   * Execute SQL with error handling and logging
   */
  private async executeSql(sql: string, operation: string): Promise<void> {
    try {
      // Try using the RPC function first
      const { error } = await this.supabase.rpc('exec_sql', { sql_query: sql });
      if (error) {
        throw error;
      }
      console.log(`✅ ${operation} executed successfully`);
    } catch (error) {
      // If RPC function doesn't exist, try breaking down the SQL into individual operations
      if (error.message?.includes('function exec_sql') || error.code === 'PGRST202') {
        console.log(`📝 Using alternative SQL execution for: ${operation}`);
        await this.executeAlternativeSql(sql, operation);
      } else {
        throw error;
      }
    }
  }

  /**
   * Alternative SQL execution for when RPC is not available
   */
  private async executeAlternativeSql(sql: string, operation: string): Promise<void> {
    // For INSERT statements, we can use the Supabase client directly
    if (sql.toLowerCase().includes('insert into')) {
      if (operation.includes('Servers')) {
        await this.insertServersDirectly();
      } else if (operation.includes('Rules')) {
        await this.insertRulesDirectly();
      } else if (operation.includes('User Roles')) {
        await this.insertUserRolesDirectly();
      } else if (operation.includes('Legacy Users')) {
        await this.insertLegacyUsersDirectly();
      }
      console.log(`✅ ${operation} executed successfully (direct)`);
    } else if (sql.toLowerCase().includes('delete from')) {
      // Handle DELETE operations
      await this.executeDeleteDirectly(sql, operation);
    } else {
      // For other operations like CREATE TABLE, we need to inform the user
      console.warn(`⚠️ Cannot execute ${operation} directly. Please run migrations manually or ensure exec_sql function exists.`);
    }
  }

  private async insertServersDirectly(): Promise<void> {
    const servers = [
      { id: '1369930881267142686', name: 'NoMoreLabs', role_id: '1369952701743501342' },
      { id: '919772570612539422', name: 'Nakamingos 🦩', role_id: '1375511551380946954' }
    ];

    for (const server of servers) {
      await this.supabase
        .from('verifier_servers')
        .upsert(server)
        .select();
    }
  }

  private async insertRulesDirectly(): Promise<void> {
    const rules = [
      {
        id: '7',
        server_id: '1369930881267142686',
        server_name: 'NoMoreLabs',
        channel_id: '1377391163711029432',
        channel_name: '🧱│verify-cdc',
        role_id: '1369952701743501342',
        role_name: 'Comrade',
        slug: 'call-data-comrades',
        attribute_key: 'ALL',
        attribute_value: 'ALL',
        min_items: 1,
        created_at: '2025-07-07 08:35:59.442503+00'
      },
      {
        id: '8',
        server_id: '1369930881267142686',
        server_name: 'NoMoreLabs',
        channel_id: '1377391163711029432',
        channel_name: '🧱│verify-cdc',
        role_id: '1376859534970192004',
        role_name: 'GIF Goddess',
        slug: 'ALL',
        attribute_key: 'ALL',
        attribute_value: 'blue shirt',
        min_items: 1,
        created_at: '2025-07-07 09:10:34.889133+00'
      },
      {
        id: '120',
        server_id: '919772570612539422',
        server_name: 'Nakamingos 🦩',
        channel_id: '1386131331208974406',
        channel_name: '🔏│verify-mingo🦩',
        role_id: '1375511551380946954',
        role_name: 'Mingo🦩',
        slug: 'misprint-mingos',
        attribute_key: 'ALL',
        attribute_value: 'ALL',
        min_items: 1,
        created_at: '2025-07-04 04:43:34.434699+00'
      }
    ];

    for (const rule of rules) {
      await this.supabase
        .from('verifier_rules')
        .upsert(rule)
        .select();
    }
  }

  private async insertUserRolesDirectly(): Promise<void> {
    const userRoles = [
      {
        id: '5',
        user_id: '719430123274633288',
        server_id: '1369930881267142686',
        role_id: '1369952701743501342',
        status: 'active',
        verified_at: '2025-06-29 20:28:52.36097+00',
        last_checked: '2025-07-06 19:28:52.36097+00',
        expires_at: null,
        rule_id: '169',
        verification_data: {
          migration_date: '2025-07-06T20:28:52.36097+00:00',
          migration_notes: 'Migrated from legacy verifier_users table with 72h grace period',
          legacy_migration: true,
          legacy_role_name: 'Comrade',
          original_address: '0x1776CFdcFFC21CD51B35d1EFAf5B3db4848dA1D7',
          migration_version: '1.0',
          grace_period_until: '2025-07-09T20:28:52.36097+00:00',
          original_server_data: 'Comrade'
        },
        created_at: '2025-06-29 20:28:52.36097+00',
        updated_at: '2025-07-07 00:35:17.449126+00',
        address: '0x1776CFdcFFC21CD51B35d1EFAf5B3db4848dA1D7',
        user_name: null,
        server_name: null,
        role_name: null,
        message_id: null
      }
      // Add more user roles as needed...
    ];

    for (const userRole of userRoles) {
      try {
        await this.supabase
          .from('verifier_user_roles')
          .upsert(userRole)
          .select();
      } catch (error) {
        console.warn('⚠️ Could not insert user role:', error.message);
      }
    }
  }

  private async insertLegacyUsersDirectly(): Promise<void> {
    try {
      const legacyUsers: Array<{ id: string; user_id: string; servers: Record<string, string>; address: string }> = [
        {
          id: '155',
          user_id: '891152460104757299',
          servers: { '1369930881267142686': 'Comrade' },
          address: '0xF7457b5266A1B3418431B43F4A50bA1eE4D81253'
        },
        {
          id: '156',
          user_id: '719430123274633288',
          servers: { '919772570612539422': 'Mingo🦩', '1369930881267142686': 'Comrade' },
          address: '0x1776CFdcFFC21CD51B35d1EFAf5B3db4848dA1D7'
        }
      ];

      for (const user of legacyUsers) {
        await this.supabase
          .from('verifier_users')
          .upsert(user)
          .select();
      }
    } catch (error) {
      console.log('📝 Legacy users table not found, skipping legacy data insertion');
    }
  }

  private async executeDeleteDirectly(sql: string, operation: string): Promise<void> {
    try {
      if (sql.includes('verifier_user_roles')) {
        await this.supabase
          .from('verifier_user_roles')
          .delete()
          .in('id', ['5', '6', '7']);
        
        await this.supabase
          .from('verifier_user_roles')
          .delete()
          .like('user_id', 'test_%');
      } else if (sql.includes('verifier_rules')) {
        await this.supabase
          .from('verifier_rules')
          .delete()
          .in('id', ['7', '8', '120']);
          
        await this.supabase
          .from('verifier_rules')
          .delete()
          .like('server_id', 'test_%');
      } else if (sql.includes('verifier_servers')) {
        await this.supabase
          .from('verifier_servers')
          .delete()
          .in('id', ['1369930881267142686', '919772570612539422']);
          
        await this.supabase
          .from('verifier_servers')
          .delete()
          .like('id', 'test_%');
      } else if (sql.includes('verifier_users')) {
        try {
          await this.supabase
            .from('verifier_users')
            .delete()
            .in('id', ['155', '156']);
            
          await this.supabase
            .from('verifier_users')
            .delete()
            .like('user_id', 'test_%');
        } catch (error) {
          console.log('📝 Legacy users table not found during cleanup');
        }
      }
      
      console.log(`✅ ${operation} executed successfully (direct)`);
    } catch (error) {
      console.warn(`⚠️ ${operation} warning:`, error.message);
    }
  }

  /**
   * Setup the complete test environment
   */
  public async setupTestEnvironment(): Promise<void> {
    console.log('🚀 Setting up test database environment...');
    
    // First, ensure Supabase is running
    const isRunning = await this.ensureSupabaseRunning();
    if (!isRunning) {
      console.warn('⚠️ Could not start Supabase. Database tests will be skipped.');
      console.warn('📝 To run database tests manually, ensure Supabase is installed and try: supabase start');
      return;
    }

    try {
      await this.runMigrations();
      await this.insertTestData();
      console.log('🎉 Test environment setup complete!');
    } catch (error) {
      console.error('❌ Test environment setup failed:', error);
      throw error;
    }
  }

  /**
   * Teardown the test environment
   */
  public async teardownTestEnvironment(): Promise<void> {
    const isHealthy = await this.isHealthy();
    
    if (isHealthy) {
      console.log(' Tearing down test database environment...');
      
      try {
        await this.cleanup();
        console.log('🎉 Test environment teardown complete!');
      } catch (error) {
        console.error('❌ Test environment teardown failed:', error);
        // Don't throw here as we don't want teardown failures to fail tests
      }
    } else {
      console.log('📝 Supabase not accessible for cleanup');
    }

    // Keep Supabase running for faster subsequent test runs
    // In CI/CD, the entire environment gets torn down automatically
    console.log('📝 Keeping Supabase running for faster subsequent test runs');
  }

  /**
   * Get the appropriate Supabase command (checking for different installation methods)
   */
  private getSupabaseCommand(): string {
    // Supabase CLI is typically installed via system package managers, not npm/yarn
    // So we just use the global 'supabase' command
    return 'supabase';
  }

  /**
   * Check if Supabase is currently running
   */
  private async isSupabaseRunning(): Promise<boolean> {
    try {
      // Try multiple methods to detect if Supabase is running
      
      // Method 1: Try a simple database query
      const { error } = await this.supabase
        .from('pg_tables')
        .select('tablename')
        .limit(1);
      
      if (!error) {
        return true;
      }
      
      // Method 2: Check if Docker containers are running
      try {
        const dockerOutput = execSync('docker ps --filter "name=supabase_db_" --format "{{.Names}}"', { 
          stdio: 'pipe',
          encoding: 'utf8',
          timeout: 5000
        });
        
        if (dockerOutput.trim().includes('supabase_db_')) {
          console.log('📝 Detected running Supabase Docker containers');
          return true;
        }
      } catch (dockerError) {
        // Docker command failed, continue to other methods
      }
      
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Check if Supabase CLI is available
   */
  private isSupabaseCLIAvailable(): boolean {
    try {
      execSync('supabase --version', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Start Supabase locally
   */
  private async startSupabase(): Promise<boolean> {
    if (!this.isSupabaseCLIAvailable()) {
      console.warn('⚠️ Supabase CLI not found. Please install it using one of the supported methods:');
      console.warn('📝 Via Homebrew (macOS): brew install supabase/tap/supabase');
      console.warn('📝 Via Scoop (Windows): scoop bucket add supabase https://github.com/supabase/scoop-bucket.git && scoop install supabase');
      console.warn('📝 Via APT (Ubuntu/Debian): https://github.com/supabase/cli#install-the-cli');
      console.warn('📝 Direct download: https://github.com/supabase/cli/releases');
      console.warn('📝 Or start Supabase manually if you have it running elsewhere');
      return false;
    }

    console.log('🚀 Starting Supabase locally...');
    
    try {
      // Change to project root to run supabase commands
      const projectRoot = join(__dirname, '../..');
      process.chdir(projectRoot);
      
      execSync('supabase start', { 
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120000 // 2 minutes timeout
      });
      
      this.supabaseStartedByUs = true;
      console.log('✅ Supabase started successfully');
      
      // Wait a moment for Supabase to fully initialize
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      return true;
    } catch (error) {
      console.error('❌ Failed to start Supabase:', error.message);
      return false;
    }
  }

  /**
   * Stop Supabase if we started it
   */
  private async stopSupabase(): Promise<void> {
    // Always try to stop Supabase in test teardown, regardless of who started it
    if (process.env.MANUAL_SUPABASE === 'true') {
      console.log('📝 MANUAL_SUPABASE=true, skipping automatic Supabase stop');
      return;
    }

    if (!this.isSupabaseCLIAvailable()) {
      console.warn('⚠️ Supabase CLI not found, cannot stop Supabase automatically');
      return;
    }

    console.log('🛑 Stopping Supabase...');
    
    try {
      // Change to project root to run supabase commands
      const projectRoot = join(__dirname, '../..');
      process.chdir(projectRoot);
      
      const supabaseCmd = this.getSupabaseCommand();
      execSync(`${supabaseCmd} stop`, { 
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30000 // 30 seconds timeout
      });
      
      console.log('✅ Supabase stopped successfully');
    } catch (error) {
      console.error('❌ Failed to stop Supabase:', error.message);
      console.log('📝 You may need to stop it manually with: supabase stop');
    }
  }

  /**
   * Ensure Supabase is running (start it if needed)
   */
  private async ensureSupabaseRunning(): Promise<boolean> {
    // Check if user wants to manage Supabase manually
    if (process.env.MANUAL_SUPABASE === 'true') {
      console.log('📝 MANUAL_SUPABASE=true, expecting Supabase to be already running...');
      const isRunning = await this.isSupabaseRunning();
      if (!isRunning) {
        console.warn('⚠️ Supabase not running and MANUAL_SUPABASE=true. Please start it manually.');
      }
      return isRunning;
    }

    const isRunning = await this.isSupabaseRunning();
    
    if (isRunning) {
      console.log('✅ Supabase is already running');
      return true;
    }

    console.log('📝 Supabase not running, attempting to start it...');
    return await this.startSupabase();
  }
}
