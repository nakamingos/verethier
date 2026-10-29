import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  IsArray,
  ArrayMaxSize,
  Matches,
  IsISO8601,
} from "class-validator";
export class PrivacyChoiceDto {
  @IsUUID() epoch: string;
  @IsBoolean() share: boolean;
  @IsBoolean() exports: boolean;
  @IsIn(["2026-10-27"]) notice: string;
}
export class PrivacySettingsDto {
  @IsBoolean() sharing_enabled: boolean;
}
export class PrivacyDeletionDto {
  @IsUUID() request_id: string;
}
export class PrivacyReviewDto {
  @IsBoolean() approve: boolean;
  @IsString() @MaxLength(500) outcome: string;
}
export class WalletExportDto {
  @IsUUID() request_id: string;
  @IsOptional() @IsIn(["all", "evm", "bitcoin", "solana"]) family?: string;
  @IsOptional()
  @IsIn(["all", "ethereum", "base", "robinhood", "bitcoin", "solana"])
  network?: string;
  @IsOptional() @IsString() @Matches(/^\d{17,22}$/) channel?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(/^\d{17,22}$/, { each: true })
  roles?: string[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(/^\d{17,22}$/, { each: true })
  exclude_roles?: string[];
  @IsOptional() @IsIn(["any", "all"]) role_match?: string;
  @IsOptional() @IsString() @Matches(/^\d+$/) rule?: string;
  @IsOptional() @IsISO8601() verified_since?: string;
  @IsOptional() @IsISO8601() joined_before?: string;
  @IsOptional() @IsBoolean() exclude_blocked?: boolean;
  @IsOptional() @IsBoolean() identities?: boolean;
  @IsOptional() @IsBoolean() one_per_member?: boolean;
  @IsOptional() @IsBoolean() operator_override?: boolean;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}
