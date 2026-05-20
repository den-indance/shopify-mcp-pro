import { z } from 'zod';
export const ProductQuerySchema = z.object({
    limit: z.number().optional().default(10),
    cursor: z.string().optional(),
    query: z.string().optional(),
    sortKey: z.enum(['TITLE', 'PRODUCT_TYPE', 'VENDOR', 'CREATED_AT', 'UPDATED_AT']).optional(),
    reverse: z.boolean().optional().default(false)
});
export const OrderQuerySchema = z.object({
    limit: z.number().optional().default(10),
    cursor: z.string().optional(),
    query: z.string().optional(),
    status: z.enum(['open', 'closed', 'cancelled', 'any']).optional(),
    financialStatus: z.enum(['paid', 'pending', 'refunded', 'partially_refunded', 'any']).optional(),
    fulfillmentStatus: z.enum(['shipped', 'partial', 'unshipped', 'any']).optional()
});
export const CustomerQuerySchema = z.object({
    limit: z.number().optional().default(10),
    cursor: z.string().optional(),
    query: z.string().optional(),
    sortKey: z.enum(['NAME', 'CREATED_AT', 'UPDATED_AT', 'TOTAL_SPENT']).optional(),
    reverse: z.boolean().optional().default(false)
});
export const InventoryUpdateSchema = z.object({
    inventoryItemId: z.string(),
    locationId: z.string(),
    quantity: z.number()
});
export const MetafieldSchema = z.object({
    namespace: z.string(),
    key: z.string(),
    value: z.string(),
    type: z.string().optional().default('single_line_text_field')
});
export const WebhookCreateSchema = z.object({
    topic: z.string(),
    address: z.string().url(),
    format: z.enum(['json', 'xml']).optional().default('json')
});
//# sourceMappingURL=types.js.map