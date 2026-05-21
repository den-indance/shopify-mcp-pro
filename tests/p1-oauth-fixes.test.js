import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ShopifyClient } from '../build/shopify-client.js';

const TEST_CONFIG = {
  storeDomain: 'test-store.myshopify.com',
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
};

function clientWithToken() {
  const c = new ShopifyClient(TEST_CONFIG);
  c.session.accessToken = 'preset-token';
  c.tokenExpiry = Date.now() + 60 * 60 * 1000;
  return c;
}

describe('ensureFreshToken (OAuth client_credentials patch)', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('first call fetches, caches token and sets expiry', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'shpat_abc', expires_in: 7200, scope: 'read_products' }),
    });
    const c = new ShopifyClient(TEST_CONFIG);
    const before = Date.now();

    await c.ensureFreshToken();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://test-store.myshopify.com/admin/oauth/access_token');
    expect(opts.method).toBe('POST');
    expect(opts.body.toString()).toBe(
      'grant_type=client_credentials&client_id=test-client-id&client_secret=test-client-secret'
    );
    expect(c.session.accessToken).toBe('shpat_abc');
    expect(c.tokenExpiry).toBeGreaterThanOrEqual(before + 7200 * 1000);
  });

  it('second call within TTL (minus 5-min buffer) does NOT refetch', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 't1', expires_in: 7200 }),
    });
    const c = new ShopifyClient(TEST_CONFIG);

    await c.ensureFreshToken();
    await c.ensureFreshToken();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(c.session.accessToken).toBe('t1');
  });

  it('throws with status + body when OAuth endpoint returns 4xx', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":"invalid_client"}',
    });
    const c = new ShopifyClient(TEST_CONFIG);

    await expect(c.ensureFreshToken()).rejects.toThrow(
      /OAuth token request failed: 401.*invalid_client/
    );
    expect(c.session.accessToken).toBe('');
  });

  it('defaults to 86400s when expires_in is missing', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 't2' }),
    });
    const c = new ShopifyClient(TEST_CONFIG);
    const before = Date.now();

    await c.ensureFreshToken();

    const elapsedFromExpiry = c.tokenExpiry - before;
    expect(elapsedFromExpiry).toBeGreaterThanOrEqual(86400 * 1000);
    expect(elapsedFromExpiry).toBeLessThan(86400 * 1000 + 5000);
  });
});

describe('adjustInventory (April26 mutation patch)', () => {
  it('uses inventoryAdjustQuantities with correction/changes input', async () => {
    const c = clientWithToken();
    c.graphql = vi.fn().mockResolvedValue({ data: { inventoryAdjustQuantities: { userErrors: [] } } });

    await c.adjustInventory(
      'gid://shopify/InventoryItem/42',
      'gid://shopify/Location/7',
      5
    );

    expect(c.graphql).toHaveBeenCalledOnce();
    const [mutation, vars] = c.graphql.mock.calls[0];
    expect(mutation).toContain('inventoryAdjustQuantities');
    expect(mutation).toContain('InventoryAdjustQuantitiesInput');
    expect(mutation).not.toContain('inventoryAdjustQuantity(');
    expect(vars.input).toEqual({
      reason: 'correction',
      name: 'available',
      changes: [{ delta: 5, inventoryItemId: 'gid://shopify/InventoryItem/42', locationId: 'gid://shopify/Location/7' }],
    });
  });
});

describe('getAbandonmentReport (filter-string bug fix)', () => {
  it('builds a real filter string instead of passing literal $vars', async () => {
    const c = clientWithToken();
    c.graphql = vi.fn().mockResolvedValue({ data: { abandonedCheckouts: { edges: [] } } });

    await c.getAbandonmentReport({ startDate: '2026-04-01', endDate: '2026-04-30' });

    const [, vars] = c.graphql.mock.calls[0];
    expect(vars.filter).toBe('created_at:>=2026-04-01 AND created_at:<=2026-04-30');
    expect(vars.filter).not.toContain('$');
  });
});

describe('runShopifyQL passthrough (new analytics primitive)', () => {
  it('passes raw query as $q variable and uses shopifyqlQuery operation', async () => {
    const c = clientWithToken();
    c.graphql = vi.fn().mockResolvedValue({
      data: { shopifyqlQuery: { parseErrors: [], tableData: { columns: [], rows: [] } } },
    });

    const ql = 'FROM sales SHOW total_sales SINCE 2026-01-01 UNTIL today';
    await c.runShopifyQL(ql);

    const [query, vars] = c.graphql.mock.calls[0];
    expect(query).toContain('shopifyqlQuery(query: $q)');
    expect(query).toContain('parseErrors');
    expect(query).toContain('tableData');
    expect(vars).toEqual({ q: ql });
  });
});

describe('getCustomReport (explicit error when no query)', () => {
  it('throws a helpful error if params.query is missing', async () => {
    const c = clientWithToken();
    c.runShopifyQL = vi.fn();

    await expect(c.getCustomReport({})).rejects.toThrow(/requires a `query` parameter/);
    expect(c.runShopifyQL).not.toHaveBeenCalled();
  });

  it('forwards the query string to runShopifyQL when provided', async () => {
    const c = clientWithToken();
    c.runShopifyQL = vi.fn().mockResolvedValue({ data: {} });

    await c.getCustomReport({ query: 'FROM sales SHOW orders' });

    expect(c.runShopifyQL).toHaveBeenCalledWith('FROM sales SHOW orders');
  });
});