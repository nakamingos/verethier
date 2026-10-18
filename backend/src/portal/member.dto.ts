import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class MemberLinkDto {
  @IsIn(['evm', 'bitcoin']) walletType: 'evm' | 'bitcoin';
  @IsString() @MaxLength(100) address: string;
}
export class MemberProofDto {
  @IsUUID() flow: string;
  @IsString() @MaxLength(1024) signature: string;
  @IsOptional() @IsBoolean() transfer?: boolean;
}
export class MemberRemoveDto {
  @IsString() @MaxLength(100) address: string;
  @IsUUID() requestId: string;
}
export class MemberVerifyDto {
  @Matches(/^\d{17,22}$/) server: string;
  @Matches(/^\d{17,22}$/) channel: string;
}
export class MemberResumeDto {
  @IsUUID() flow: string;
}
