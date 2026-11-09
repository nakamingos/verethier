import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Min } from 'class-validator';
export class BulkRolePreviewDto {
  @IsIn(['verified','role']) audience: 'verified' | 'role';
  @IsOptional() @IsString() @Matches(/^\d{17,22}$/) source_role_id?: string;
  @IsOptional() @IsInt() @Min(1) rule_id?: number;
  @IsIn(['grant','reconcile']) mode: 'grant' | 'reconcile';
  @IsUUID() request_id: string;
}
export class BulkRoleActionDto {
  @IsIn(['start','resume','retry','cancel']) action: 'start' | 'resume' | 'retry' | 'cancel';
  @IsUUID() request_id: string;
}
