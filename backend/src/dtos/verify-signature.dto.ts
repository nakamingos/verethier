import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator';

/**
 * The verification payload the verify page submits. Every field is listed:
 * the global pipe rejects unknown properties. Identity and nonce fields are
 * checked against the server-held nonce later; validating their shape here
 * keeps malformed values out of logs and database filters.
 */
export class VerifySignatureDataDto {
  @Matches(/^\d{17,22}$/) userId: string;
  @Matches(/^\d{17,22}$/) discordId: string;
  @Matches(/^[a-f0-9]{64}$/) nonce: string;
  @IsInt() @Min(0) expiry: number;
  @IsString() @IsNotEmpty() @MaxLength(100) address: string;

  @IsOptional() @IsIn(['evm', 'bitcoin', 'solana']) walletType?: 'evm' | 'bitcoin' | 'solana';
  @IsOptional() @IsIn([2]) proofVersion?: 2;
  @IsOptional() @IsInt() @Min(1) chainId?: number;
  // Checked strictly by privacyChoice() and bound into the signed proof.
  @IsOptional() @IsObject() privacy?: import('@/portal/privacy.service').PrivacyChoice;

  // Display fields echoed from the server-held nonce context. Not trusted.
  @IsOptional() @IsString() @MaxLength(256) userTag?: string;
  @IsOptional() @IsString() @MaxLength(2048) avatar?: string;
  @IsOptional() @IsString() @MaxLength(256) discordName?: string;
  @IsOptional() @IsString() @MaxLength(2048) discordIcon?: string;
  @IsOptional() @IsString() @MaxLength(2048) discordIconURL?: string;
  @IsOptional() @IsString() @MaxLength(2048) signingOrigin?: string;
}

/**
 * VerifySignatureDto
 *
 * A wallet signature verification request: the verification payload and the
 * EIP-712, BIP-322/Bitcoin signed-message, or Solana signature over it.
 */
export class VerifySignatureDto {
  @IsObject()
  @ValidateNested()
  @Type(() => VerifySignatureDataDto)
  data: VerifySignatureDataDto;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32770)
  signature: string;
}
