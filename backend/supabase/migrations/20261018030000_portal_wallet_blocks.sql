BEGIN;
-- An explicit restriction, its audit receipt and affected-owner checks commit
-- together. The address lock is shared with wallet linking and removal.
CREATE FUNCTION public.verifier_portal_wallet_block(p_server text,p_actor text,p_address text,
 p_blocked boolean,p_reason text,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE prior public.verifier_wallet_blocks; replacement public.verifier_wallet_blocks;
 action public.verifier_portal_actions; total integer; action_kind text;
BEGIN
 IF p_blocked IS NULL THEN RAISE EXCEPTION 'Invalid restriction'; END IF;
 action_kind:=CASE WHEN p_blocked THEN 'wallet_block' ELSE 'wallet_unblock' END;
 p_reason:=nullif(btrim(p_reason),'');
 PERFORM pg_advisory_xact_lock(hashtextextended('member-wallet:'||p_address,0));
 SELECT * INTO action FROM public.verifier_portal_actions WHERE request_id=p_request;
 IF FOUND THEN
  IF action.server_id<>p_server OR action.actor_id<>p_actor OR action.kind<>action_kind
   OR coalesce(action.after_rule->>'address',action.before_rule->>'address') IS DISTINCT FROM p_address
   OR (p_blocked AND action.after_rule->>'reason' IS DISTINCT FROM p_reason)
  THEN RAISE EXCEPTION 'Request conflict'; END IF;
  SELECT count(*) INTO total FROM public.verifier_reconciliation_jobs WHERE action_id=action.id;
  RETURN jsonb_build_object('address',p_address,'blocked',p_blocked,'jobs',total,'action_id',action.id);
 END IF;
 SELECT * INTO prior FROM public.verifier_wallet_blocks WHERE server_id=p_server AND address=p_address FOR UPDATE;
 IF p_blocked THEN
  INSERT INTO public.verifier_wallet_blocks(server_id,address,wallet_type,reason,blocked_by)
  VALUES(p_server,p_address,CASE WHEN p_address LIKE '0x%' THEN 'evm' ELSE 'bitcoin' END,p_reason,p_actor)
  ON CONFLICT(server_id,address) DO UPDATE SET reason=excluded.reason,blocked_by=excluded.blocked_by,blocked_at=now()
  RETURNING * INTO replacement;
 ELSE
  DELETE FROM public.verifier_wallet_blocks WHERE server_id=p_server AND address=p_address;
 END IF;
 INSERT INTO public.verifier_portal_actions(server_id,actor_id,kind,before_rule,after_rule,request_id)
 VALUES(p_server,p_actor,action_kind,CASE WHEN prior.address IS NULL THEN jsonb_build_object('address',p_address) ELSE to_jsonb(prior) END,
  CASE WHEN p_blocked THEN to_jsonb(replacement) ELSE NULL END,p_request) RETURNING * INTO action;
 INSERT INTO public.verifier_reconciliation_jobs(action_id,server_id,user_id)
 SELECT action.id,p_server,user_id FROM public.user_wallets WHERE address=p_address;
 GET DIAGNOSTICS total=ROW_COUNT;
 RETURN jsonb_build_object('address',p_address,'blocked',p_blocked,'jobs',total,'action_id',action.id);
END $$;
REVOKE ALL ON FUNCTION public.verifier_portal_wallet_block(text,text,text,boolean,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.verifier_portal_wallet_block(text,text,text,boolean,text,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
