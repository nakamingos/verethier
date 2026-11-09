import { CHECK_PRIORITY } from '@/utils/check-priority.util';
import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Min } from 'class-validator';
export class BulkRolePreviewDto {
  @IsIn(['verified','role']) audience: 'verified' | 'role';
  @IsOptional() @IsString() @Matches(/^\d{17,22}$/) source_role_id?: string;
  @IsOptional() @IsInt() @Min(1) rule_id?: number;
  @IsIn(['grant','reconcile']) mode: 'grant' | 'reconcile';
  @IsOptional() @IsArray() @ArrayNotEmpty() @ArrayMaxSize(7) @ArrayUnique() @IsIn([...CHECK_PRIORITY], {each:true}) networks?: string[];
  @IsUUID() request_id: string;
}
export class BulkRoleActionDto {
  @IsIn(['start','resume','retry','cancel','delete']) action: 'start' | 'resume' | 'retry' | 'cancel' | 'delete';
  @IsUUID() request_id: string;
}
