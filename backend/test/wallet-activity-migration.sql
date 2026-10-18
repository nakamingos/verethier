DO $$ DECLARE wallet_address text:='0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; link_id uuid:='bbbbbbbb-0000-4000-8000-000000000001';
 verify_id uuid:='bbbbbbbb-0000-4000-8000-000000000002'; remove_id uuid:='bbbbbbbb-0000-4000-8000-000000000003';
 flow_id uuid:='bbbbbbbb-0000-4000-8000-000000000004'; result jsonb; proven timestamptz;
BEGIN
 INSERT INTO public.user_wallets(user_id,address,last_verified_at) VALUES('activity-old',wallet_address,'2026-01-01T12:00:00Z');
 INSERT INTO public.verifier_user_roles(user_id,server_id,role_id,status) VALUES('activity-old','old-community','holder','active');
 result:=public.verifier_link_verified_wallet('activity-new',wallet_address,'evm','Collector',link_id,'discord','new-community','new-channel');
 IF result->>'success'<>'true' OR result->>'wasTransferred'<>'true' THEN RAISE EXCEPTION 'Discord transfer failed'; END IF;
 IF (SELECT count(*) FROM public.verifier_member_actions WHERE id=link_id AND source='discord' AND server_id='new-community' AND channel_id='new-channel')<>1 THEN RAISE EXCEPTION 'Missing Discord activity context'; END IF;
 IF (SELECT count(*) FROM public.verifier_member_actions WHERE user_id='activity-old' AND kind='wallet_transfer_out' AND last_proven_at='2026-01-01T12:00:00Z' AND server_id IS NULL)<>1 THEN RAISE EXCEPTION 'Previous owner history/proof/privacy failed'; END IF;
 IF (SELECT count(*) FROM public.verifier_reconciliation_jobs WHERE member_action_id=link_id AND user_id='activity-old')<>1 THEN RAISE EXCEPTION 'Transfer reconciliation missing'; END IF;
 PERFORM public.verifier_link_verified_wallet('activity-new',wallet_address,'evm','Collector',link_id,'discord','new-community','new-channel');
 PERFORM public.verifier_link_verified_wallet('activity-new',wallet_address,'evm','Collector',gen_random_uuid(),'portal','new-community','new-channel');
 IF (SELECT count(*) FROM public.verifier_member_actions WHERE user_id='activity-new' AND kind='wallet_link')<>1 THEN RAISE EXCEPTION 'Repeated verification duplicated wallet link'; END IF;
 INSERT INTO public.verifier_member_actions(id,user_id,kind,address,wallet_type,source,server_id,channel_id,last_proven_at)
 VALUES(verify_id,'activity-new','wallet_verify',wallet_address,'evm','discord','new-community','new-channel',now());
 INSERT INTO public.verifier_member_actions(id,user_id,kind,address,wallet_type,source)
 VALUES(verify_id,'activity-new','wallet_verify',wallet_address,'evm','discord') ON CONFLICT(id) DO NOTHING;
 IF (SELECT count(*) FROM public.verifier_member_actions WHERE id=verify_id)<>1 THEN RAISE EXCEPTION 'Duplicate success activity'; END IF;
 INSERT INTO public.verifier_wallet_blocks(server_id,address,wallet_type,blocked_by) VALUES('222222222222222222',wallet_address,'evm','111111111111111111');
 BEGIN
  PERFORM public.verifier_link_verified_wallet('blocked-user',wallet_address,'evm',NULL,gen_random_uuid(),'discord','222222222222222222','channel');
  RAISE EXCEPTION 'Blocked verification transferred wallet';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Blocked verification transferred wallet' THEN RAISE; END IF; END;
 IF (SELECT user_id FROM public.user_wallets WHERE address=wallet_address)<>'activity-new' THEN RAISE EXCEPTION 'Blocked mutation changed owner'; END IF;
 SELECT last_verified_at INTO proven FROM public.user_wallets WHERE address=wallet_address;
 PERFORM public.verifier_member_remove_wallet('activity-new',wallet_address,remove_id);
 IF (SELECT last_proven_at FROM public.verifier_member_actions WHERE id=remove_id) IS DISTINCT FROM proven THEN RAISE EXCEPTION 'Removal lost last proof'; END IF;
 IF (SELECT source FROM public.verifier_member_actions WHERE id=remove_id)<>'portal' THEN RAISE EXCEPTION 'Portal removal source'; END IF;
 -- The existing portal proof transaction also mirrors outgoing transfers.
 INSERT INTO public.user_wallets(user_id,address,last_verified_at) VALUES('portal-old',wallet_address,'2026-02-01T12:00:00Z');
 INSERT INTO public.verifier_member_flows(user_id,id,purpose,address,wallet_type,challenge,expires_at)
 VALUES('portal-new',flow_id,'wallet_link',wallet_address,'evm','{}',now()+interval '10 minutes');
 PERFORM public.verifier_member_link_wallet('portal-new',flow_id,true);
 IF (SELECT count(*) FROM public.verifier_member_actions WHERE user_id='portal-old' AND kind='wallet_transfer_out' AND source='portal' AND last_proven_at='2026-02-01T12:00:00Z')<>1 THEN RAISE EXCEPTION 'Portal outgoing transfer missing'; END IF;
 IF has_function_privilege('anon','public.verifier_link_verified_wallet(text,text,text,text,uuid,text,text,text)','EXECUTE')
 OR has_function_privilege('authenticated','public.verifier_preserve_wallet_proof()','EXECUTE') THEN RAISE EXCEPTION 'Activity mutation exposed'; END IF;
END $$;
