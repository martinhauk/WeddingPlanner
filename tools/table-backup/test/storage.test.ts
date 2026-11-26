import { describe, expect, it } from 'vitest';
import { redact } from '../src/cli.ts';
import { annotateDoubles, stateOfPages } from '../src/storage.ts';

describe('annotateDoubles', () => {
  const body =
    '{"odata.metadata":"x","value":[{"odata.etag":"e","PartitionKey":"p","RowKey":"r",' +
    '"Whole":5.0,"Count":5,"Exp":1e+21,"Neg":-0.5,"Nan@odata.type":"Edm.Double","Nan":"NaN",' +
    '"Big@odata.type":"Edm.Int64","Big":"12","Flag":true}]}';

  it('marks number literals with a decimal point or exponent as Edm.Double', () => {
    const [entity] = (JSON.parse(annotateDoubles(body)) as { value: Record<string, unknown>[] })
      .value;
    expect(entity).toMatchObject({
      'Whole@odata.type': 'Edm.Double',
      Whole: 5,
      'Exp@odata.type': 'Edm.Double',
      'Neg@odata.type': 'Edm.Double',
      Count: 5,
      'Nan@odata.type': 'Edm.Double',
      'Big@odata.type': 'Edm.Int64',
    });
    expect(entity).not.toHaveProperty('Count@odata.type');
    expect(entity).not.toHaveProperty('Flag@odata.type');
  });

  it('leaves bodies without doubles unchanged in meaning', () => {
    const plain = '{"value":[{"PartitionKey":"p","RowKey":"r","Count":7}]}';
    expect(JSON.parse(annotateDoubles(plain))).toEqual(JSON.parse(plain));
  });
});

describe('redact', () => {
  it('removes storage endpoints, account names and keys from messages', () => {
    const message =
      'getaddrinfo ENOTFOUND stwedabc123prodxyz.table.core.windows.net; ' +
      'AccountKey=abc/def==;AccountName=bkwedabc123prod at https://bkwedabc123prod.blob.core.windows.net/x';
    const text = redact(message, ['bkwedabc123prod']);
    expect(text).not.toContain('stwedabc123prodxyz');
    expect(text).not.toContain('bkwedabc123prod');
    expect(text).not.toContain('abc/def==');
    expect(text).toContain('<account>.table.<endpoint>');
  });
});

describe('stateOfPages', () => {
  async function* pages(...list: unknown[][]): AsyncIterable<unknown[]> {
    for (const page of list) yield page;
  }

  it('reads past an empty page that carries a continuation token', async () => {
    await expect(stateOfPages(pages([], [{ PartitionKey: 'p', RowKey: 'r' }]))).resolves.toBe(
      'non-empty',
    );
  });

  it('reports empty only when every page is empty', async () => {
    await expect(stateOfPages(pages([], []))).resolves.toBe('empty');
    await expect(stateOfPages(pages())).resolves.toBe('empty');
  });

  it('stops at the first page with a row', async () => {
    let read = 0;
    async function* counted(): AsyncIterable<unknown[]> {
      for (const page of [[{}], [{}]]) {
        read++;
        yield page;
      }
    }
    await expect(stateOfPages(counted())).resolves.toBe('non-empty');
    expect(read).toBe(1);
  });
});
