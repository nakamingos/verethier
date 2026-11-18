import { IsNotEmpty, IsOptional, IsString, MaxLength, IsObject } from 'class-validator';

export class VerificationContextDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(32)
  userId?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(32)
  discordId?: string;
  @IsString() @IsNotEmpty() @MaxLength(128)
  nonce: string;
}

export class WalletContextDto {
  @IsString() @IsNotEmpty() @MaxLength(32)
  userId: string;
  @IsString() @IsNotEmpty() @MaxLength(32)
  discordId: string;
  @IsString() @IsNotEmpty() @MaxLength(128)
  nonce: string;
}

export class BitcoinChallengeDto extends WalletContextDto {
  @IsOptional() @IsObject() privacy?: import('@/portal/privacy.service').PrivacyChoice;
  @IsString() @IsNotEmpty() @MaxLength(90)
  address: string;
}

export class BitcoinRelayDto {
  @IsString() @IsNotEmpty() @MaxLength(90)
  address: string;
  @IsString() @IsNotEmpty() @MaxLength(2000)
  message: string;
}

/** What Freewallet posts to a `counterparty:` sign callback. */
export class BitcoinRelayDeliveryDto {
  @IsOptional() @IsString() @MaxLength(90)
  address?: string;
  @IsOptional() @IsString() @MaxLength(2000)
  message?: string;
  @IsString() @IsNotEmpty() @MaxLength(300)
  signature: string;
}
