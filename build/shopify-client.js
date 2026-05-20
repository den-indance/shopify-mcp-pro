import '@shopify/shopify-api/adapters/node';
import { shopifyApi, ApiVersion, Session, LogSeverity } from '@shopify/shopify-api';
export class ShopifyClient {
    client;
    session;
    config;
    tokenExpiry = 0;
    getLogLevel(envLevel) {
        switch (envLevel?.toUpperCase()) {
            case 'ERROR':
                return LogSeverity.Error;
            case 'WARNING':
            case 'WARN':
                return LogSeverity.Warning;
            case 'INFO':
                return LogSeverity.Info;
            case 'DEBUG':
                return LogSeverity.Debug;
            default:
                // Default to Warning for production safety
                return LogSeverity.Warning;
        }
    }
    constructor(config) {
        // Determine log level from environment or default to Warning for production
        const logLevel = this.getLogLevel(process.env.SHOPIFY_LOG_LEVEL);
        this.client = shopifyApi({
            apiKey: 'dummy-key', // Not needed for private apps
            apiSecretKey: 'dummy-secret', // Not needed for private apps
            scopes: [], // Not needed for private apps
            hostName: 'localhost', // Not needed for private apps
            isEmbeddedApp: false, // Required field
            apiVersion: config.apiVersion || ApiVersion.April26,
            logger: {
                level: logLevel,
                // Redirect all logs to stderr to avoid stdout pollution
                log: async (severity, message) => {
                    // Only log if the message severity meets our configured level
                    process.stderr.write(`[Shopify/${severity}] ${message}\n`);
                },
                // Enable HTTP request logging in development
                httpRequests: process.env.NODE_ENV === 'development',
            },
        });
        this.config = config;
        this.session = new Session({
            id: 'offline_' + config.storeDomain,
            shop: config.storeDomain,
            state: 'active',
            isOnline: false,
            accessToken: '',
        });
    }
    async ensureFreshToken() {
        const now = Date.now();
        const REFRESH_BUFFER_MS = 5 * 60 * 1000;
        if (this.session.accessToken && now < this.tokenExpiry - REFRESH_BUFFER_MS) {
            return;
        }
        const endpoint = `https://${this.config.storeDomain}/admin/oauth/access_token`;
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: this.config.clientId,
                client_secret: this.config.clientSecret,
            }),
        });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`OAuth token request failed: ${response.status} ${text}`);
        }
        const data = await response.json();
        this.session.accessToken = data.access_token;
        this.tokenExpiry = now + (data.expires_in || 86400) * 1000;
        const hours = ((data.expires_in || 86400) / 3600).toFixed(1);
        process.stderr.write(`[ShopifyMCP] OAuth token refreshed, expires in ${hours}h, scopes: ${data.scope || 'n/a'}\n`);
    }
    async graphql(query, variables) {
        await this.ensureFreshToken();
        try {
            const client = new this.client.clients.Graphql({ session: this.session });
            const response = await client.request(query, { variables });
            return response;
        }
        catch (error) {
            if (error.response?.errors) {
                throw new Error(`GraphQL Error: ${JSON.stringify(error.response.errors)}`);
            }
            throw error;
        }
    }
    async rest(path, method = 'GET', data) {
        await this.ensureFreshToken();
        try {
            const restClient = new this.client.clients.Rest({ session: this.session });
            let response;
            switch (method) {
                case 'GET':
                    response = await restClient.client.get(path);
                    break;
                case 'POST':
                    response = await restClient.client.post(path, { data });
                    break;
                case 'PUT':
                    response = await restClient.client.put(path, { data });
                    break;
                case 'DELETE':
                    response = await restClient.client.delete(path);
                    break;
                default:
                    throw new Error(`Unsupported HTTP method: ${method}`);
            }
            return response.body;
        }
        catch (error) {
            if (error.response?.body?.errors) {
                throw new Error(`REST API Error: ${JSON.stringify(error.response.body.errors)}`);
            }
            throw error;
        }
    }
    // Product operations
    async getProducts(params) {
        const query = `
      query getProducts($first: Int!, $after: String, $query: String, $sortKey: ProductSortKeys, $reverse: Boolean) {
        products(first: $first, after: $after, query: $query, sortKey: $sortKey, reverse: $reverse) {
          edges {
            cursor
            node {
              id
              title
              handle
              descriptionHtml
              vendor
              productType
              tags
              status
              totalInventory
              priceRangeV2 {
                minVariantPrice {
                  amount
                  currencyCode
                }
                maxVariantPrice {
                  amount
                  currencyCode
                }
              }
              images(first: 5) {
                edges {
                  node {
                    url
                    altText
                  }
                }
              }
              variants(first: 10) {
                edges {
                  node {
                    id
                    title
                    price
                    sku
                    inventoryQuantity
                    inventoryItem { id }
                  }
                }
              }
            }
          }
          pageInfo {
            hasNextPage
            hasPreviousPage
          }
        }
      }
    `;
        const variables = {
            first: params.limit || 10,
            after: params.cursor,
            query: params.query,
            sortKey: params.sortKey,
            reverse: params.reverse || false,
        };
        return this.graphql(query, variables);
    }
    async getProduct(id) {
        const query = `
      query getProduct($id: ID!) {
        product(id: $id) {
          id
          title
          handle
          descriptionHtml
          vendor
          productType
          tags
          status
          totalInventory
          seo {
            title
            description
          }
          priceRangeV2 {
            minVariantPrice {
              amount
              currencyCode
            }
            maxVariantPrice {
              amount
              currencyCode
            }
          }
          images(first: 20) {
            edges {
              node {
                url
                altText
              }
            }
          }
          variants(first: 100) {
            edges {
              node {
                id
                title
                price
                sku
                barcode
                inventoryQuantity
                inventoryItem {
                  id
                  measurement {
                    weight { value unit }
                  }
                }
              }
            }
          }
          metafields(first: 20) {
            edges {
              node {
                namespace
                key
                value
                type
              }
            }
          }
        }
      }
    `;
        return this.graphql(query, { id });
    }
    async createProduct(input) {
        const mutation = `
      mutation createProduct($input: ProductInput!) {
        productCreate(input: $input) {
          product {
            id
            title
            handle
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
        return this.graphql(mutation, { input });
    }
    async updateProduct(id, input) {
        const mutation = `
      mutation updateProduct($input: ProductInput!) {
        productUpdate(input: $input) {
          product {
            id
            title
            handle
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
        return this.graphql(mutation, { input: { ...input, id } });
    }
    // Order operations
    async getOrders(params) {
        const query = `
      query getOrders($first: Int!, $after: String, $query: String) {
        orders(first: $first, after: $after, query: $query) {
          edges {
            cursor
            node {
              id
              name
              createdAt
              updatedAt
              displayFinancialStatus
              displayFulfillmentStatus
              totalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              customer {
                id
                email
                firstName
                lastName
              }
              lineItems(first: 10) {
                edges {
                  node {
                    title
                    quantity
                    originalUnitPriceSet {
                      shopMoney {
                        amount
                        currencyCode
                      }
                    }
                  }
                }
              }
              shippingAddress {
                address1
                address2
                city
                province
                country
                zip
              }
            }
          }
          pageInfo {
            hasNextPage
            hasPreviousPage
          }
        }
      }
    `;
        let queryString = '';
        if (params.status)
            queryString += `status:${params.status} `;
        if (params.financialStatus)
            queryString += `financial_status:${params.financialStatus} `;
        if (params.fulfillmentStatus)
            queryString += `fulfillment_status:${params.fulfillmentStatus} `;
        if (params.query)
            queryString += params.query;
        const variables = {
            first: params.limit || 10,
            after: params.cursor,
            query: queryString.trim() || null,
        };
        return this.graphql(query, variables);
    }
    async getOrder(id) {
        const query = `
      query getOrder($id: ID!) {
        order(id: $id) {
          id
          name
          createdAt
          updatedAt
          displayFinancialStatus
          displayFulfillmentStatus
          note
          tags
          totalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          subtotalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          totalTaxSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          customer {
            id
            email
            firstName
            lastName
            phone
          }
          lineItems(first: 250) {
            edges {
              node {
                id
                title
                quantity
                sku
                vendor
                originalUnitPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                totalDiscountSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
          shippingAddress {
            firstName
            lastName
            address1
            address2
            city
            province
            country
            zip
            phone
          }
          billingAddress {
            firstName
            lastName
            address1
            address2
            city
            province
            country
            zip
            phone
          }
          fulfillments {
            status
            createdAt
            trackingInfo {
              number
              url
            }
          }
          transactions {
            kind
            status
            amount
            gateway
          }
        }
      }
    `;
        return this.graphql(query, { id });
    }
    // Customer operations
    async getCustomers(params) {
        const query = `
      query getCustomers($first: Int!, $after: String, $query: String, $sortKey: CustomerSortKeys, $reverse: Boolean) {
        customers(first: $first, after: $after, query: $query, sortKey: $sortKey, reverse: $reverse) {
          edges {
            cursor
            node {
              id
              email
              firstName
              lastName
              phone
              state
              numberOfOrders
              amountSpent {
                amount
                currencyCode
              }
              createdAt
              updatedAt
              defaultAddress {
                address1
                address2
                city
                province
                country
                zip
              }
              tags
            }
          }
          pageInfo {
            hasNextPage
            hasPreviousPage
          }
        }
      }
    `;
        const variables = {
            first: params.limit || 10,
            after: params.cursor,
            query: params.query,
            sortKey: params.sortKey,
            reverse: params.reverse || false,
        };
        return this.graphql(query, variables);
    }
    async getCustomer(id) {
        const query = `
      query getCustomer($id: ID!) {
        customer(id: $id) {
          id
          email
          firstName
          lastName
          phone
          state
          numberOfOrders
          amountSpent {
            amount
            currencyCode
          }
          createdAt
          updatedAt
          defaultAddress {
            address1
            address2
            city
            province
            country
            zip
          }
          addresses(first: 10) {
            address1
            address2
            city
            province
            country
            zip
            phone
          }
          orders(first: 10) {
            edges {
              node {
                id
                name
                createdAt
                totalPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                displayFinancialStatus
                displayFulfillmentStatus
              }
            }
          }
          metafields(first: 20) {
            edges {
              node {
                namespace
                key
                value
                type
              }
            }
          }
          tags
        }
      }
    `;
        return this.graphql(query, { id });
    }
    // Inventory operations
    async getInventoryLevels(inventoryItemId) {
        const query = `
      query getInventoryLevels($inventoryItemId: ID!) {
        inventoryItem(id: $inventoryItemId) {
          id
          sku
          tracked
          inventoryLevels(first: 10) {
            edges {
              node {
                id
                quantities(names: ["available", "on_hand", "committed", "incoming", "reserved"]) {
                  name
                  quantity
                }
                location {
                  id
                  name
                }
              }
            }
          }
        }
      }
    `;
        return this.graphql(query, { inventoryItemId });
    }
    async adjustInventory(inventoryItemId, locationId, quantity) {
        const mutation = `
      mutation adjustInventory($input: InventoryAdjustQuantitiesInput!) {
        inventoryAdjustQuantities(input: $input) {
          inventoryAdjustmentGroup {
            createdAt
            reason
            changes {
              name
              delta
              quantityAfterChange
              item { id sku }
              location { id name }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
        const input = {
            reason: 'correction',
            name: 'available',
            changes: [{ delta: quantity, inventoryItemId, locationId }],
        };
        return this.graphql(mutation, { input });
    }
    // Metafield operations
    async setMetafield(ownerId, metafield) {
        const mutation = `
      mutation setMetafield($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
            namespace
            key
            value
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
        const metafields = [{
                ownerId,
                namespace: metafield.namespace,
                key: metafield.key,
                value: metafield.value,
                type: metafield.type || 'single_line_text_field',
            }];
        return this.graphql(mutation, { metafields });
    }
    // Collection operations
    async getCollections(params) {
        const query = `
      query getCollections($first: Int!, $after: String, $query: String) {
        collections(first: $first, after: $after, query: $query) {
          edges {
            cursor
            node {
              id
              title
              handle
              descriptionHtml
              image {
                url
                altText
              }
              productsCount { count }
              updatedAt
            }
          }
          pageInfo {
            hasNextPage
            hasPreviousPage
          }
        }
      }
    `;
        const variables = {
            first: params.limit || 10,
            after: params.cursor,
            query: params.query,
        };
        return this.graphql(query, variables);
    }
    // Location operations
    async getLocations() {
        const query = `
      query getLocations {
        locations(first: 10) {
          edges {
            node {
              id
              name
              isActive
              address {
                address1
                address2
                city
                province
                country
                zip
              }
            }
          }
        }
      }
    `;
        return this.graphql(query);
    }
    // Analytics operations
    async getShopAnalytics() {
        const query = `
      query getShop {
        shop {
          id
          name
          email
          currencyCode
          primaryDomain {
            url
          }
          billingAddress {
            country
          }
          plan {
            displayName
          }
          fulfillmentServices {
            serviceName
            type
          }
        }
      }
    `;
        return this.graphql(query);
    }
    // Discount operations
    async getDiscounts(params) {
        const query = `
      query getDiscounts($first: Int!, $after: String, $query: String, $savedSearchId: ID) {
        discountNodes(first: $first, after: $after, query: $query, savedSearchId: $savedSearchId) {
          edges {
            cursor
            node {
              id
              discount {
                ... on DiscountCodeBasic {
                  title
                  status
                  startsAt
                  endsAt
                  usageLimit
                  asyncUsageCount
                  codes(first: 10) {
                    edges {
                      node {
                        code
                      }
                    }
                  }
                  customerGets {
                    value {
                      ... on DiscountPercentage {
                        percentage
                      }
                      ... on DiscountAmount {
                        amount {
                          amount
                          currencyCode
                        }
                      }
                    }
                  }
                }
                ... on DiscountAutomaticBasic {
                  title
                  status
                  startsAt
                  endsAt
                }
              }
            }
          }
          pageInfo {
            hasNextPage
            hasPreviousPage
          }
        }
      }
    `;
        const variables = {
            first: params.limit || 10,
            after: params.cursor,
            query: params.query,
            savedSearchId: params.savedSearchId,
        };
        return this.graphql(query, variables);
    }
    async createDiscountCode(params) {
        const mutation = `
      mutation createDiscountCode($basicCodeDiscount: DiscountCodeBasicInput!) {
        discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
          codeDiscountNode {
            id
            codeDiscount {
              ... on DiscountCodeBasic {
                title
                codes(first: 1) {
                  edges {
                    node {
                      code
                    }
                  }
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
        const basicCodeDiscount = {
            title: params.title,
            code: params.code,
            startsAt: params.startsAt,
            endsAt: params.endsAt,
            usageLimit: params.usageLimit,
            appliesOncePerCustomer: params.appliesOncePerCustomer,
            minimumRequirement: params.minimumRequirement,
            customerGets: params.customerGets,
            customerSelection: params.customerSelection ? { all: params.customerSelection === 'all' } : { all: true },
        };
        return this.graphql(mutation, { basicCodeDiscount });
    }
    // Fulfillment operations
    async getFulfillmentOrders(params) {
        const query = `
      query getFulfillmentOrders($first: Int!, $after: String) {
        shop {
          fulfillmentOrders(first: $first, after: $after, includeClosed: true) {
            edges {
              cursor
              node {
                id
                status
                createdAt
                updatedAt
                assignedLocation {
                  name
                }
                order {
                  id
                  name
                }
                lineItems(first: 10) {
                  edges {
                    node {
                      id
                      productTitle
                      remainingQuantity
                    }
                  }
                }
              }
            }
            pageInfo {
              hasNextPage
              hasPreviousPage
            }
          }
        }
      }
    `;
        const variables = {
            first: params.limit || 10,
            after: params.cursor,
        };
        return this.graphql(query, variables);
    }
    async createFulfillment(params) {
        const mutation = `
      mutation createFulfillment($fulfillment: FulfillmentV2Input!) {
        fulfillmentCreateV2(fulfillment: $fulfillment) {
          fulfillment {
            id
            status
            trackingInfo {
              number
              url
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
        const fulfillment = {
            notifyCustomer: params.notifyCustomer,
            trackingInfo: params.trackingInfo,
            lineItemsByFulfillmentOrder: {
                fulfillmentOrderId: params.orderId,
                fulfillmentOrderLineItems: params.lineItems,
            },
        };
        return this.graphql(mutation, { fulfillment });
    }
    async getShippingZones(params) {
        const query = `
      query getShippingZones($first: Int!) {
        deliveryProfiles(first: $first) {
          edges {
            node {
              id
              name
              profileLocationGroups {
                locationGroup {
                  id
                  locations(first: 10) {
                    edges {
                      node {
                        name
                      }
                    }
                  }
                }
                locationGroupZones(first: 10) {
                  edges {
                    node {
                      zone {
                        name
                        countries {
                          code { countryCode restOfWorld }
                          name
                        }
                      }
                      methodDefinitions(first: 10) {
                        edges {
                          node {
                            name
                            rateProvider {
                              ... on DeliveryRateDefinition {
                                price {
                                  amount
                                  currencyCode
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;
        return this.graphql(query, { first: params.limit || 10 });
    }
    // Financial operations
    async getOrderTransactions(orderId) {
        const query = `
      query getOrderTransactions($id: ID!) {
        order(id: $id) {
          transactions {
            id
            kind
            status
            test
            amount
            gateway
            authorizationCode
            createdAt
          }
        }
      }
    `;
        return this.graphql(query, { id: orderId });
    }
    async createRefund(params) {
        const mutation = `
      mutation createRefund($input: RefundInput!) {
        refundCreate(input: $input) {
          refund {
            id
            totalRefundedSet {
              shopMoney {
                amount
                currencyCode
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
        const input = {
            orderId: params.orderId,
            refundLineItems: params.lineItems,
            shipping: params.shipping,
            refundDuties: params.refundDuties,
            note: params.note,
            notify: params.notify,
        };
        return this.graphql(mutation, { input });
    }
    // Gift card operations
    async getGiftCards(params) {
        const query = `
      query getGiftCards($first: Int!, $after: String, $query: String) {
        giftCards(first: $first, after: $after, query: $query) {
          edges {
            cursor
            node {
              id
              balance {
                amount
                currencyCode
              }
              initialValue {
                amount
                currencyCode
              }
              expiresOn
              lastCharacters
              createdAt
              customer {
                displayName
                email
              }
            }
          }
          pageInfo {
            hasNextPage
            hasPreviousPage
          }
        }
      }
    `;
        const variables = {
            first: params.limit || 10,
            after: params.cursor,
            query: params.query,
        };
        return this.graphql(query, variables);
    }
    async createGiftCard(params) {
        const mutation = `
      mutation createGiftCard($input: GiftCardCreateInput!) {
        giftCardCreate(input: $input) {
          giftCard {
            id
            balance {
              amount
              currencyCode
            }
            giftCardCode
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
        const input = {
            initialValue: params.initialValue,
            customCode: params.code,
            note: params.note,
            expiresOn: params.expiresOn,
            recipientAttributes: params.recipientEmail ? {
                email: params.recipientEmail,
                message: params.recipientMessage,
            } : undefined,
        };
        return this.graphql(mutation, { input });
    }
    // Content operations
    async getPages(params) {
        const query = `
      query getPages($first: Int!, $after: String) {
        pages(first: $first, after: $after) {
          edges {
            cursor
            node {
              id
              title
              handle
              body
              bodySummary
              createdAt
              updatedAt
              publishedAt
            }
          }
          pageInfo {
            hasNextPage
            hasPreviousPage
          }
        }
      }
    `;
        const variables = {
            first: params.limit || 10,
            after: params.cursor,
        };
        return this.graphql(query, variables);
    }
    async createPage(params) {
        const mutation = `
      mutation createPage($page: PageCreateInput!) {
        pageCreate(page: $page) {
          page {
            id
            title
            handle
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
        const page = {
            title: params.title,
            body: params.content,
            handle: params.handle,
            published: params.published,
            metafields: params.metafields,
        };
        return this.graphql(mutation, { page });
    }
    async getBlogs(params) {
        const query = `
      query getBlogs($first: Int!, $after: String) {
        blogs(first: $first, after: $after) {
          edges {
            cursor
            node {
              id
              title
              handle
              createdAt
            }
          }
          pageInfo {
            hasNextPage
            hasPreviousPage
          }
        }
      }
    `;
        const variables = {
            first: params.limit || 10,
            after: params.cursor,
        };
        return this.graphql(query, variables);
    }
    async createArticle(params) {
        const mutation = `
      mutation createArticle($article: ArticleCreateInput!) {
        articleCreate(article: $article) {
          article {
            id
            title
            handle
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
        const article = {
            blogId: params.blogId,
            title: params.title,
            contentHtml: params.content,
            summary: params.summary,
            tags: params.tags,
            published: params.published,
            publishedAt: params.publishedAt,
            image: params.image,
        };
        return this.graphql(mutation, { article });
    }
    async createRedirect(params) {
        const mutation = `
      mutation createRedirect($urlRedirect: UrlRedirectInput!) {
        urlRedirectCreate(urlRedirect: $urlRedirect) {
          urlRedirect {
            id
            path
            target
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
        const urlRedirect = {
            path: params.path,
            target: params.target,
        };
        return this.graphql(mutation, { urlRedirect });
    }
    // Theme operations
    async getThemes() {
        const query = `
      query getThemes {
        themes(first: 10) {
          edges {
            node {
              id
              name
              role
              createdAt
              updatedAt
            }
          }
        }
      }
    `;
        return this.graphql(query);
    }
    // Webhook operations
    async getWebhooks(params) {
        const query = `
      query getWebhooks($first: Int!, $after: String) {
        webhookSubscriptions(first: $first, after: $after) {
          edges {
            cursor
            node {
              id
              topic
              callbackUrl
              format
              createdAt
              updatedAt
            }
          }
          pageInfo {
            hasNextPage
            hasPreviousPage
          }
        }
      }
    `;
        const variables = {
            first: params.limit || 10,
            after: params.cursor,
        };
        return this.graphql(query, variables);
    }
    async createWebhook(params) {
        const mutation = `
      mutation createWebhook($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
          webhookSubscription {
            id
            topic
            callbackUrl
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
        const webhookSubscription = {
            callbackUrl: params.callbackUrl,
            format: params.format,
            includeFields: params.includeFields,
        };
        return this.graphql(mutation, {
            topic: params.topic,
            webhookSubscription
        });
    }
    // Draft order operations
    async getDraftOrders(params) {
        const query = `
      query getDraftOrders($first: Int!, $after: String, $query: String) {
        draftOrders(first: $first, after: $after, query: $query) {
          edges {
            cursor
            node {
              id
              name
              createdAt
              updatedAt
              totalPriceSet { presentmentMoney { amount currencyCode } }
              subtotalPriceSet { presentmentMoney { amount currencyCode } }
              invoiceSentAt
              status
              customer {
                displayName
                email
              }
              lineItems(first: 10) {
                edges {
                  node {
                    title
                    quantity
                    originalUnitPriceSet { presentmentMoney { amount currencyCode } }
                    discountedTotalSet { presentmentMoney { amount currencyCode } }
                  }
                }
              }
            }
          }
          pageInfo {
            hasNextPage
            hasPreviousPage
          }
        }
      }
    `;
        const variables = {
            first: params.limit || 10,
            after: params.cursor,
            query: params.query,
        };
        return this.graphql(query, variables);
    }
    async createDraftOrder(params) {
        const mutation = `
      mutation createDraftOrder($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) {
          draftOrder {
            id
            name
            totalPriceSet { presentmentMoney { amount currencyCode } }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
        const input = {
            lineItems: params.lineItems,
            customerId: params.customerId,
            email: params.email,
            note: params.note,
            tags: params.tags,
            shippingAddress: params.shippingAddress,
            billingAddress: params.billingAddress,
        };
        return this.graphql(mutation, { input });
    }
    // Metaobject operations (GraphQL exclusive)
    async getMetaobjects(params) {
        const query = `
      query getMetaobjects($type: String!, $first: Int!, $after: String) {
        metaobjects(type: $type, first: $first, after: $after) {
          edges {
            cursor
            node {
              id
              type
              handle
              updatedAt
              fields {
                key
                value
              }
            }
          }
          pageInfo {
            hasNextPage
            hasPreviousPage
          }
        }
      }
    `;
        const variables = {
            type: params.type,
            first: params.limit || 10,
            after: params.cursor,
        };
        return this.graphql(query, variables);
    }
    async createMetaobject(params) {
        const mutation = `
      mutation createMetaobject($metaobject: MetaobjectCreateInput!) {
        metaobjectCreate(metaobject: $metaobject) {
          metaobject {
            id
            type
            handle
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
        const metaobject = {
            type: params.type,
            fields: params.fields,
        };
        return this.graphql(mutation, { metaobject });
    }
    // Markets operations
    async getMarkets(params) {
        const query = `
      query getMarkets($first: Int!) {
        markets(first: $first) {
          edges {
            node {
              id
              name
              handle
              enabled
              primary
              regions(first: 10) {
                edges {
                  node {
                    id
                    name
                    ... on MarketRegionCountry {
                      code
                    }
                  }
                }
              }
              webPresence {
                defaultLocale { locale name }
                alternateLocales { locale name }
                domain {
                  url
                }
              }
            }
          }
        }
      }
    `;
        return this.graphql(query, { first: params.limit || 10 });
    }
    // Price rules operations
    async getPriceRules(params) {
        const query = `
      query getDiscountNodes($first: Int!, $after: String) {
        discountNodes(first: $first, after: $after) {
          edges {
            cursor
            node {
              id
              discount {
                __typename
                ... on DiscountCodeBasic {
                  title
                  status
                  startsAt
                  endsAt
                  summary
                  usageLimit
                  codesCount { count }
                }
                ... on DiscountAutomaticBasic {
                  title
                  status
                  startsAt
                  endsAt
                  summary
                }
                ... on DiscountCodeBxgy {
                  title
                  status
                  startsAt
                  endsAt
                  summary
                  usageLimit
                }
                ... on DiscountAutomaticBxgy {
                  title
                  status
                  startsAt
                  endsAt
                  summary
                }
                ... on DiscountCodeFreeShipping {
                  title
                  status
                  startsAt
                  endsAt
                  summary
                  usageLimit
                }
                ... on DiscountAutomaticApp {
                  title
                  status
                  startsAt
                  endsAt
                }
              }
            }
          }
          pageInfo {
            hasNextPage
            hasPreviousPage
          }
        }
      }
    `;
        const variables = {
            first: params.limit || 10,
            after: params.cursor,
        };
        return this.graphql(query, variables);
    }
    // Abandoned checkout operations
    async getAbandonedCheckouts(params) {
        const query = `
      query getAbandonedCheckouts($first: Int!, $after: String, $query: String) {
        abandonedCheckouts(first: $first, after: $after, query: $query) {
          edges {
            cursor
            node {
              id
              createdAt
              updatedAt
              totalPriceSet { presentmentMoney { amount currencyCode } }
              subtotalPriceSet { presentmentMoney { amount currencyCode } }
              customer {
                displayName
                email
              }
              lineItems(first: 10) {
                edges {
                  node {
                    title
                    quantity
                    originalUnitPriceSet { presentmentMoney { amount currencyCode } }
                    discountedTotalPriceSet { presentmentMoney { amount currencyCode } }
                  }
                }
              }
            }
          }
          pageInfo {
            hasNextPage
            hasPreviousPage
          }
        }
      }
    `;
        const variables = {
            first: params.limit || 10,
            after: params.cursor,
            query: params.query,
        };
        return this.graphql(query, variables);
    }
    // Reports and analytics operations
    async runShopifyQL(ql) {
        const query = `
      query runShopifyQL($q: String!) {
        shopifyqlQuery(query: $q) {
          parseErrors
          tableData {
            columns { name dataType displayName }
            rows
          }
        }
      }
    `;
        return this.graphql(query, { q: ql });
    }
    async getSalesReport(params) {
        const ql = params.query
            ? params.query
            : `FROM sales SHOW total_sales, gross_sales, net_sales, orders, average_order_value SINCE ${params.startDate} UNTIL ${params.endDate}`;
        return this.runShopifyQL(ql);
    }
    async getProductAnalytics(params) {
        const query = `
      query getProductAnalytics {
        products(first: ${params.limit || 50}, sortKey: UPDATED_AT, reverse: true) {
          edges {
            node {
              id
              title
              totalInventory
              priceRangeV2 {
                minVariantPrice {
                  amount
                  currencyCode
                }
              }
              tracksInventory
            }
          }
        }
      }
    `;
        return this.graphql(query);
    }
    async getCustomerAnalytics(_params) {
        const query = `
      query getCustomerAnalytics {
        customersCount { count }
        customers(first: 100, sortKey: UPDATED_AT, reverse: true) {
          edges {
            node {
              id
              numberOfOrders
              amountSpent {
                amount
                currencyCode
              }
              createdAt
            }
          }
        }
      }
    `;
        return this.graphql(query);
    }
    async getInventoryReport(_params) {
        const query = `
      query getInventoryReport {
        products(first: 100) {
          edges {
            node {
              id
              title
              totalInventory
              tracksInventory
              variants(first: 10) {
                edges {
                  node {
                    inventoryQuantity
                    sku
                  }
                }
              }
            }
          }
        }
      }
    `;
        return this.graphql(query);
    }
    async getMarketingReport(_params) {
        const query = `
      query getMarketingReport {
        marketingActivities(first: 50) {
          edges {
            node {
              id
              title
              status
              budget {
                budgetType
                total {
                  amount
                  currencyCode
                }
              }
              marketingChannel
              createdAt
            }
          }
        }
      }
    `;
        return this.graphql(query);
    }
    async getFinancialSummary(params) {
        const gqlQuery = `
      query getFinancialSummary($query: String!) {
        orders(first: 250, query: $query) {
          edges {
            node {
              totalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              totalTaxSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              totalShippingPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              refunds {
                totalRefundedSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
              }
              createdAt
            }
          }
        }
      }
    `;
        const searchQuery = `created_at:>='${params.startDate}' AND created_at:<='${params.endDate}'`;
        return this.graphql(gqlQuery, { query: searchQuery });
    }
    async getConversionReport(params) {
        const ql = params.query
            ? params.query
            : `FROM sales SHOW product_title, total_sales, gross_sales, orders SINCE ${params.startDate} UNTIL ${params.endDate} GROUP BY product_title ORDER BY total_sales DESC LIMIT 25`;
        return this.runShopifyQL(ql);
    }
    async getAbandonmentReport(params) {
        const query = `
      query getAbandonmentReport($filter: String!) {
        abandonedCheckouts(first: 100, query: $filter) {
          edges {
            node {
              id
              createdAt
              totalPriceSet { presentmentMoney { amount currencyCode } }
              lineItems(first: 10) {
                edges {
                  node {
                    quantity
                  }
                }
              }
            }
          }
        }
      }
    `;
        const filter = `created_at:>=${params.startDate} AND created_at:<=${params.endDate}`;
        return this.graphql(query, { filter });
    }
    async getTrafficReport(params) {
        const ql = params.query
            ? params.query
            : `FROM sessions SHOW referrer_source, sessions, online_store_visitors SINCE ${params.startDate} UNTIL ${params.endDate} GROUP BY referrer_source ORDER BY sessions DESC LIMIT 25`;
        return this.runShopifyQL(ql);
    }
    async getCustomReport(params) {
        if (!params.query) {
            throw new Error("getCustomReport requires a `query` parameter with a raw ShopifyQL string. Example: FROM sales SHOW total_sales SINCE 2026-01-01 UNTIL today. Use runShopifyQL or listMetaobjectDefinitions to explore the schema first.");
        }
        return this.runShopifyQL(params.query);
    }
    async getMetaobjectDefinitions(params) {
        const query = `
      query getMetaobjectDefinitions($first: Int!, $after: String) {
        metaobjectDefinitions(first: $first, after: $after) {
          edges {
            cursor
            node {
              id
              type
              name
              description
              fieldDefinitions {
                key
                name
                type { name }
              }
            }
          }
          pageInfo {
            hasNextPage
            hasPreviousPage
          }
        }
      }
    `;
        return this.graphql(query, {
            first: params.limit || 25,
            after: params.cursor,
        });
    }
    // B2B operations
    async getCompanies(params) {
        const query = `
      query getCompanies($first: Int!, $after: String) {
        companies(first: $first, after: $after) {
          edges {
            cursor
            node {
              id
              name
              externalId
              note
              createdAt
              updatedAt
              mainContact {
                customer {
                  displayName
                  email
                }
              }
            }
          }
          pageInfo {
            hasNextPage
            hasPreviousPage
          }
        }
      }
    `;
        const variables = {
            first: params.limit || 10,
            after: params.cursor,
        };
        return this.graphql(query, variables);
    }
    async createCompany(params) {
        const mutation = `
      mutation createCompany($input: CompanyCreateInput!) {
        companyCreate(input: $input) {
          company {
            id
            name
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
        const input = {
            company: {
                name: params.name,
                externalId: params.externalId,
                note: params.note,
            },
            companyContact: params.contactEmail ? {
                email: params.contactEmail,
                phone: params.contactPhone,
            } : undefined,
        };
        return this.graphql(mutation, { input });
    }
}
//# sourceMappingURL=shopify-client.js.map