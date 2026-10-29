import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  IsArray,
  ArrayNotEmpty,
  ArrayMaxSize,
  IsISO8601,
} from 'class-validator';

export class PortalRuleDto {
  @IsOptional() @IsObject() solana_criteria?: import('@/utils/solana-rule.util').SolanaCriteria;
  @IsOptional() @IsObject() trait_filter?: import('@/utils/trait-filter.util').TraitFilter | null;
  @IsIn(['ethscription', 'ordinal', 'nft', 'erc20', 'solana_nft', 'solana_token']) asset_type: string;
  @IsString() @Matches(/^\d{17,22}$/) channel_id: string;
  @IsOptional() @IsString() @Matches(/^\d{17,22}$/) role_id?: string;
  @IsOptional() @IsString() @MaxLength(100) role_name?: string;
  @IsOptional() @IsString() @MaxLength(100) slug?: string;
  @IsOptional() @IsString() @MaxLength(100) attribute_key?: string;
  @IsOptional() @IsString() @MaxLength(100) attribute_value?: string;
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  min_items?: number;
  @IsOptional() @IsString() @MaxLength(360) min_balance?: string;
  @IsOptional() @IsString() @MaxLength(42) contract_address?: string;
  @IsOptional() @IsIn(['ethereum', 'base', 'robinhood']) network?: string;
  @IsOptional() @IsString() @MaxLength(6000) token_ids?: string;
  @IsOptional() @IsIn(['erc721', 'erc1155']) expected_token_standard?: 'erc721' | 'erc1155';
  @IsOptional() @IsString() @MaxLength(100) collection_name?: string;
  @IsOptional() @IsString() @MaxLength(6000) inscription_ids?: string;
  @IsOptional() @IsString() @MaxLength(6000) inscription_numbers?: string;
  @IsOptional() @IsString() @MaxLength(100) label?: string;
  @IsUUID() request_id: string;
}

export class PortalEditDto {
  @IsOptional() @IsString() @Matches(/^\d{17,22}$/) role_id?: string;
  @IsOptional() @IsString() @MaxLength(100) role_name?: string;
  @IsString() @MaxLength(64000) version: string;
  @IsObject() inputs: Record<string, string>;
  @IsUUID() request_id: string;
}

export class PortalDeleteDto {
  @IsString() @MaxLength(64000) version: string;
  @IsUUID() request_id: string;
}

export class PortalActionDto {
  @IsUUID() request_id: string;
}
export class PortalWalletBlockDto {
  @IsString() @MaxLength(100) address: string;
  @IsBoolean() blocked: boolean;
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
  @IsUUID() request_id: string;
}
export class PortalRoleActionDto {
  @IsString() @Matches(/^\d{17,22}$/) trigger_role_id: string;
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  @Matches(/^\d{17,22}$/, { each: true })
  remove_role_ids?: string[] | null;
  @IsOptional() @IsISO8601() version?: string | null;
  @IsUUID() request_id: string;
}
export class PortalWalletAuditDto {
  @IsOptional() @IsString() @Matches(/^\d{17,22}$/) member_id?: string;
  @IsOptional() @IsString() @MaxLength(100) after?: string;
  @IsOptional() @IsString() @MaxLength(100) address?: string;
  @IsOptional() @IsString() @Matches(/^\d{17,22}$/) account_after?: string;
}

export class PortalSettingsDto {
  @IsBoolean() background_checks_enabled: boolean;
  // Older clients echo the settings read model. Changes to this field still
  // require reviewed channel setup, so saveSettings deliberately ignores it.
  @IsOptional() @IsString() @Matches(/^\d{17,22}$/) admin_channel_id?: string | null;
  @IsOptional() @IsString() @Matches(/^\d{17,22}$/) verification_channel_id?:
    | string
    | null;
}

export class PortalMessageDto {
  @IsString() @Matches(/^\d{17,22}$/) channel_id: string;
  @IsIn(['refresh', 'new', 'recover']) action: string;
}

export class PortalSetupChannelsDto {
  @IsOptional() @IsString() @Matches(/^\d{17,22}$/) admin_channel_id?: string | null;
  @IsOptional() @IsString() @Matches(/^\d{17,22}$/) verification_channel_id?: string | null;
  @IsOptional() @IsString() @Matches(/^[a-z0-9][a-z0-9_-]{0,99}$/) admin_channel_name?: string;
  @IsOptional() @IsString() @Matches(/^[a-z0-9][a-z0-9_-]{0,99}$/) verification_channel_name?: string;
  @IsUUID() request_id: string;
}
export class PortalSetupRecoveryDto {
  @IsString() @Matches(/^\d{17,22}$/) channel_id: string;
  @IsUUID() request_id: string;
}
