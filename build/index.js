#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import dotenv from 'dotenv';
import { ShopifyClient } from './shopify-client.js';
import express from 'express';
// Load environment variables only if not already set
if (!process.env.SHOPIFY_STORE_DOMAIN || !process.env.SHOPIFY_CLIENT_ID || !process.env.SHOPIFY_CLIENT_SECRET) {
    dotenv.config();
}
// Validate environment variables
const requiredEnvVars = ['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET'];
for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        process.stderr.write(`Error: ${envVar} is required\n\n`);
        process.stderr.write(`Please set the following environment variables:\n`);
        process.stderr.write(`  SHOPIFY_STORE_DOMAIN - Your Shopify store domain (e.g., my-store.myshopify.com)\n`);
        process.stderr.write(`  SHOPIFY_CLIENT_ID - Client ID from Shopify Dev Dashboard\n`);
        process.stderr.write(`  SHOPIFY_CLIENT_SECRET - Client Secret from Shopify Dev Dashboard\n\n`);
        process.stderr.write(`You can set them in your MCP settings or create a .env file\n`);
        process.exit(1);
    }
}
// Basic validation
const domain = process.env.SHOPIFY_STORE_DOMAIN;
if (!domain.includes('.myshopify.com') && !domain.includes('.')) {
    process.stderr.write(`Error: Invalid store domain format. Expected format: store-name.myshopify.com\n`);
    process.exit(1);
}
// Initialize Shopify client
const shopifyClient = new ShopifyClient({
    storeDomain: process.env.SHOPIFY_STORE_DOMAIN,
    clientId: process.env.SHOPIFY_CLIENT_ID,
    clientSecret: process.env.SHOPIFY_CLIENT_SECRET,
    apiVersion: process.env.SHOPIFY_API_VERSION,
});
// Create MCP server (moved to bottom)
// Register all tools
function registerTools(server) {
    // Product Tools
    server.tool('listProducts', 'List products from the Shopify store', {
        limit: z.number().optional().default(10),
        cursor: z.string().optional(),
        query: z.string().optional(),
        sortKey: z.enum(['TITLE', 'PRODUCT_TYPE', 'VENDOR', 'CREATED_AT', 'UPDATED_AT']).optional(),
        reverse: z.boolean().optional().default(false)
    }, async (args) => {
        try {
            const result = await shopifyClient.getProducts(args);
            const products = result.data.products.edges.map((edge) => edge.node);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            products,
                            pageInfo: result.data.products.pageInfo,
                        }, null, 2),
                    }],
            };
        }
        catch (error) {
            console.error('[listProducts Error]:', error);
            return {
                content: [{
                        type: 'text',
                        text: `Error fetching products: ${error.message || 'Unknown error'}`,
                    }],
                isError: true,
            };
        }
    });
    server.tool('getProduct', 'Get a specific product by ID', {
        id: z.string().describe('The product ID (e.g., gid://shopify/Product/123)')
    }, async (args) => {
        try {
            const result = await shopifyClient.getProduct(args.id);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result.data.product, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error fetching product: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    server.tool('createProduct', 'Create a new product', {
        title: z.string(),
        description: z.string().optional(),
        vendor: z.string().optional(),
        productType: z.string().optional(),
        tags: z.array(z.string()).optional(),
        status: z.enum(['ACTIVE', 'DRAFT', 'ARCHIVED']).optional().default('ACTIVE'),
        variants: z.array(z.object({
            price: z.string(),
            sku: z.string().optional(),
            inventoryQuantity: z.number().optional(),
        })).optional()
    }, async (args) => {
        try {
            const input = {
                title: args.title,
                descriptionHtml: args.description,
                vendor: args.vendor,
                productType: args.productType,
                tags: args.tags,
                status: args.status,
                variants: args.variants,
            };
            const result = await shopifyClient.createProduct(input);
            if (result.data.productCreate.userErrors.length > 0) {
                return {
                    content: [{
                            type: 'text',
                            text: `Error creating product: ${JSON.stringify(result.data.productCreate.userErrors)}`,
                        }],
                    isError: true,
                };
            }
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result.data.productCreate.product, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error creating product: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    server.tool('updateProduct', 'Update an existing product', {
        id: z.string().describe('The product ID to update'),
        title: z.string().optional(),
        description: z.string().optional(),
        vendor: z.string().optional(),
        productType: z.string().optional(),
        tags: z.array(z.string()).optional(),
        status: z.enum(['ACTIVE', 'DRAFT', 'ARCHIVED']).optional()
    }, async (args) => {
        try {
            const { id, ...input } = args;
            if (input.description) {
                input.descriptionHtml = input.description;
                delete input.description;
            }
            const result = await shopifyClient.updateProduct(id, input);
            if (result.data.productUpdate.userErrors.length > 0) {
                return {
                    content: [{
                            type: 'text',
                            text: `Error updating product: ${JSON.stringify(result.data.productUpdate.userErrors)}`,
                        }],
                    isError: true,
                };
            }
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result.data.productUpdate.product, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error updating product: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    // Order Tools
    server.tool('listOrders', 'List orders from the Shopify store', {
        limit: z.number().optional().default(10),
        cursor: z.string().optional(),
        query: z.string().optional(),
        status: z.enum(['open', 'closed', 'cancelled', 'any']).optional(),
        financialStatus: z.enum(['paid', 'pending', 'refunded', 'partially_refunded', 'any']).optional(),
        fulfillmentStatus: z.enum(['shipped', 'partial', 'unshipped', 'any']).optional()
    }, async (args) => {
        try {
            const result = await shopifyClient.getOrders(args);
            const orders = result.data.orders.edges.map((edge) => edge.node);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            orders,
                            pageInfo: result.data.orders.pageInfo,
                        }, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error fetching orders: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    server.tool('getOrder', 'Get a specific order by ID', {
        id: z.string().describe('The order ID (e.g., gid://shopify/Order/123)')
    }, async (args) => {
        try {
            const result = await shopifyClient.getOrder(args.id);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result.data.order, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error fetching order: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    // Customer Tools
    server.tool('listCustomers', 'List customers from the Shopify store', {
        limit: z.number().optional().default(10),
        cursor: z.string().optional(),
        query: z.string().optional(),
        sortKey: z.enum(['NAME', 'CREATED_AT', 'UPDATED_AT', 'LOCATION', 'RELEVANCE']).optional(),
        reverse: z.boolean().optional().default(false)
    }, async (args) => {
        try {
            const result = await shopifyClient.getCustomers(args);
            const customers = result.data.customers.edges.map((edge) => edge.node);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            customers,
                            pageInfo: result.data.customers.pageInfo,
                        }, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error fetching customers: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    server.tool('getCustomer', 'Get a specific customer by ID', {
        id: z.string().describe('The customer ID (e.g., gid://shopify/Customer/123)')
    }, async (args) => {
        try {
            const result = await shopifyClient.getCustomer(args.id);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result.data.customer, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error fetching customer: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    // Inventory Tools
    server.tool('getInventoryLevels', 'Get inventory levels for a product variant', {
        inventoryItemId: z.string().describe('The inventory item ID')
    }, async (args) => {
        try {
            const result = await shopifyClient.getInventoryLevels(args.inventoryItemId);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result.data.inventoryItem, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error fetching inventory levels: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    server.tool('adjustInventory', 'Adjust inventory quantity', {
        inventoryItemId: z.string(),
        locationId: z.string(),
        quantity: z.number()
    }, async (args) => {
        try {
            const result = await shopifyClient.adjustInventory(args.inventoryItemId, args.locationId, args.quantity);
            if (result.data.inventoryAdjustQuantities.userErrors.length > 0) {
                return {
                    content: [{
                            type: 'text',
                            text: `Error adjusting inventory: ${JSON.stringify(result.data.inventoryAdjustQuantities.userErrors)}`,
                        }],
                    isError: true,
                };
            }
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result.data.inventoryAdjustQuantities.inventoryAdjustmentGroup, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error adjusting inventory: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    // Metafield Tools
    server.tool('setMetafield', 'Set a metafield on a resource', {
        ownerId: z.string().describe('The ID of the resource to attach the metafield to'),
        namespace: z.string(),
        key: z.string(),
        value: z.string(),
        type: z.string().optional().default('single_line_text_field')
    }, async (args) => {
        try {
            const result = await shopifyClient.setMetafield(args.ownerId, {
                namespace: args.namespace,
                key: args.key,
                value: args.value,
                type: args.type,
            });
            if (result.data.metafieldsSet.userErrors.length > 0) {
                return {
                    content: [{
                            type: 'text',
                            text: `Error setting metafield: ${JSON.stringify(result.data.metafieldsSet.userErrors)}`,
                        }],
                    isError: true,
                };
            }
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result.data.metafieldsSet.metafields, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error setting metafield: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    // Collection Tools
    server.tool('listCollections', 'List collections from the Shopify store', {
        limit: z.number().optional().default(10),
        cursor: z.string().optional(),
        query: z.string().optional()
    }, async (args) => {
        try {
            const result = await shopifyClient.getCollections(args);
            const collections = result.data.collections.edges.map((edge) => edge.node);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            collections,
                            pageInfo: result.data.collections.pageInfo,
                        }, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error fetching collections: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    // Location Tools
    server.tool('listLocations', 'List all store locations', async () => {
        try {
            const result = await shopifyClient.getLocations();
            const locations = result.data.locations.edges.map((edge) => edge.node);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(locations, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error fetching locations: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    // Analytics Tools
    server.tool('getShopInfo', 'Get shop information and analytics', async () => {
        try {
            const result = await shopifyClient.getShopAnalytics();
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result.data.shop, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error fetching shop info: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    // Discount Tools
    server.tool('listDiscounts', 'List discount codes and automatic discounts', {
        limit: z.number().optional().default(10),
        cursor: z.string().optional(),
        query: z.string().optional(),
        savedSearchId: z.string().optional()
    }, async (args) => {
        try {
            const result = await shopifyClient.getDiscounts(args);
            const discounts = result.data.discountNodes.edges.map((edge) => edge.node);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            discounts,
                            pageInfo: result.data.discountNodes.pageInfo,
                        }, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error fetching discounts: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    server.tool('createDiscountCode', 'Create a discount code', {
        title: z.string(),
        code: z.string(),
        startsAt: z.string().optional(),
        endsAt: z.string().optional(),
        usageLimit: z.number().optional(),
        appliesOncePerCustomer: z.boolean().optional(),
        minimumRequirement: z.object({
            quantity: z.number().optional(),
            subtotal: z.string().optional()
        }).optional(),
        customerGets: z.object({
            value: z.object({
                percentage: z.number().optional(),
                amount: z.string().optional()
            }),
            items: z.enum(['all', 'products', 'collections']).optional()
        }),
        customerSelection: z.enum(['all', 'customer_segments']).optional().default('all')
    }, async (args) => {
        try {
            const result = await shopifyClient.createDiscountCode(args);
            if (result.data.discountCodeBasicCreate.userErrors.length > 0) {
                return {
                    content: [{
                            type: 'text',
                            text: `Error creating discount: ${JSON.stringify(result.data.discountCodeBasicCreate.userErrors)}`,
                        }],
                    isError: true,
                };
            }
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result.data.discountCodeBasicCreate.codeDiscountNode, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error creating discount: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    // Fulfillment Tools
    server.tool('listFulfillmentOrders', 'List fulfillment orders', {
        limit: z.number().optional().default(10),
        cursor: z.string().optional(),
        status: z.enum(['open', 'in_progress', 'cancelled', 'incomplete', 'closed']).optional(),
        assignedLocationId: z.string().optional()
    }, async (args) => {
        try {
            const result = await shopifyClient.getFulfillmentOrders(args);
            const fulfillmentOrders = result.data.shop.fulfillmentOrders.edges.map((edge) => edge.node);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            fulfillmentOrders,
                            pageInfo: result.data.shop.fulfillmentOrders.pageInfo,
                        }, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error fetching fulfillment orders: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    server.tool('createFulfillment', 'Create a fulfillment for an order', {
        orderId: z.string().describe('The order ID to fulfill'),
        lineItems: z.array(z.object({
            id: z.string(),
            quantity: z.number()
        })),
        trackingInfo: z.object({
            number: z.string().optional(),
            url: z.string().optional(),
            company: z.string().optional()
        }).optional(),
        notifyCustomer: z.boolean().optional().default(true),
        locationId: z.string().optional()
    }, async (args) => {
        try {
            const result = await shopifyClient.createFulfillment(args);
            if (result.data.fulfillmentCreateV2.userErrors.length > 0) {
                return {
                    content: [{
                            type: 'text',
                            text: `Error creating fulfillment: ${JSON.stringify(result.data.fulfillmentCreateV2.userErrors)}`,
                        }],
                    isError: true,
                };
            }
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result.data.fulfillmentCreateV2.fulfillment, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error creating fulfillment: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    // Shipping Tools
    server.tool('getShippingZones', 'Get shipping zones and rates', {
        limit: z.number().optional().default(10)
    }, async (args) => {
        try {
            const result = await shopifyClient.getShippingZones(args);
            const edges = result.data?.deliveryProfiles?.edges || [];
            const zones = edges.length > 0 ? edges[0].node.profileLocationGroups : [];
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(zones, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error fetching shipping zones: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    // Financial Tools
    server.tool('listTransactions', 'List transactions for an order', {
        orderId: z.string().describe('The order ID')
    }, async (args) => {
        try {
            const result = await shopifyClient.getOrderTransactions(args.orderId);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result.data.order.transactions, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error fetching transactions: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    server.tool('createRefund', 'Create a refund for an order', {
        orderId: z.string().describe('The order ID to refund'),
        lineItems: z.array(z.object({
            lineItemId: z.string(),
            quantity: z.number(),
            restockType: z.enum(['NO_RESTOCK', 'RETURN', 'CANCEL']).optional()
        })).optional(),
        shipping: z.object({
            amount: z.string(),
            fullRefund: z.boolean().optional()
        }).optional(),
        refundDuties: z.boolean().optional(),
        note: z.string().optional(),
        notify: z.boolean().optional().default(true)
    }, async (args) => {
        try {
            const result = await shopifyClient.createRefund(args);
            if (result.data.refundCreate.userErrors.length > 0) {
                return {
                    content: [{
                            type: 'text',
                            text: `Error creating refund: ${JSON.stringify(result.data.refundCreate.userErrors)}`,
                        }],
                    isError: true,
                };
            }
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result.data.refundCreate.refund, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error creating refund: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    // Gift Card Tools
    server.tool('listGiftCards', 'List gift cards', {
        limit: z.number().optional().default(10),
        cursor: z.string().optional(),
        query: z.string().optional()
    }, async (args) => {
        try {
            const result = await shopifyClient.getGiftCards(args);
            const giftCards = result.data.giftCards.edges.map((edge) => edge.node);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            giftCards,
                            pageInfo: result.data.giftCards.pageInfo,
                        }, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error fetching gift cards: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    server.tool('createGiftCard', 'Create a gift card', {
        initialValue: z.string().describe('The initial value (e.g., "100.00")'),
        code: z.string().optional(),
        note: z.string().optional(),
        expiresOn: z.string().optional(),
        recipientEmail: z.string().optional(),
        recipientMessage: z.string().optional()
    }, async (args) => {
        try {
            const result = await shopifyClient.createGiftCard(args);
            if (result.data.giftCardCreate.userErrors.length > 0) {
                return {
                    content: [{
                            type: 'text',
                            text: `Error creating gift card: ${JSON.stringify(result.data.giftCardCreate.userErrors)}`,
                        }],
                    isError: true,
                };
            }
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result.data.giftCardCreate.giftCard, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error creating gift card: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    // Content & Marketing Tools
    server.tool('listPages', 'List store pages', {
        limit: z.number().optional().default(10),
        cursor: z.string().optional()
    }, async (args) => {
        try {
            const result = await shopifyClient.getPages(args);
            const pages = result.data.pages.edges.map((edge) => edge.node);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            pages,
                            pageInfo: result.data.pages.pageInfo,
                        }, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error fetching pages: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    server.tool('createPage', 'Create a new page', {
        title: z.string(),
        content: z.string(),
        handle: z.string().optional(),
        published: z.boolean().optional().default(true),
        metafields: z.array(z.object({
            namespace: z.string(),
            key: z.string(),
            value: z.string(),
            type: z.string()
        })).optional()
    }, async (args) => {
        try {
            const result = await shopifyClient.createPage(args);
            if (result.data.pageCreate.userErrors.length > 0) {
                return {
                    content: [{
                            type: 'text',
                            text: `Error creating page: ${JSON.stringify(result.data.pageCreate.userErrors)}`,
                        }],
                    isError: true,
                };
            }
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result.data.pageCreate.page, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error creating page: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    server.tool('listBlogs', 'List blogs', {
        limit: z.number().optional().default(10),
        cursor: z.string().optional()
    }, async (args) => {
        try {
            const result = await shopifyClient.getBlogs(args);
            const blogs = result.data.blogs.edges.map((edge) => edge.node);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            blogs,
                            pageInfo: result.data.blogs.pageInfo,
                        }, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error fetching blogs: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    server.tool('createArticle', 'Create a blog article', {
        blogId: z.string().describe('The blog ID'),
        title: z.string(),
        content: z.string(),
        summary: z.string().optional(),
        tags: z.array(z.string()).optional(),
        published: z.boolean().optional().default(true),
        publishedAt: z.string().optional(),
        image: z.object({
            url: z.string(),
            altText: z.string().optional()
        }).optional()
    }, async (args) => {
        try {
            const result = await shopifyClient.createArticle(args);
            if (result.data.articleCreate.userErrors.length > 0) {
                return {
                    content: [{
                            type: 'text',
                            text: `Error creating article: ${JSON.stringify(result.data.articleCreate.userErrors)}`,
                        }],
                    isError: true,
                };
            }
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result.data.articleCreate.article, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error creating article: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    server.tool('createRedirect', 'Create a URL redirect', {
        path: z.string().describe('The old path to redirect from'),
        target: z.string().describe('The new path or URL to redirect to')
    }, async (args) => {
        try {
            const result = await shopifyClient.createRedirect(args);
            if (result.data.urlRedirectCreate.userErrors.length > 0) {
                return {
                    content: [{
                            type: 'text',
                            text: `Error creating redirect: ${JSON.stringify(result.data.urlRedirectCreate.userErrors)}`,
                        }],
                    isError: true,
                };
            }
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result.data.urlRedirectCreate.urlRedirect, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error creating redirect: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    // Theme Tools
    server.tool('listThemes', 'List installed themes', async () => {
        try {
            const result = await shopifyClient.getThemes();
            const themes = result.data.themes.edges.map((edge) => edge.node);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(themes, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error fetching themes: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    // Webhook Tools
    server.tool('listWebhooks', 'List configured webhooks', {
        limit: z.number().optional().default(10),
        cursor: z.string().optional()
    }, async (args) => {
        try {
            const result = await shopifyClient.getWebhooks(args);
            const webhooks = result.data.webhookSubscriptions.edges.map((edge) => edge.node);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            webhooks,
                            pageInfo: result.data.webhookSubscriptions.pageInfo,
                        }, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error fetching webhooks: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    server.tool('createWebhook', 'Create a webhook subscription', {
        topic: z.string().describe('The webhook topic (e.g., ORDERS_CREATE)'),
        callbackUrl: z.string().describe('The URL to receive webhook notifications'),
        format: z.enum(['JSON', 'XML']).optional().default('JSON'),
        includeFields: z.array(z.string()).optional()
    }, async (args) => {
        try {
            const result = await shopifyClient.createWebhook(args);
            if (result.data.webhookSubscriptionCreate.userErrors.length > 0) {
                return {
                    content: [{
                            type: 'text',
                            text: `Error creating webhook: ${JSON.stringify(result.data.webhookSubscriptionCreate.userErrors)}`,
                        }],
                    isError: true,
                };
            }
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result.data.webhookSubscriptionCreate.webhookSubscription, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error creating webhook: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    // Draft Order Tools
    server.tool('listDraftOrders', 'List draft orders', {
        limit: z.number().optional().default(10),
        cursor: z.string().optional(),
        query: z.string().optional()
    }, async (args) => {
        try {
            const result = await shopifyClient.getDraftOrders(args);
            const draftOrders = result.data.draftOrders.edges.map((edge) => edge.node);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            draftOrders,
                            pageInfo: result.data.draftOrders.pageInfo,
                        }, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error fetching draft orders: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    server.tool('createDraftOrder', 'Create a draft order', {
        lineItems: z.array(z.object({
            variantId: z.string().optional(),
            productId: z.string().optional(),
            quantity: z.number(),
            customAttributes: z.array(z.object({
                key: z.string(),
                value: z.string()
            })).optional()
        })),
        customerId: z.string().optional(),
        email: z.string().optional(),
        note: z.string().optional(),
        tags: z.array(z.string()).optional(),
        shippingAddress: z.object({
            address1: z.string(),
            address2: z.string().optional(),
            city: z.string(),
            provinceCode: z.string().optional(),
            countryCode: z.string(),
            zip: z.string()
        }).optional(),
        billingAddress: z.object({
            address1: z.string(),
            address2: z.string().optional(),
            city: z.string(),
            provinceCode: z.string().optional(),
            countryCode: z.string(),
            zip: z.string()
        }).optional()
    }, async (args) => {
        try {
            const result = await shopifyClient.createDraftOrder(args);
            if (result.data.draftOrderCreate.userErrors.length > 0) {
                return {
                    content: [{
                            type: 'text',
                            text: `Error creating draft order: ${JSON.stringify(result.data.draftOrderCreate.userErrors)}`,
                        }],
                    isError: true,
                };
            }
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result.data.draftOrderCreate.draftOrder, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error creating draft order: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    // Metaobject Tools (GraphQL exclusive)
    server.tool('listMetaobjectDefinitions', 'List all metaobject type definitions configured in the store. Use this to discover valid `type` values (e.g. `shopify--color-pattern`, `product.material`) before calling listMetaobjects. Returns id/type/name/description + field schema per definition.', {
        limit: z.number().optional().default(25),
        cursor: z.string().optional()
    }, async (args) => {
        try {
            const result = await shopifyClient.getMetaobjectDefinitions(args);
            const definitions = result.data.metaobjectDefinitions.edges.map((edge) => edge.node);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            definitions,
                            pageInfo: result.data.metaobjectDefinitions.pageInfo,
                        }, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error fetching metaobject definitions: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    server.tool('listMetaobjects', 'List metaobjects of a given type. The `type` arg must match a definition exactly (case-sensitive identifier like `shopify--color-pattern`). Run listMetaobjectDefinitions first to discover what types exist in this store. Non-existent type → empty result, not error.', {
        type: z.string().describe('The metaobject type (exact case-sensitive identifier)'),
        limit: z.number().optional().default(10),
        cursor: z.string().optional()
    }, async (args) => {
        try {
            const result = await shopifyClient.getMetaobjects(args);
            const metaobjects = result.data.metaobjects.edges.map((edge) => edge.node);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            metaobjects,
                            pageInfo: result.data.metaobjects.pageInfo,
                        }, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error fetching metaobjects: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    server.tool('createMetaobject', 'Create a metaobject', {
        type: z.string().describe('The metaobject type'),
        fields: z.array(z.object({
            key: z.string(),
            value: z.string()
        }))
    }, async (args) => {
        try {
            const result = await shopifyClient.createMetaobject(args);
            if (result.data.metaobjectCreate.userErrors.length > 0) {
                return {
                    content: [{
                            type: 'text',
                            text: `Error creating metaobject: ${JSON.stringify(result.data.metaobjectCreate.userErrors)}`,
                        }],
                    isError: true,
                };
            }
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result.data.metaobjectCreate.metaobject, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error creating metaobject: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    // Markets & Internationalization Tools
    server.tool('listMarkets', 'List configured markets', {
        limit: z.number().optional().default(10)
    }, async (args) => {
        try {
            const result = await shopifyClient.getMarkets(args);
            const markets = result.data.markets.edges.map((edge) => edge.node);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(markets, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error fetching markets: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    // Price Rules Tools
    server.tool('listPriceRules', 'List discounts (covers code, automatic, BxGy, free-shipping). Replaces deprecated priceRules query with discountNodes in 2026-04+.', {
        limit: z.number().optional().default(10),
        cursor: z.string().optional()
    }, async (args) => {
        try {
            const result = await shopifyClient.getPriceRules(args);
            const discounts = result.data.discountNodes.edges.map((edge) => ({
                id: edge.node.id,
                type: edge.node.discount?.__typename,
                ...edge.node.discount,
            }));
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            discounts,
                            pageInfo: result.data.discountNodes.pageInfo,
                        }, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error fetching price rules: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    // Abandoned Checkout Tools
    server.tool('listAbandonedCheckouts', 'List abandoned checkouts', {
        limit: z.number().optional().default(10),
        cursor: z.string().optional(),
        query: z.string().optional()
    }, async (args) => {
        try {
            const result = await shopifyClient.getAbandonedCheckouts(args);
            const checkouts = result.data.abandonedCheckouts.edges.map((edge) => edge.node);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            checkouts,
                            pageInfo: result.data.abandonedCheckouts.pageInfo,
                        }, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error fetching abandoned checkouts: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    // Reports & Analytics Tools
    server.tool('runShopifyQL', 'Run an arbitrary ShopifyQL analytics query against the store. Same data as Admin → Analytics. Canonical clause order: FROM → SHOW → WHERE → SINCE/UNTIL/DURING → GROUP BY → ORDER BY → LIMIT. Dates are BARE (no quotes): `SINCE 2026-01-01 UNTIL today` or relative `SINCE -30d UNTIL today`. Use `GROUP BY` (full keyword), not `BY`. Dimensions in SHOW must also appear in GROUP BY. Verified datasets: `sales` (metrics: total_sales, gross_sales, net_sales, orders, average_order_value; dims: product_title, billing_country, customer_type), `sessions` (metrics: sessions, online_store_visitors, conversion_rate; dims: referrer_source, utm_source, utm_medium, referrer_host). Note: `orders` and `products` are NOT valid ShopifyQL datasets — use GraphQL tools instead. Returns { parseErrors: [String], tableData: { columns: [{name,dataType,displayName}], rows: JSON } }. parseErrors is non-empty when the query is syntactically/semantically invalid — read it for the exact field/dataset name issue.', {
        query: z.string().describe('Raw ShopifyQL query string')
    }, async (args) => {
        try {
            const result = await shopifyClient.runShopifyQL(args.query);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result.data, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error running ShopifyQL: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    server.tool('getSalesReport', 'Sales analytics via ShopifyQL. Default columns: total_sales, gross_sales, net_sales, total_orders, average_order_value over the date range. Pass `query` to override with raw ShopifyQL.', {
        startDate: z.string().describe('Start date (YYYY-MM-DD)'),
        endDate: z.string().describe('End date (YYYY-MM-DD)'),
        granularity: z.enum(['HOUR', 'DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR']).optional().default('DAY'),
        query: z.string().optional().describe('Optional raw ShopifyQL query to override the default')
    }, async (args) => {
        try {
            const result = await shopifyClient.getSalesReport(args);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result.data, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error fetching sales report: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    server.tool('getProductAnalytics', 'Get product performance analytics', {
        startDate: z.string().describe('Start date (YYYY-MM-DD)'),
        endDate: z.string().describe('End date (YYYY-MM-DD)'),
        productIds: z.array(z.string()).optional(),
        limit: z.number().optional().default(50),
        sortBy: z.enum(['TOTAL_SALES', 'UNITS_SOLD', 'CONVERSION_RATE', 'PAGE_VIEWS']).optional().default('TOTAL_SALES')
    }, async (args) => {
        try {
            const result = await shopifyClient.getProductAnalytics(args);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result.data, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error fetching product analytics: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    server.tool('getCustomerAnalytics', 'Get customer behavior analytics', {
        startDate: z.string().describe('Start date (YYYY-MM-DD)'),
        endDate: z.string().describe('End date (YYYY-MM-DD)'),
        metrics: z.array(z.enum([
            'NEW_CUSTOMERS',
            'RETURNING_CUSTOMERS',
            'AVERAGE_ORDER_VALUE',
            'LIFETIME_VALUE',
            'CHURN_RATE',
            'RETENTION_RATE'
        ])).optional()
    }, async (args) => {
        try {
            const result = await shopifyClient.getCustomerAnalytics(args);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result.data, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error fetching customer analytics: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    server.tool('getInventoryReport', 'Get inventory analytics and forecasting', {
        locationIds: z.array(z.string()).optional(),
        productIds: z.array(z.string()).optional(),
        includeForecasting: z.boolean().optional().default(true),
        forecastDays: z.number().optional().default(30)
    }, async (args) => {
        try {
            const result = await shopifyClient.getInventoryReport(args);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result.data, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error fetching inventory report: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    server.tool('getMarketingReport', 'Get marketing campaign performance', {
        startDate: z.string().describe('Start date (YYYY-MM-DD)'),
        endDate: z.string().describe('End date (YYYY-MM-DD)'),
        channels: z.array(z.enum(['EMAIL', 'SOCIAL', 'SEARCH', 'DIRECT', 'REFERRAL'])).optional(),
        campaignIds: z.array(z.string()).optional()
    }, async (args) => {
        try {
            const result = await shopifyClient.getMarketingReport(args);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result.data, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error fetching marketing report: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    server.tool('getFinancialSummary', 'Get financial summary including revenue, expenses, and profit', {
        startDate: z.string().describe('Start date (YYYY-MM-DD)'),
        endDate: z.string().describe('End date (YYYY-MM-DD)'),
        includeRefunds: z.boolean().optional().default(true),
        includeTaxes: z.boolean().optional().default(true),
        includeShipping: z.boolean().optional().default(true),
        groupBy: z.enum(['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR']).optional().default('MONTH')
    }, async (args) => {
        try {
            const result = await shopifyClient.getFinancialSummary(args);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result.data, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error fetching financial summary: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    server.tool('getConversionReport', 'Product performance via ShopifyQL. Default: top 25 products by total_sales over date range. Pass `query` to override with raw ShopifyQL (e.g. session/conversion-funnel queries).', {
        startDate: z.string().describe('Start date (YYYY-MM-DD)'),
        endDate: z.string().describe('End date (YYYY-MM-DD)'),
        query: z.string().optional().describe('Optional raw ShopifyQL query to override the default')
    }, async (args) => {
        try {
            const result = await shopifyClient.getConversionReport(args);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result.data, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error fetching conversion report: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    server.tool('getAbandonmentReport', 'Get cart and checkout abandonment analytics', {
        startDate: z.string().describe('Start date (YYYY-MM-DD)'),
        endDate: z.string().describe('End date (YYYY-MM-DD)'),
        groupBy: z.enum(['HOUR_OF_DAY', 'DAY_OF_WEEK', 'DEVICE_TYPE', 'TRAFFIC_SOURCE']).optional()
    }, async (args) => {
        try {
            const result = await shopifyClient.getAbandonmentReport(args);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result.data, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error fetching abandonment report: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    server.tool('getTrafficReport', 'Orders grouped by traffic source via ShopifyQL. Default: total_sales/orders/AOV by referrer_source. Pass `query` to override.', {
        startDate: z.string().describe('Start date (YYYY-MM-DD)'),
        endDate: z.string().describe('End date (YYYY-MM-DD)'),
        query: z.string().optional().describe('Optional raw ShopifyQL query to override the default')
    }, async (args) => {
        try {
            const result = await shopifyClient.getTrafficReport(args);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result.data, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error fetching traffic report: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    server.tool('getCustomReport', 'Alias for runShopifyQL — pass a raw ShopifyQL string in `query`. See runShopifyQL description for syntax.', {
        query: z.string().describe('Raw ShopifyQL query — bare dates, GROUP BY full keyword, verified datasets only')
    }, async (args) => {
        try {
            const result = await shopifyClient.getCustomReport(args);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result.data, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error fetching custom report: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    // B2B Tools
    server.tool('listCompanies', 'List B2B companies', {
        limit: z.number().optional().default(10),
        cursor: z.string().optional()
    }, async (args) => {
        try {
            const result = await shopifyClient.getCompanies(args);
            const companies = result.data.companies.edges.map((edge) => edge.node);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            companies,
                            pageInfo: result.data.companies.pageInfo,
                        }, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error fetching companies: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
    server.tool('createCompany', 'Create a B2B company', {
        name: z.string(),
        externalId: z.string().optional(),
        note: z.string().optional(),
        contactEmail: z.string().optional(),
        contactPhone: z.string().optional()
    }, async (args) => {
        try {
            const result = await shopifyClient.createCompany(args);
            if (result.data.companyCreate.userErrors.length > 0) {
                return {
                    content: [{
                            type: 'text',
                            text: `Error creating company: ${JSON.stringify(result.data.companyCreate.userErrors)}`,
                        }],
                    isError: true,
                };
            }
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(result.data.companyCreate.company, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error creating company: ${error.message}`,
                    }],
                isError: true,
            };
        }
    });
}
// Register resources
function registerResources(server) {
    // Resources
    server.resource('products', 'Browse product catalog', async () => {
        try {
            const result = await shopifyClient.getProducts({ limit: 50 });
            const products = result.data.products.edges.map((edge) => edge.node);
            return {
                contents: [{
                        uri: 'shopify://products',
                        mimeType: 'application/json',
                        text: JSON.stringify(products, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                contents: [{
                        uri: 'shopify://products',
                        mimeType: 'text/plain',
                        text: `Error loading products: ${error.message}`,
                    }],
            };
        }
    });
    server.resource('orders', 'Browse recent orders', async () => {
        try {
            const result = await shopifyClient.getOrders({ limit: 50 });
            const orders = result.data.orders.edges.map((edge) => edge.node);
            return {
                contents: [{
                        uri: 'shopify://orders',
                        mimeType: 'application/json',
                        text: JSON.stringify(orders, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                contents: [{
                        uri: 'shopify://orders',
                        mimeType: 'text/plain',
                        text: `Error loading orders: ${error.message}`,
                    }],
            };
        }
    });
}
// Register prompts
function registerPrompts(server) {
    // Prompts
    server.prompt('analyze-sales', 'Analyze sales trends and patterns', async () => {
        return {
            messages: [{
                    role: 'user',
                    content: {
                        type: 'text',
                        text: 'Please analyze the sales trends for the last 30 days. Look at order volumes, revenue trends, popular products, and customer patterns. Use the listOrders tool with appropriate date filters and the listProducts tool to gather data.',
                    },
                }],
        };
    });
    server.prompt('inventory-check', 'Check for low inventory items', async () => {
        return {
            messages: [{
                    role: 'user',
                    content: {
                        type: 'text',
                        text: 'Please check for products with low inventory levels. Use the listProducts tool to get all products and identify items with inventory below 10 units. Provide a summary of products that need restocking.',
                    },
                }],
        };
    });
    server.prompt('customer-insights', 'Generate customer insights', async () => {
        return {
            messages: [{
                    role: 'user',
                    content: {
                        type: 'text',
                        text: 'Please analyze customer data to provide insights. Use the listCustomers tool to identify top customers by order count and spending. Look for patterns in customer locations and order frequency.',
                    },
                }],
        };
    });
}
// Start the server
async function main() {
    const transportMode = process.env.TRANSPORT_MODE || 'stdio';
    if (transportMode === 'sse') {
        // SSE mode - run as HTTP server
        const port = parseInt(process.env.PORT || '3000', 10);
        const app = express();
        app.use(express.json());
        // Store active transports by session ID
        const transports = new Map();
        // Health check endpoint
        app.get('/health', (_req, res) => {
            res.json({ status: 'ok', mode: 'sse' });
        });
        // SSE endpoint for establishing the stream
        app.get('/sse', async (_req, res) => {
            console.log('New SSE connection established');
            try {
                // Create a new SSE transport
                const transport = new SSEServerTransport('/messages', res);
                const sessionId = transport.sessionId;
                // Store the transport
                transports.set(sessionId, transport);
                // Set up cleanup on close
                transport.onclose = () => {
                    console.log(`SSE connection closed: ${sessionId}`);
                    transports.delete(sessionId);
                };
                // Create a new server instance for this connection
                const mcpServer = createMcpServer();
                // Connect the transport to the server
                await mcpServer.connect(transport);
                // Start the SSE stream
                await transport.start();
            }
            catch (error) {
                console.error('Error establishing SSE connection:', error);
                if (!res.headersSent) {
                    res.writeHead(500);
                    res.end('Error establishing SSE connection');
                }
            }
        });
        // Messages endpoint for receiving client messages
        app.post('/messages', async (req, res) => {
            const sessionId = req.query.sessionId;
            if (!sessionId) {
                res.status(400).send('Missing sessionId parameter');
                return;
            }
            const transport = transports.get(sessionId);
            if (!transport) {
                res.status(404).send('Session not found');
                return;
            }
            try {
                await transport.handlePostMessage(req, res, req.body);
            }
            catch (error) {
                console.error('Error handling message:', error);
                if (!res.headersSent) {
                    res.status(500).send('Error handling message');
                }
            }
        });
        // Start the HTTP server
        app.listen(port, () => {
            console.log(`Shopify MCP Server (SSE mode) listening on port ${port}`);
            console.log(`SSE endpoint: http://localhost:${port}/sse`);
        });
        // Graceful shutdown
        process.on('SIGINT', () => {
            console.log('Shutting down SSE server...');
            transports.forEach(transport => transport.close());
            process.exit(0);
        });
    }
    else {
        // Stdio mode - original implementation
        process.stdout.on('error', () => { });
        process.stderr.on('error', () => { });
        process.on('uncaughtException', (error) => {
            if (error.message && error.message.includes('JSON')) {
                return;
            }
            process.stderr.write(`[Uncaught Exception]: ${error.message}\n`);
            process.exit(1);
        });
        process.on('unhandledRejection', (reason) => {
            process.stderr.write(`[Unhandled Rejection]: ${reason}\n`);
        });
        const transport = new StdioServerTransport();
        transport.onerror = () => { };
        const shutdown = async () => {
            try {
                await server.close();
            }
            catch (error) {
                // Silent shutdown
            }
            process.exit(0);
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
        try {
            await server.connect(transport);
            setTimeout(() => {
                process.stderr.write('Shopify MCP Server started successfully\n');
            }, 100);
        }
        catch (error) {
            process.stderr.write(`Failed to start server: ${error.message}\n`);
            process.exit(1);
        }
    }
}
// Create MCP server instance - moved to separate function for SSE mode
function createMcpServer() {
    const mcpServer = new McpServer({
        name: 'shopify-mcp-server',
        version: '1.0.0',
    });
    // Register all tools and resources on the new instance
    registerTools(mcpServer);
    registerResources(mcpServer);
    registerPrompts(mcpServer);
    return mcpServer;
}
// Move server creation for stdio mode
const server = createMcpServer();
main();
//# sourceMappingURL=index.js.map