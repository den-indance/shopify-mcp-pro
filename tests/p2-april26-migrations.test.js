import { describe, it, expect, vi } from 'vitest';
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

function captureQuery(method, args = []) {
  const c = clientWithToken();
  c.graphql = vi.fn().mockResolvedValue({ data: {} });
  return method.apply(c, args).then(() => c.graphql.mock.calls[0][0]);
}

describe('April-26 schema migrations (our patches over @ajackus/shopify-mcp-server@1.1.0)', () => {
  it('getInventoryLevels uses quantities(names: [...]) instead of scalar `available`', async () => {
    const query = await captureQuery(
      ShopifyClient.prototype.getInventoryLevels,
      ['gid://shopify/InventoryItem/1']
    );
    expect(query).toMatch(/quantities\(names:\s*\[/);
    expect(query).toContain('name');
    expect(query).toContain('quantity');
    expect(query).not.toMatch(/^\s*available\s*$/m);
  });

  it('getDraftOrders uses MoneyV2 *Set { presentmentMoney } instead of scalar totalPrice/currencyCode', async () => {
    const query = await captureQuery(
      ShopifyClient.prototype.getDraftOrders,
      [{ limit: 10 }]
    );
    expect(query).toContain('totalPriceSet { presentmentMoney { amount currencyCode } }');
    expect(query).toContain('subtotalPriceSet { presentmentMoney');
    expect(query).toContain('originalUnitPriceSet { presentmentMoney');
    expect(query).toContain('discountedTotalSet { presentmentMoney');
    expect(query).not.toMatch(/^\s*totalPrice\s*$/m);
    expect(query).not.toMatch(/^\s*currencyCode\s*$/m);
  });

  it('getProduct asks variant.inventoryItem.measurement.weight (renamed from scalar weight/weightUnit)', async () => {
    const query = await captureQuery(
      ShopifyClient.prototype.getProduct,
      ['gid://shopify/Product/1']
    );
    expect(query).toContain('measurement {');
    expect(query).toMatch(/weight\s*\{\s*value\s+unit\s*\}/);
    expect(query).toContain('inventoryItem {');
    expect(query).not.toMatch(/^\s*weightUnit\s*$/m);
  });

  it('getPriceRules issues a discountNodes query with all 6 discount-type fragments', async () => {
    const query = await captureQuery(
      ShopifyClient.prototype.getPriceRules,
      [{ limit: 10 }]
    );
    expect(query).toContain('discountNodes(first:');
    expect(query).not.toContain('priceRules(first:');
    for (const fragment of [
      'DiscountCodeBasic',
      'DiscountAutomaticBasic',
      'DiscountCodeBxgy',
      'DiscountAutomaticBxgy',
      'DiscountCodeFreeShipping',
      'DiscountAutomaticApp',
    ]) {
      expect(query).toContain(`... on ${fragment}`);
    }
  });

  it('getCollections selects productsCount as object {count}, not as a scalar', async () => {
    const query = await captureQuery(
      ShopifyClient.prototype.getCollections,
      [{ limit: 10 }]
    );
    expect(query).toContain('productsCount { count }');
    expect(query).not.toMatch(/productsCount\s*\n/);
  });
});