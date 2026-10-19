import { ruleTraits } from '@/utils/trait-filter.util';
import { Injectable } from '@nestjs/common';
import { EnvironmentConfig } from '@/config/environment.config';
import { VerifierRole } from '@/models/verifier-role.interface';
import { inscriptionCriteria } from '@/utils/inscription-rule.util';
import { nftNetworkLabel } from '@/utils/nft-network.util';
import { DataService } from './data.service';
import { NftOwnershipService } from './nft-ownership.service';
import { NftMetadataService } from './nft-metadata.service';
import { OrdinalsOwnershipService } from './ordinals-ownership.service';
import { EthscriptionsOwnershipService } from './ethscriptions-ownership.service';

export interface SetupProviderResult {
  id: string;
  label: string;
  status: 'healthy' | 'unavailable' | 'not_checked';
  detail: string;
  rule_ids: number[];
}

@Injectable()
export class SetupHealthService {
  constructor(
    private readonly data: DataService,
    private readonly nfts: NftOwnershipService,
    private readonly metadata: NftMetadataService,
    private readonly ordinals: OrdinalsOwnershipService,
    private readonly ethscriptions: EthscriptionsOwnershipService,
  ) {}

  async check(rules: VerifierRole[]): Promise<SetupProviderResult[]> {
    const probes = new Map<
      string,
      {
        label: string;
        rules: VerifierRole[];
        run?: () => Promise<void>;
        detail: string;
      }
    >();
    const add = (
      id: string,
      label: string,
      rule: VerifierRole,
      run: (() => Promise<void>) | undefined,
      detail: string,
    ) => {
      if (!probes.has(id)) probes.set(id, { label, rules: [], run, detail });
      probes.get(id).rules.push(rule);
    };
    for (const rule of rules) {
      const traits = !!ruleTraits(rule);
      if (rule.asset_type === 'nft' || rule.asset_type === 'erc20') {
        add(
          `rpc:${rule.chain_id}`,
          `${nftNetworkLabel(rule.chain_id)} RPC`,
          rule,
          () => this.nfts.checkSetupHealth(rule.chain_id),
          'Checks network identity and reads the latest block.',
        );
        if (traits)
          add(
            `metadata:${rule.chain_id}`,
            `${nftNetworkLabel(rule.chain_id)} NFT metadata`,
            rule,
            () => this.metadata.checkSetupHealth(rule),
            'Checks the metadata API with one collection sample; individual token traits are evaluated during verification.',
          );
      } else if (rule.asset_type === 'ethscription' || !rule.asset_type) {
        if (inscriptionCriteria(rule))
          add(
            'ethscriptions:api',
            'Ethscriptions protocol API',
            rule,
            () => this.ethscriptions.checkSetupHealth(),
            'Reads one protocol index entry.',
          );
        else
          add(
            `ethscriptions:data:${traits}`,
            traits ? 'Ethscriptions data and traits' : 'Ethscriptions data',
            rule,
            () => this.data.checkSetupHealth(traits),
            'Checks read access to the configured data tables.',
          );
      } else if (rule.asset_type === 'ordinal') {
        const criteria = inscriptionCriteria(rule);
        const provider = criteria
          ? 'xverse'
          : EnvironmentConfig.ORDINALS_PROVIDER;
        const numberOnly = criteria?.kind === 'numbers';
        add(
          `ordinals:${provider}:${numberOnly ? 'numbers' : traits ? 'traits' : 'collection'}`,
          `Ordinals ${provider}${traits ? ' and traits' : ''}`,
          rule,
          numberOnly ? undefined : () => this.ordinals.checkSetupHealth(rule),
          numberOnly
            ? 'Number-inventory access needs a member Check Roles; setup does not scan member wallets.'
            : 'Checks a fresh collection or selected-inscription lookup. Wallet inventories are checked separately by Check Roles.',
        );
      }
    }
    const results: SetupProviderResult[] = [];
    // Bound concurrency; setup probes must not flood verification providers.
    const queue = [...probes.entries()];
    await Promise.all(
      Array.from({ length: Math.min(3, queue.length) }, async () => {
        while (queue.length) {
          const [id, probe] = queue.shift();
          let status: SetupProviderResult['status'] = 'not_checked';
          let detail = probe.detail;
          if (probe.run) {
            let timer: ReturnType<typeof setTimeout>;
            try {
              await Promise.race([
                probe.run(),
                new Promise<never>((_, reject) => {
                  timer = setTimeout(() => reject(new Error('timeout')), 20000);
                }),
              ]);
              status = 'healthy';
            } catch {
              status = 'unavailable';
              detail =
                'Could not confirm availability. Check the configured provider credentials, network and service status, then retry. Earned roles are retained when eligibility is unavailable.';
            } finally {
              clearTimeout(timer);
            }
          }
          results.push({
            id,
            label: probe.label,
            status,
            detail,
            rule_ids: probe.rules.map((rule) => rule.id),
          });
        }
      }),
    );
    return results.sort((a, b) => a.id.localeCompare(b.id));
  }
}
