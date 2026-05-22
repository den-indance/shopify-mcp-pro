# Shopify MCP Pro

[![npm](https://img.shields.io/npm/v/@den.dance/shopify-mcp-pro)](https://www.npmjs.com/package/@den.dance/shopify-mcp-pro)
[![smithery badge](https://smithery.ai/badge/den-indance/shopify-mcp-pro)](https://smithery.ai/servers/den-indance/shopify-mcp-pro)

The working Shopify MCP server. Connect Claude to your Shopify store — products, orders, customers, inventory, analytics and more.

Most Shopify MCP packages have broken analytics (stubs that return wrong data), use deprecated API fields that crash at runtime, and require a static token that expires silently. This one doesn't.

Built by [Denis Maleev](https://den.dance/).

---

## Why this one

| What's fixed | Detail |
|---|---|
| Analytics tools were stubs | `getSalesReport`, `getConversionReport`, `getTrafficReport` now powered by ShopifyQL — real data |
| Auth that actually works | Uses Client ID + Secret from Shopify Dev Dashboard, tokens refresh automatically — no silent expiry |
| Deprecated API fields | `getInventoryLevels`, `listAbandonedCheckouts` updated to Shopify 2026-04 field schema |
| Runtime crashes | `getShippingZones` no longer crashes on stores with no delivery profiles |
| New: `runShopifyQL` | Run any ShopifyQL query directly — same data as Admin → Analytics |
| Shopify Admin API | `2026-04` (current GA) + `@shopify/shopify-api` v13 |

---

## Quick Start

```bash
npx @den.dance/shopify-mcp-pro
```

---

## Setup

### 1. Create a Custom App in Shopify

1. Go to your Shopify Admin → **Settings → Apps and sales channels**
2. Click **Develop apps** (enable custom app development if prompted)
3. Click **Create an app**, give it a name (e.g. "Claude MCP")
4. Go to **Configure Admin API scopes** and select scopes you need (see list below)
5. Click **Install app**
6. Go to **API credentials** tab — you'll see **Client ID** and **Client secret**

> Note: Shopify no longer shows a static access token by default. This server uses OAuth with Client ID + Secret.

### 2. Configure Claude Desktop

Edit your Claude Desktop config file:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "shopify": {
      "command": "npx",
      "args": ["@den.dance/shopify-mcp-pro"],
      "env": {
        "SHOPIFY_STORE_DOMAIN": "your-store.myshopify.com",
        "SHOPIFY_CLIENT_ID": "your-client-id",
        "SHOPIFY_CLIENT_SECRET": "your-client-secret",
        "SHOPIFY_API_VERSION": "2026-04",
        "SHOPIFY_LOG_LEVEL": "WARNING"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

### Configure Claude Code

```bash
claude mcp add shopify -e SHOPIFY_STORE_DOMAIN=your-store.myshopify.com \
  -e SHOPIFY_CLIENT_ID=your-client-id \
  -e SHOPIFY_CLIENT_SECRET=your-client-secret \
  -- npx @den.dance/shopify-mcp-pro
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SHOPIFY_STORE_DOMAIN` | Yes | e.g. `my-store.myshopify.com` |
| `SHOPIFY_CLIENT_ID` | Yes | From Shopify Dev Dashboard |
| `SHOPIFY_CLIENT_SECRET` | Yes | From Shopify Dev Dashboard |
| `SHOPIFY_API_VERSION` | No | Defaults to `2026-04` |
| `SHOPIFY_LOG_LEVEL` | No | `error`, `warning`, `info`, `debug` (default: `warning`) |
| `TRANSPORT_MODE` | No | `stdio` (default) or `sse` |
| `PORT` | No | HTTP port for SSE mode (default: `3000`) |

---

## API Scopes

### Minimum recommended
- `read_products`, `write_products`
- `read_orders`
- `read_customers`
- `read_inventory`, `write_inventory`

### For analytics
- `read_analytics`
- `read_reports`

### Full feature set
- `read_draft_orders`, `write_draft_orders`
- `read_fulfillments`, `write_fulfillments`
- `read_shipping`
- `read_marketing_events`, `write_marketing_events`
- `read_discounts`, `write_discounts`
- `read_price_rules`, `write_price_rules`
- `read_themes`
- `read_content`, `write_content`
- `read_metaobjects`, `write_metaobjects`
- `read_gift_cards`, `write_gift_cards`

You don't need all scopes — the server works with whatever you grant. Tools requiring missing scopes return auth errors without affecting others.

---

## Tools

### Products & Inventory
- `listProducts` — list with filters, pagination, sort
- `getProduct` — get by ID (includes inventory item IDs)
- `createProduct`, `updateProduct`
- `getInventoryLevels` — current stock across locations
- `adjustInventory` — adjust quantities
- `listCollections`
- `setMetafield`
- `listMetaobjectDefinitions`, `createMetaobject`, `listMetaobjects`

### Orders & Fulfillment
- `listOrders`, `getOrder`
- `createDraftOrder`, `listDraftOrders`
- `createFulfillment`, `listFulfillmentOrders`
- `getShippingZones`
- `createRefund`
- `listTransactions`

### Customers & B2B
- `listCustomers`, `getCustomer`
- `getCustomerAnalytics`
- `createCompany`, `listCompanies`

### Financial
- `getFinancialSummary`
- `createGiftCard`, `listGiftCards`

### Marketing & Content
- `createDiscountCode`, `listDiscounts`
- `listPriceRules`
- `createPage`, `listPages`
- `createArticle`, `listBlogs`
- `createRedirect`
- `createWebhook`, `listWebhooks`

### Analytics & Reporting
- `getSalesReport` — revenue, orders, AOV (ShopifyQL)
- `getProductAnalytics` — top products by sales (ShopifyQL)
- `getConversionReport` — product conversion funnel (ShopifyQL)
- `getTrafficReport` — sales by referrer source (ShopifyQL)
- `getAbandonmentReport` — cart abandonment by date range
- `listAbandonedCheckouts`
- `getMarketingReport`
- `getCustomerAnalytics`
- `runShopifyQL` — run any ShopifyQL query directly

### Store Config
- `getShopInfo`
- `listThemes`
- `listLocations`
- `listMarkets`
- `getInventoryReport`
- `getCustomReport`

---

## ShopifyQL

`runShopifyQL` lets you run raw ShopifyQL queries — Shopify's native SQL-like analytics language:

```
FROM sales SHOW total_sales, gross_sales, total_orders SINCE '2026-01-01' UNTIL '2026-05-19'
FROM products SHOW total_sales BY product_title ORDER BY total_sales DESC LIMIT 10
FROM sessions SHOW sessions BY referrer_source
```

Requires `read_reports` scope + Level 2 customer data access in your Shopify app settings.

---

## Example prompts for Claude

- "Show sales for last month broken down by product"
- "Which products have less than 10 units in stock?"
- "Create a 20% discount code valid until end of month"
- "List abandoned checkouts from the past week"
- "Run a ShopifyQL query: FROM sales SHOW total_orders SINCE -30d"
- "Get customer lifetime value metrics"
- "Show top 10 products by revenue this year"

---

## SSE Mode

For HTTP-based access or cloud deployment:

```bash
TRANSPORT_MODE=sse \
SHOPIFY_STORE_DOMAIN=your-store.myshopify.com \
SHOPIFY_CLIENT_ID=your-client-id \
SHOPIFY_CLIENT_SECRET=your-client-secret \
PORT=3000 \
npx @den.dance/shopify-mcp-pro
```

Endpoints:
- `GET /sse` — SSE stream
- `POST /messages?sessionId={id}` — send messages
- `GET /health` — health check

Configure Claude Desktop for remote SSE:

```json
{
  "mcpServers": {
    "shopify-remote": {
      "transport": {
        "type": "sse",
        "url": "https://your-server.com/sse"
      }
    }
  }
}
```

---

## Security

- Never commit credentials to version control
- Use environment variables for all secrets
- Create separate apps with minimal scopes for different use cases
- Regularly rotate your Client Secret

---

## License

MIT