import { IncompleteEthscriptionTraitsError } from '../src/utils/ethscription-traits.util';
const mockSupabase = {
  from: jest.fn(),
};

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockSupabase),
}));

import { DataService } from '../src/services/data.service';

type QueryRecorder = {
  table?: string;
  select?: string;
  or?: string;
  eq?: Array<[string, unknown]>;
  in?: [string, unknown[]];
  range?: [number, number];
};

type QueuedQuery = {
  builder: any;
  recorder: QueryRecorder;
};

describe('DataService', () => {
  let service: DataService;
  let queuedQueries: QueuedQuery[];

  const queueQuery = (result: { data: any; error: any }): QueryRecorder => {
    const recorder: QueryRecorder = {};
    const builder: any = {
      select: jest.fn((value: string) => {
        recorder.select = value;
        return builder;
      }),
      or: jest.fn((value: string) => {
        recorder.or = value;
        return builder;
      }),
      eq: jest.fn((field: string, value: unknown) => {
        recorder.eq ||= [];
        recorder.eq.push([field, value]);
        return builder;
      }),
      in: jest.fn((field: string, value: unknown[]) => {
        recorder.in = [field, value];
        return builder;
      }),
      range: jest.fn((start: number, end: number) => {
        recorder.range = [start, end];
        return builder;
      }),
      order: jest.fn(() => builder),
      then: (onFulfilled: (value: { data: any; error: any }) => unknown, onRejected?: (reason: any) => unknown) =>
        Promise.resolve(result).then(onFulfilled, onRejected),
      catch: (onRejected: (reason: any) => unknown) =>
        Promise.resolve(result).catch(onRejected),
      finally: (onFinally: () => void) =>
        Promise.resolve(result).finally(onFinally),
    };

    queuedQueries.push({ builder, recorder });
    return recorder;
  };

  it('does not execute an ownership query for a multi-collection rule', async () => {
    await expect(service.matchingAssetIdsWithCriteria('0x123', 'one,two')).rejects.toThrow('one collection per rule');
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    queuedQueries = [];
    mockSupabase.from.mockImplementation((table: string) => {
      const next = queuedQueries.shift();
      if (!next) {
        throw new Error(`Unexpected query for table ${table}`);
      }

      next.recorder.table = table;
      return next.builder;
    });

    service = new DataService();
  });

  afterEach(() => {
    expect(queuedQueries).toHaveLength(0);
    jest.clearAllMocks();
  });

  it('counts all matching items even when their trait key capitalization differs', async () => {
    queueQuery({data: [
      {hashId: '1', slug: 'pizza-comrades', attributes_new: {values: {EyeColor: 'Gold Crown'}}},
      {hashId: '2', slug: 'pizza-comrades', attributes_new: {values: {EYECOLOR: 'GOLD CROWN'}}},
      {hashId: '3', slug: 'pizza-comrades', attributes_new: {values: {eyecolor: 'Silver Crown'}}},
    ], error: null});
    expect(await service.checkAssetOwnershipWithCriteria('0x123', 'pizza-comrades', 'eyecolor', 'gold crown', 1)).toBe(2);
  });
  it('evaluates AND/OR per asset, deduplicates OR and shares inventory across predicates', async () => {
    queueQuery({data:[
      {hashId:'A',slug:'comrades',attributes_new:{values:{Background:'Blue',Hat:'Crown'}}},
      {hashId:'B',slug:'comrades',attributes_new:{values:{Background:'Blue'}}},
      {hashId:'C',slug:'comrades',attributes_new:{values:{Hat:'Crown'}}},
    ],error:null});
    const context={checks:new Map()};
    const conditions=[{key:'Background',value:'Blue'},{key:'Hat',value:'Crown'}];
    expect(await service.matchingAssetIdsWithCriteria('wallet','comrades','ALL','ALL',1,context,{operator:'AND',conditions})).toEqual(['a']);
    expect(await service.matchingAssetIdsWithCriteria('wallet','comrades','ALL','ALL',1,context,{operator:'OR',conditions})).toEqual(['a','b','c']);
    expect(mockSupabase.from).toHaveBeenCalledTimes(1);
  });
  it('accepts real collection list shapes without aborting unrelated trait checks or double counting an OR match', async () => {
    queueQuery({data:[
      {hashId:'A',slug:'call-data-comrades',attributes_new:{values:{Type:'Purr People',Affiliation:['Gold Bearer','Pirate']}}},
      {hashId:'B',slug:'call-data-comrades',attributes_new:{values:{Type:'Pork People',Mouth:['Pipe','Smile']}}},
    ],error:null});
    const context={checks:new Map()};
    expect(await service.matchingAssetIdsWithCriteria('wallet','call-data-comrades','ALL','ALL',1,context,{operator:'OR',conditions:[{key:'Type',value:'Purr People'},{key:'Type',value:'Pork People'}]})).toEqual(['a','b']);
    expect(await service.matchingAssetIdsWithCriteria('wallet','call-data-comrades','ALL','ALL',1,context,{operator:'OR',conditions:[{key:'Affiliation',value:'Gold Bearer'},{key:'Affiliation',value:'Pirate'}]})).toEqual(['a']);
    expect(mockSupabase.from).toHaveBeenCalledTimes(1);
  });
  it('keeps distinct proven matches as a lower bound when other metadata is missing', async () => {
    queueQuery({data:[
      {hashId:'A',slug:'comrades',attributes_new:{values:{Type:'Purr People'}}},
      {hashId:'A',slug:'comrades',attributes_new:{values:{Type:'Purr People'}}},
      {hashId:'B',slug:'comrades',attributes_new:null},
    ],error:null});
    try {
      await service.matchingAssetIdsWithCriteria('wallet','comrades','ALL','ALL',1,undefined,{operator:'AND',conditions:[{key:'Type',value:'Purr People'}]});
      throw new Error('Expected incomplete evidence');
    } catch(error) {
      expect(error).toBeInstanceOf(IncompleteEthscriptionTraitsError);
      expect(error.matchingAssets).toEqual(new Map([['a',1n]]));expect(error.unknownItems).toBe(1);
    }
  });
  it('preserves uncertainty when multi-trait metadata is missing', async () => {
    queueQuery({data:[{hashId:'A',slug:'comrades',attributes_new:null}],error:null});
    await expect(service.matchingAssetIdsWithCriteria('wallet','comrades','ALL','ALL',1,undefined,{operator:'AND',conditions:[{key:'Hat',value:'Crown'},{key:'Background',value:'Blue'}]})).rejects.toThrow('unavailable');
  });
  it('offers values from arbitrary mixed-case keys without changing their spelling', async () => {
    queueQuery({data: [{values: {EyeColor: 'Gold Crown'}}, {values: {eYeCoLoR: 'Silver Crown'}}], error: null});
    expect(await service.getAllAttributeValues('eyecolor', 'pizza-comrades')).toEqual(['Gold Crown', 'Silver Crown']);
  });

  it('filters by attribute key when the rule is category-only', async () => {
    const query = queueQuery({
      data: [
        {
          hashId: '1',
          slug: 'test-collection',
          attributes_new: { values: { Head: 'Halo' } },
        },
        {
          hashId: '2',
          slug: 'test-collection',
          attributes_new: { values: { Type: 'Alien' } },
        },
      ],
      error: null,
    });

    const result = await service.checkAssetOwnershipWithCriteria(
      '0xabc123',
      'test-collection',
      'Head',
      'ALL',
      1
    );

    expect(result).toBe(1);
    expect(query.table).toBe('ethscriptions');
    expect(query.select).toContain('attributes_new(values)');
  });

  it('keeps category-only rules on the attribute-filtered path during batch checks', async () => {
    const query = queueQuery({
      data: [
        {
          hashId: '1',
          slug: 'test-collection',
          attributes_new: { values: { Background: 'Blue' } },
        },
        {
          hashId: '2',
          slug: 'test-collection',
          attributes_new: { values: { Eyes: 'Laser' } },
        },
      ],
      error: null,
    });

    const result = await service.batchCheckAssetOwnership('0xabc123', [
      {
        slug: 'test-collection',
        attributeKey: 'Background',
        attributeValue: 'ALL',
        minItems: 1,
      },
    ]);

    expect(result.get(0)).toBe(1);
    expect(query.select).toContain('attributes_new(values)');
  });

  it('shares one fresh inventory across parallel rules, stacked wallets, and later recommendations', async () => {
    const context = { checks: new Map() };
    const query = queueQuery({ data: [
      { hashId: '0xA', slug: 'one', attributes_new: { values: { Crown: 'Gold' } } },
      { hashId: '0xB', slug: 'one', attributes_new: null },
      { hashId: '0xC', slug: 'two', attributes_new: { values: { Crown: 'Silver' } } },
    ], error: null });
    expect(await Promise.all([
      service.checkAssetOwnershipWithCriteria(['0xABC', '0xDEF'], 'one', 'ALL', 'ALL', 1, context),
      service.checkAssetOwnershipWithCriteria(['0xdef', '0xabc', '0xABC'], 'one', 'crown', 'gold', 1, context),
      service.checkAssetOwnershipWithCriteria(['0xabc', '0xdef'], 'two', 'ALL', 'ALL', 2, context),
    ])).toEqual([2, 1, 0]);
    expect(await service.matchingAssetIdsWithCriteria(['0xdef', '0xabc'], 'ALL', 'ALL', 'ALL', 1, context))
      .toEqual(['0xa', '0xb', '0xc']);
    expect(mockSupabase.from).toHaveBeenCalledTimes(1);
    expect(query.or).toContain('owner.eq.0xabc');
    expect(query.or).toContain('owner.eq.0xdef');
    expect(query.or).toContain('and(owner.eq.0xd3418772623be1a3cc6b6d45cb46420cedd9154a,prevOwner.eq.0xabc)');

    queueQuery({ data: [], error: null });
    expect(await service.checkAssetOwnershipWithCriteria(['0xabc', '0xdef'], 'one', 'ALL', 'ALL', 1, { checks: new Map() })).toBe(0);
    expect(mockSupabase.from).toHaveBeenCalledTimes(2);
  });

  it('reads beyond the Supabase row limit before evaluating counts', async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => ({ hashId: String(index), slug: 'one', attributes_new: null }));
    const pages = [0, 500, 1000].map(offset => queueQuery({ data: rows.slice(offset, offset + 500), error: null }));
    expect(await service.checkAssetOwnershipWithCriteria('0xabc', 'one', 'ALL', 'ALL', 1001)).toBe(1001);
    expect(pages.map(page => page.range)).toEqual([[0, 499], [500, 999], [1000, 1499]]);
  });

  it('rejects a partial inventory for every rule when a later page fails', async () => {
    queueQuery({ data: Array.from({ length: 500 }, (_, index) => ({ hashId: String(index), slug: 'one', attributes_new: null })), error: null });
    queueQuery({ data: null, error: { message: 'unavailable' } });
    const context = { checks: new Map() };
    const results = await Promise.allSettled([
      service.checkAssetOwnershipWithCriteria('0xabc', 'one', 'ALL', 'ALL', 1, context),
      service.checkAssetOwnershipWithCriteria('0xabc', 'one', 'Crown', 'Gold', 1, context),
    ]);
    expect(results.every(result => result.status === 'rejected')).toBe(true);
    await expect(service.checkAssetOwnershipWithCriteria('0xabc', 'one', 'ALL', 'ALL', 1, context)).rejects.toThrow('unavailable');
    expect(mockSupabase.from).toHaveBeenCalledTimes(2);
  });

  it('keeps inventories separate when server wallet restrictions allow different wallets', async () => {
    queueQuery({ data: [{ hashId: 'a', slug: 'one', attributes_new: null }], error: null });
    queueQuery({ data: [], error: null });
    const context = { checks: new Map() };
    expect(await service.checkAssetOwnershipWithCriteria(['0xabc', '0xdef'], 'one', 'ALL', 'ALL', 1, context)).toBe(1);
    expect(await service.checkAssetOwnershipWithCriteria(['0xdef'], 'one', 'ALL', 'ALL', 1, context)).toBe(0);
    expect(mockSupabase.from).toHaveBeenCalledTimes(2);
  });
});
