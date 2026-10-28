DO $$
DECLARE addr text:='0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'; w public.user_wallets; flow uuid:=gen_random_uuid(); result jsonb;
BEGIN
 -- First contract proof is scoped; repeat proofs merge only for the same member.
 PERFORM public.verifier_link_verified_wallet('smart-test-one',addr,'evm',NULL,gen_random_uuid(),'discord','smart-test-server',NULL,8453);
 SELECT * INTO w FROM public.user_wallets WHERE address=addr;
 IF w.evm_chain_ids IS DISTINCT FROM ARRAY[8453] THEN RAISE EXCEPTION 'First proof unscoped'; END IF;
 PERFORM public.verifier_link_verified_wallet('smart-test-one',addr,'evm',NULL,gen_random_uuid(),'discord','smart-test-server',NULL,1);
 PERFORM public.verifier_link_verified_wallet('smart-test-one',addr,'evm',NULL,gen_random_uuid(),'discord','smart-test-server',NULL,1);
 SELECT * INTO w FROM public.user_wallets WHERE address=addr;
 IF w.evm_chain_ids IS DISTINCT FROM ARRAY[1,8453] THEN RAISE EXCEPTION 'Scope merge lost'; END IF;
 -- A transfer cannot inherit the previous member's other-chain authorization.
 PERFORM public.verifier_link_verified_wallet('smart-test-two',addr,'evm',NULL,gen_random_uuid(),'discord','smart-test-server',NULL,4663);
 SELECT * INTO w FROM public.user_wallets WHERE address=addr;
 IF w.evm_chain_ids IS DISTINCT FROM ARRAY[4663] OR w.user_id<>'smart-test-two' THEN RAISE EXCEPTION 'Transfer inherited scope'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.verifier_member_actions WHERE user_id='smart-test-one' AND address=addr AND kind='wallet_transfer_out') THEN RAISE EXCEPTION 'Transfer history missing'; END IF;
 -- Existing key-based callers still work; proven private-key control is global.
 PERFORM public.verifier_link_verified_wallet('smart-test-two',addr,'evm',NULL,gen_random_uuid(),'discord','smart-test-server',NULL);
 SELECT * INTO w FROM public.user_wallets WHERE address=addr;
 IF w.evm_chain_ids IS NOT NULL THEN RAISE EXCEPTION 'EOA scope restricted'; END IF;
 -- Portal proof, transfer confirmation and scope are committed atomically.
 INSERT INTO public.verifier_member_flows(user_id,id,purpose,address,wallet_type,challenge,expires_at)
 VALUES('smart-test-three',flow,'wallet_link',addr,'evm','{"domain":{"chainId":8453}}',now()+interval '5 minutes');
 result:=public.verifier_member_link_wallet('smart-test-three',flow,false,8453);
 IF result->>'requiresTransfer'<>'true' THEN RAISE EXCEPTION 'Transfer confirmation skipped'; END IF;
 BEGIN
  PERFORM public.verifier_member_link_wallet('smart-test-three',flow,true,1);
  RAISE EXCEPTION 'Mismatched portal chain accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Mismatched portal chain accepted' THEN RAISE; END IF; END;
 result:=public.verifier_member_link_wallet('smart-test-three',flow,true,8453);
 SELECT * INTO w FROM public.user_wallets WHERE address=addr;
 IF w.user_id<>'smart-test-three' OR w.evm_chain_ids IS DISTINCT FROM ARRAY[8453] THEN RAISE EXCEPTION 'Portal transfer scope lost'; END IF;
 BEGIN
  PERFORM public.verifier_member_link_wallet('smart-test-three',flow,true,8453);
  RAISE EXCEPTION 'Portal replay accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Portal replay accepted' THEN RAISE; END IF; END;
 BEGIN
  UPDATE public.user_wallets SET evm_chain_ids=ARRAY[137] WHERE address=addr;
  RAISE EXCEPTION 'Unsupported network accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  UPDATE public.user_wallets SET evm_chain_ids=ARRAY[]::integer[] WHERE address=addr;
  RAISE EXCEPTION 'Empty contract scope accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 IF has_function_privilege('anon','public.verifier_member_link_wallet(text,uuid,boolean,integer)','EXECUTE') OR
 has_function_privilege('authenticated','public.verifier_link_verified_wallet(text,text,text,text,uuid,text,text,text,integer)','EXECUTE')
 THEN RAISE EXCEPTION 'Proof RPC privileges leaked'; END IF;
END $$;
