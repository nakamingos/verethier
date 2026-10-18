DO $$ DECLARE flow uuid:='aaaaaaaa-0000-4000-8000-000000000001'; req uuid:='aaaaaaaa-0000-4000-8000-000000000002';
 wallet_address text:='0x1111111111111111111111111111111111111111'; result jsonb;
BEGIN
 INSERT INTO public.user_wallets(user_id,address) VALUES('member-old',wallet_address),('member-new','0x2222222222222222222222222222222222222222');
 INSERT INTO public.verifier_user_roles(user_id,server_id,role_id,status) VALUES
 ('member-old','community-a','role-a','active'),('member-old','community-b','role-b','revoked'),
 ('member-new','community-a','role-a','active'),('member-new','community-a','role-c','active');
 INSERT INTO public.verifier_member_flows(user_id,id,purpose,address,wallet_type,challenge,expires_at)
 VALUES('member-new',flow,'wallet_link',wallet_address,'evm','{}',now()+interval '10 minutes');
 BEGIN
  PERFORM public.verifier_member_link_wallet('intruder',flow,true);
  RAISE EXCEPTION 'Cross-user proof accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Cross-user proof accepted' THEN RAISE; END IF; END;
 result:=public.verifier_member_link_wallet('member-new',flow,NULL);
 IF result->>'requiresTransfer'<>'true' OR (SELECT user_id FROM public.user_wallets WHERE user_wallets.address=wallet_address)<>'member-old'
 THEN RAISE EXCEPTION 'Transfer confirmation bypass'; END IF;
 IF EXISTS(SELECT 1 FROM public.verifier_member_actions WHERE id=flow) THEN RAISE EXCEPTION 'Unconfirmed transfer mutated account'; END IF;
 result:=public.verifier_member_link_wallet('member-new',flow,true);
 IF result->>'transferred'<>'true' OR (SELECT user_id FROM public.user_wallets WHERE user_wallets.address=wallet_address)<>'member-new'
 THEN RAISE EXCEPTION 'Transfer failed'; END IF;
 IF (SELECT count(*) FROM public.verifier_reconciliation_jobs WHERE member_action_id=flow AND user_id='member-old')<>2
 THEN RAISE EXCEPTION 'Missing prior-account checks'; END IF;
 BEGIN
  PERFORM public.verifier_member_link_wallet('member-new',flow,true);
  RAISE EXCEPTION 'Consumed proof replayed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Consumed proof replayed' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.verifier_member_remove_wallet('member-old',wallet_address,req);
  RAISE EXCEPTION 'Removed another account wallet';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Removed another account wallet' THEN RAISE; END IF; END;
 PERFORM public.verifier_member_remove_wallet('member-new',wallet_address,req);
 PERFORM public.verifier_member_remove_wallet('member-new',wallet_address,req);
 IF EXISTS(SELECT 1 FROM public.user_wallets WHERE user_wallets.address=wallet_address) THEN RAISE EXCEPTION 'Removal failed'; END IF;
 IF (SELECT count(*) FROM public.user_wallets WHERE user_id='member-new')<>1 THEN RAISE EXCEPTION 'Removed remaining wallet'; END IF;
 IF (SELECT count(*) FROM public.verifier_reconciliation_jobs WHERE member_action_id=req)<>1 THEN RAISE EXCEPTION 'Removal jobs missing/duplicated'; END IF;
 IF (SELECT count(*) FROM public.verifier_user_roles WHERE user_id='member-new')<>2 THEN RAISE EXCEPTION 'Unconditionally removed earned roles'; END IF;
 UPDATE public.verifier_member_flows SET completed_at=NULL,expires_at=now()-interval '1 second' WHERE id=flow;
 BEGIN
  PERFORM public.verifier_member_link_wallet('member-new',flow,true);
  RAISE EXCEPTION 'Expired proof accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Expired proof accepted' THEN RAISE; END IF; END;
 IF has_table_privilege('anon','public.verifier_member_flows','SELECT') OR has_table_privilege('authenticated','public.verifier_member_actions','SELECT')
 OR has_function_privilege('anon','public.verifier_member_link_wallet(text,uuid,boolean)','EXECUTE')
 OR has_function_privilege('authenticated','public.verifier_member_remove_wallet(text,text,uuid)','EXECUTE') THEN RAISE EXCEPTION 'Member data exposed'; END IF;
END $$;
