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
      {hashId: '1', attributes_new: {values: {EyeColor: 'Gold Crown'}}},
      {hashId: '2', attributes_new: {values: {EYECOLOR: 'GOLD CROWN'}}},
      {hashId: '3', attributes_new: {values: {eyecolor: 'Silver Crown'}}},
    ], error: null});
    expect(await service.checkAssetOwnershipWithCriteria('0x123', 'pizza-comrades', 'eyecolor', 'gold crown', 1)).toBe(2);
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
    expect(query.select).toContain('attributes_new!inner');
    expect(query.eq).toContainEqual(['slug', 'test-collection']);
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
    expect(query.select).toContain('attributes_new!inner');
    expect(query.eq).toContainEqual(['slug', 'test-collection']);
  });
});
