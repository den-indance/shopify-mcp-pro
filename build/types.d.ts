import { z } from 'zod';
export declare const ProductQuerySchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    cursor: z.ZodOptional<z.ZodString>;
    query: z.ZodOptional<z.ZodString>;
    sortKey: z.ZodOptional<z.ZodEnum<["TITLE", "PRODUCT_TYPE", "VENDOR", "CREATED_AT", "UPDATED_AT"]>>;
    reverse: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    reverse: boolean;
    cursor?: string | undefined;
    query?: string | undefined;
    sortKey?: "TITLE" | "PRODUCT_TYPE" | "VENDOR" | "CREATED_AT" | "UPDATED_AT" | undefined;
}, {
    limit?: number | undefined;
    cursor?: string | undefined;
    query?: string | undefined;
    sortKey?: "TITLE" | "PRODUCT_TYPE" | "VENDOR" | "CREATED_AT" | "UPDATED_AT" | undefined;
    reverse?: boolean | undefined;
}>;
export declare const OrderQuerySchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    cursor: z.ZodOptional<z.ZodString>;
    query: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<["open", "closed", "cancelled", "any"]>>;
    financialStatus: z.ZodOptional<z.ZodEnum<["paid", "pending", "refunded", "partially_refunded", "any"]>>;
    fulfillmentStatus: z.ZodOptional<z.ZodEnum<["shipped", "partial", "unshipped", "any"]>>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    cursor?: string | undefined;
    query?: string | undefined;
    status?: "open" | "closed" | "cancelled" | "any" | undefined;
    financialStatus?: "any" | "paid" | "pending" | "refunded" | "partially_refunded" | undefined;
    fulfillmentStatus?: "any" | "shipped" | "partial" | "unshipped" | undefined;
}, {
    limit?: number | undefined;
    cursor?: string | undefined;
    query?: string | undefined;
    status?: "open" | "closed" | "cancelled" | "any" | undefined;
    financialStatus?: "any" | "paid" | "pending" | "refunded" | "partially_refunded" | undefined;
    fulfillmentStatus?: "any" | "shipped" | "partial" | "unshipped" | undefined;
}>;
export declare const CustomerQuerySchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    cursor: z.ZodOptional<z.ZodString>;
    query: z.ZodOptional<z.ZodString>;
    sortKey: z.ZodOptional<z.ZodEnum<["NAME", "CREATED_AT", "UPDATED_AT", "TOTAL_SPENT"]>>;
    reverse: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    reverse: boolean;
    cursor?: string | undefined;
    query?: string | undefined;
    sortKey?: "CREATED_AT" | "UPDATED_AT" | "NAME" | "TOTAL_SPENT" | undefined;
}, {
    limit?: number | undefined;
    cursor?: string | undefined;
    query?: string | undefined;
    sortKey?: "CREATED_AT" | "UPDATED_AT" | "NAME" | "TOTAL_SPENT" | undefined;
    reverse?: boolean | undefined;
}>;
export declare const InventoryUpdateSchema: z.ZodObject<{
    inventoryItemId: z.ZodString;
    locationId: z.ZodString;
    quantity: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    inventoryItemId: string;
    locationId: string;
    quantity: number;
}, {
    inventoryItemId: string;
    locationId: string;
    quantity: number;
}>;
export declare const MetafieldSchema: z.ZodObject<{
    namespace: z.ZodString;
    key: z.ZodString;
    value: z.ZodString;
    type: z.ZodDefault<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    value: string;
    type: string;
    namespace: string;
    key: string;
}, {
    value: string;
    namespace: string;
    key: string;
    type?: string | undefined;
}>;
export declare const WebhookCreateSchema: z.ZodObject<{
    topic: z.ZodString;
    address: z.ZodString;
    format: z.ZodDefault<z.ZodOptional<z.ZodEnum<["json", "xml"]>>>;
}, "strip", z.ZodTypeAny, {
    topic: string;
    address: string;
    format: "json" | "xml";
}, {
    topic: string;
    address: string;
    format?: "json" | "xml" | undefined;
}>;
export interface ShopifyConfig {
    storeDomain: string;
    accessToken: string;
    apiVersion?: string;
}
export interface GraphQLResponse<T> {
    data: T;
    errors?: Array<{
        message: string;
        extensions?: Record<string, unknown>;
    }>;
}
export interface PageInfo {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
}
export interface UserError {
    field: string[] | null;
    message: string;
}
//# sourceMappingURL=types.d.ts.map