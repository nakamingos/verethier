import { Injectable, Logger } from '@nestjs/common';
import { OrdinalAttributeRow, OrdinalCollectionSnapshot } from '@/models/ordinal-collection.interface';
import { ORDINAL_INSCRIPTION_ID, ordinalCollectionId } from '@/utils/ordinal-rule.util';
import { DbService } from './db.service';
import { NftCheckContext } from './nft-ownership.service';
import { OrdnetOwnershipService } from './ordnet-ownership.service';
import { OrdinalRequestWork, OrdinalsRequestScheduler, ordinalRequestWork } from './ordinals-request-scheduler.service';

const REFRESH_MS = 6 * 60 * 60 * 1000;
const UNAVAILABLE = 'Ordinals collection metadata is temporarily unavailable. Please try again.';

@Injectable()
export class OrdinalCollectionCacheService {
  private readonly catalogs = new Map<string, OrdinalCollectionSnapshot>();
  private readonly loads = new Map<string, Promise<OrdinalCollectionSnapshot | null>>();
  private readonly refreshes = new Map<string, { work: OrdinalRequestWork; result: Promise<OrdinalCollectionSnapshot> }>();
  private readonly retryAt = new Map<string, number>();

  constructor(private readonly db: DbService, private readonly ordnet: OrdnetOwnershipService,
    private readonly requests: OrdinalsRequestScheduler) {}

  snapshot(slug: string, context: NftCheckContext): Promise<OrdinalCollectionSnapshot> {
    const id = ordinalCollectionId(slug);
    context.ordinalCatalogs ||= new Map();
    if (!context.ordinalCatalogs.has(id)) context.ordinalCatalogs.set(id, context.freshExport ? this.refresh(id, ordinalRequestWork(context)) : this.read(id, ordinalRequestWork(context)));
    return context.ordinalCatalogs.get(id);
  }

  private async read(id: string, work: OrdinalRequestWork): Promise<OrdinalCollectionSnapshot> {
    const saved = this.catalogs.get(id) || await this.load(id);
    if (!saved) return this.refresh(id, work);
    if (Date.now() - Date.parse(saved.fetched_at) >= REFRESH_MS && (this.retryAt.get(id) || 0) <= Date.now()) {
      void this.refresh(id, { priority: 'background' }).catch(() => undefined);
    }
    return saved;
  }

  private load(id: string): Promise<OrdinalCollectionSnapshot | null> {
    if (!this.loads.has(id)) {
      const promise = this.db.getOrdinalCollection(id).then(data => data == null ? null : this.decode(id, data))
        .then(data => { if (data) this.remember(data); return data; })
        .catch(() => null).finally(() => this.loads.delete(id));
      this.loads.set(id, promise);
    }
    return this.loads.get(id);
  }

  private remember(catalog: OrdinalCollectionSnapshot): void {
    if (this.catalogs.size >= 100 && !this.catalogs.has(catalog.slug)) this.catalogs.delete(this.catalogs.keys().next().value);
    this.catalogs.set(catalog.slug, catalog);
  }

  private decode(id: string, raw: any): OrdinalCollectionSnapshot {
    const fetched = Date.parse(raw?.fetched_at);
    if (raw?.slug !== id || !Number.isFinite(fetched) || fetched > Date.now() + 300000
      || !Number.isInteger(raw.item_count) || raw.item_count < 1 || raw.item_count > 20000
      || !Array.isArray(raw.items) || raw.items.length !== raw.item_count) throw new Error(UNAVAILABLE);
    const items: OrdinalCollectionSnapshot['items'] = new Map();
    for (const row of raw.items) {
      if (!row || typeof row.inscription_id !== 'string' || !ORDINAL_INSCRIPTION_ID.test(row.inscription_id)
        || items.has(row.inscription_id) || !row.values || typeof row.values !== 'object' || Array.isArray(row.values)
        || Object.keys(row.values).length > 100) throw new Error(UNAVAILABLE);
      const traits: Array<{ type: string; value: string }> = [];
      for (const [type, value] of Object.entries(row.values)) {
        const entries = Array.isArray(value) ? value : [value];
        if (!type.trim() || type.length > 100 || !entries.length || entries.length > 100) throw new Error(UNAVAILABLE);
        for (const entry of entries) {
          if (typeof entry !== 'string' || !entry.trim() || entry.length > 100) throw new Error(UNAVAILABLE);
          traits.push({ type, value: entry });
        }
      }
      // Catalog data must never be mistaken for cached ownership.
      items.set(row.inscription_id, { owner: null, traits });
    }
    return { slug: id, fetched_at: new Date(fetched).toISOString(), items };
  }

  async refresh(slug: string, work: OrdinalRequestWork = { priority: 'background' }): Promise<OrdinalCollectionSnapshot> {
    const id = ordinalCollectionId(slug);
    const pending = this.refreshes.get(id);
    if (pending) {
      if (work.priority === 'interactive') {
        this.requests.promote(pending.work);
        this.ordnet.promoteScan(id);
      }
      return pending.result;
    }
    const refreshWork = { priority: work.priority };
    const result = this.fetchAndSave(id, refreshWork).then(catalog => {
      this.retryAt.delete(id);
      this.remember(catalog);
      return catalog;
    }).catch(() => {
      this.retryAt.set(id, Date.now() + 60000);
      Logger.warn(`Ordinals metadata refresh failed for ${id}; keeping the last complete catalog.`);
      throw new Error(UNAVAILABLE);
    }).finally(() => this.refreshes.delete(id));
    this.refreshes.set(id, { work: refreshWork, result });
    return result;
  }

  private async fetchAndSave(id: string, work: OrdinalRequestWork): Promise<OrdinalCollectionSnapshot> {
    const collection = await this.ordnet.snapshot(id, { checks: new Map(), ordinalWork: work });
    const rows: OrdinalAttributeRow[] = [];
    for (const [inscriptionId, item] of collection.items) {
      if (item.traits === null) throw new Error(UNAVAILABLE);
      const values: Record<string, string | string[]> = Object.create(null);
      for (const trait of item.traits) {
        const previous = values[trait.type];
        values[trait.type] = previous === undefined ? trait.value : [...new Set([...(Array.isArray(previous) ? previous : [previous]), trait.value])];
      }
      rows.push({ inscription_id: inscriptionId, values });
    }
    const catalog = this.decode(id, { slug: id, fetched_at: collection.fetched_at, item_count: rows.length, items: rows });
    try {
      const replaced = await this.db.replaceOrdinalCollection(id, catalog.fetched_at, rows);
      if (!replaced) {
        const latest = await this.db.getOrdinalCollection(id);
        if (latest) return this.decode(id, latest);
      }
    } catch {
      // A validated live catalog is usable in memory even if persistence needs a retry.
      Logger.warn(`Ordinals metadata for ${id} is available in memory but could not be persisted.`);
    }
    return catalog;
  }

  async refreshScheduled(context: NftCheckContext): Promise<void> {
    const rules = await this.db.getOrdinalCatalogRules();
    const slugs = [...new Set(rules.map(rule => rule.slug).filter(Boolean))];
    context.ordinalCatalogs ||= new Map();
    for (const slug of slugs) {
      try {
        const catalog = await this.refresh(slug, ordinalRequestWork(context));
        context.ordinalCatalogs.set(slug, Promise.resolve(catalog));
      } catch { /* Each check may still use its last complete stored catalog. */ }
    }
  }

  async suggestions(slug: string, key?: string): Promise<string[]> {
    const collection = await this.snapshot(slug, { checks: new Map(), ordinalMode: 'scheduled' });
    const entries = new Set<string>();
    for (const item of collection.items.values()) for (const trait of item.traits || []) {
      if (!key) entries.add(trait.type);
      else if (trait.type.trim().toLowerCase() === key.trim().toLowerCase()) entries.add(trait.value);
    }
    return [...entries].sort((a, b) => a.localeCompare(b));
  }
}
