import { NftRuleFields } from './verifier-role.interface';

/**
 * VerificationRule interface
 * 
 * Represents a verification rule in the rule-based verification system.
 * Rules define criteria that users must meet to receive specific Discord roles.
 * 
 * Rules support flexible matching including:
 * - Collection-specific or all collections (slug)
 * - Channel-specific or server-wide application (channel_id)
 * - Attribute-based filtering (attribute_key/attribute_value)
 * - Minimum quantity requirements (min_items)
 * 
 * This is a flexible partial interface that supports both complete rule objects
 * from the database and temporary rule objects used during matching operations.
 */
export interface VerificationRule extends NftRuleFields {
  role_id: string;                        // Discord role ID to assign
  slug: string;                           // Collection slug ('ALL' for any collection)
  attribute_key: string;                  // Asset attribute key to match ('ALL' for any)
  attribute_value: string;                // Asset attribute value to match ('ALL' for any)
  min_items: number | null;               // Minimum number of matching assets required
  channel_id?: string | null;             // Discord channel ID (null for server-wide)
}

/**
 * Asset interface
 * 
 * Represents a user's asset with metadata attributes.
 * Used for matching against verification rule criteria.
 * 
 * Flexible structure allows for various asset formats and metadata schemas.
 */
export interface Asset {
  slug?: string;                          // Collection identifier
  attributes?: Record<string, any>;       // Key-value metadata attributes
  [key: string]: any;                     // Additional asset properties for extensibility
}
