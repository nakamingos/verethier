import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { DbService } from './db.service';
import type { NftCheckContext } from './nft-ownership.service';
import { VerifierRole } from '@/models/verifier-role.interface';
import { ruleEditVersion } from '@/utils/rule-edit.util';
import { walletCheckNetwork, walletMatchesRule, WALLET_NETWORK_LABELS } from '@/utils/wallet-check.util';
import { AsyncSemaphore } from '@/utils/async-semaphore.util';

type Proof = {
  address: string;
  user_id: string;
  wallet_type: string;
  last_verified_at: string | null;
  evm_chain_ids: number[] | null;
};
type Candidate = {
  server: string;
  network: string;
  proof: Proof;
  positive: boolean;
  observed: Map<number, { rule: VerifierRole; count: bigint; checkedAt: number }>;
};
export interface WalletCheckRun {
  states: Map<string, Promise<Set<string>>>;
  proofs: Map<string, Promise<Proof[]>>;
  candidates: Map<string, Candidate>;
  finalized: Set<string>;
  rules: Map<string, Promise<VerifierRole[]>>;
  count?: (rule: VerifierRole, address: string) => Promise<bigint>;
}

@Injectable()
export class WalletCheckService {
  private readonly audits = new AsyncSemaphore(3);
  constructor(
    @Inject('SUPABASE_CLIENT') private readonly db: SupabaseClient,
    private readonly mappings: DbService,
  ) {}

  private run(context: NftCheckContext): WalletCheckRun {
    return context.walletCheck ||= {
      states: new Map(), proofs: new Map(), candidates: new Map(),
      finalized: new Set(), rules: new Map(),
    };
  }

  private checked<T = any>(result: any): T {
    if (result.error) throw new Error('Wallet checking state unavailable');
    return result.data;
  }

  async allowed(rule: VerifierRole, addresses: string[], context: NftCheckContext): Promise<string[]> {
    const applicable = addresses.filter(address => walletMatchesRule(rule, address));
    if (!applicable.length || context.freshExport) return applicable;
    const run = this.run(context);
    const network = walletCheckNetwork(rule);
    const key = JSON.stringify([rule.server_id, network, [...applicable].sort()]);
    if (!run.states.has(key)) {
      run.states.set(key, (async () => {
        const rows = this.checked<any[]>(await this.db.from('verifier_wallet_dormancy')
          .select('address').eq('server_id', rule.server_id).eq('network', network).in('address', applicable));
        return new Set(rows.map(row => row.address));
      })());
    }
    const dormant = await run.states.get(key);
    const active = applicable.filter(address => !dormant.has(address));
    // Capture proof before reading holdings. A signature during the read must
    // invalidate the result rather than supplying its replacement timestamp.
    const proofKey = JSON.stringify([...active].sort());
    if (active.length && !run.proofs.has(proofKey)) {
      run.proofs.set(proofKey, (async () => this.checked<Proof[]>(await this.db.from('user_wallets')
        .select('address,user_id,wallet_type,last_verified_at,evm_chain_ids').in('address', active)))());
    }
    if (active.length) {
      try { await run.proofs.get(proofKey); }
      catch { /* Proof metadata failure prevents dormancy, not ownership checks. */ }
    }
    return active;
  }

  async observe(
    rule: VerifierRole, addresses: string[], count: bigint, context: NftCheckContext,
    counter: (rule: VerifierRole, address: string) => Promise<bigint>,
  ): Promise<void> {
    if (context.freshExport || !addresses.length) return;
    const run = this.run(context);
    run.count = counter;
    const key = JSON.stringify([...addresses].sort());
    // Only an observation prepared before the ownership read is eligible.
    if (!run.proofs.has(key)) return;
    const proofs = await run.proofs.get(key);
    // An aggregate positive result does not identify which wallets contributed.
    // Only background work pays for any necessary per-wallet classification.
    if (count > 0n && addresses.length > 1 && context.ordinalMode !== 'scheduled') return;
    const observedAt = Date.now();
    const values = count === 0n ? addresses.map(() => Promise.resolve({ value: 0n, checkedAt: observedAt }))
      : addresses.length === 1 ? [Promise.resolve({ value: count, checkedAt: observedAt })]
      : addresses.map(async address => {
        const value = await counter(rule, address).catch(() => null);
        return { value, checkedAt: Date.now() };
      });
    const counts = await Promise.all(values);
    counts.forEach(({ value, checkedAt }, index) => {
      if (value === null) return;
      const proof = proofs.find(proof => proof.address === addresses[index]);
      if (!proof?.last_verified_at) return;
      const network = walletCheckNetwork(rule);
      const scope = JSON.stringify([rule.server_id, proof.user_id, proof.address, network]);
      let candidate = run.candidates.get(scope);
      if (!candidate) {
        candidate = { server: rule.server_id, network, proof, positive: false, observed: new Map() };
        run.candidates.set(scope, candidate);
      }
      if (value > 0n) candidate.positive = true;
      candidate.observed.set(Number(rule.id), { rule: { ...rule }, count: value, checkedAt });
    });
  }

  async finish(context: NftCheckContext): Promise<void> {
    if (context.freshExport || !context.walletCheck) return;
    const run = context.walletCheck;
    await Promise.all([...run.candidates].map(async ([key, candidate]) => {
      if (candidate.positive || run.finalized.has(key)) return;
      const fresh = () => [...candidate.observed.values()].every(observation => Date.now() - observation.checkedAt < 60_000);
      if (!fresh()) return;
      run.finalized.add(key);
      const audit = async () => {
        try {
          if (!run.rules.has(candidate.server)) {
            run.rules.set(candidate.server, this.mappings.getRoleMappings(candidate.server));
          }
          const rules = (await run.rules.get(candidate.server)).filter(rule =>
            walletCheckNetwork(rule) === candidate.network && walletMatchesRule(rule, candidate.proof.address));
          if (!rules.length) return;
          for (const rule of rules) {
            const observed = candidate.observed.get(Number(rule.id));
            const reusable = observed && ruleEditVersion(observed.rule) === ruleEditVersion(rule);
            // Interactive verification never starts additional ownership scans
            // to classify emptiness. Scheduled checks can complete coverage.
            if (!reusable && context.ordinalMode !== 'scheduled') return;
            const count = reusable ? observed.count : await run.count(rule, candidate.proof.address);
            if (count > 0n) return; // One relevant asset keeps checking active.
          }
          if (!fresh()) return; // Slow unrelated work cannot make old zeros dormant.
          const definitions = rules.map(({ ordinal_trait_snapshot, ...rule }) => rule);
          this.checked(await this.db.rpc('verifier_mark_wallet_dormant', {
            p_user: candidate.proof.user_id, p_server: candidate.server,
            p_address: candidate.proof.address, p_network: candidate.network,
            p_proven_at: candidate.proof.last_verified_at, p_rules: definitions,
            p_job: context.dormancyJobId || null, p_worker: context.dormancyWorker || null,
          }));
        } catch {
          Logger.warn('Wallet dormancy audit could not establish complete empty holdings; wallet state retained.');
        }
      };
      // Interactive signatures must not wait for background audits whose HTTP
      // requests are paused by the interactive provider priority mechanism.
      if (context.ordinalMode === 'scheduled') await this.audits.run(audit);
      else await audit();
    }));
  }

  async statuses(user: string, server?: string, visibleAddresses?: string[]): Promise<any[]> {
    let query = this.db.from('verifier_wallet_dormancy')
      .select('address,server_id,network,empty_checked_at').eq('user_id', user);
    if (server) query = query.eq('server_id', server);
    const visible = visibleAddresses && new Set(visibleAddresses);
    const rows = this.checked<any[]>(await query).filter(row => !visible || visible.has(row.address));
    if (!rows.length) return [];
    return rows.map(row => ({ ...row, status: 'dormant', network_name: WALLET_NETWORK_LABELS[row.network] }));
  }
}
