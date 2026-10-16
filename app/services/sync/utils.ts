import { Client } from "@notionhq/client";
export * from "./types";
import prisma from "../../db.server";
import { Product, Variant, Order, Customer, Image, Collection } from "@prisma/client";
import { CollectionProperty, CustomerProps, NotionProperties, OrderProps, ProductProps, VariantProps } from "./types";

export const cleanGid = (gid: string | null | undefined): number => {
    if (!gid) return 0;
    const str = String(gid).split('/').pop() || gid;
    return Number(str);
};

export const buildAppUrl = (path: string): string => {
    const baseUrl = process.env.SHOPIFY_APP_URL || "";
    const cleanBase = baseUrl.replace(/\/+$/, "");
    const cleanPath = path.replace(/^\/+/, "");
    return `${cleanBase}/${cleanPath}`;
};

let lastNotionRequestTime = 0;
export const rateLimitNotion = async () => {
    const now = Date.now();
    const timeSinceLast = now - lastNotionRequestTime;
    if (timeSinceLast < 334) {
        await new Promise(resolve => setTimeout(resolve, 334 - timeSinceLast));
    }
    lastNotionRequestTime = Date.now();
};

export const NOTION_SCHEMAS = {
    Products: {
        "ID": { number: {} },
        "Handle": { rich_text: {} },
        "URL": { url: {} },
        "Image": { files: {} },
        "Description": { rich_text: {} },
        "Vendor": { rich_text: {} },
        "Product Type": { rich_text: {} },
        "Tags": { multi_select: {} },
        "Min Price": { number: { format: "dollar" } },
        "Max Price": { number: { format: "dollar" } },
        "Total Inventory": { number: {} },
        "Tracks Inventory": { checkbox: {} },
        "Has Only Default Variant": { checkbox: {} },
        "SEO Title": { rich_text: {} },
        "SEO Description": { rich_text: {} },
        "Published At": { date: {} },
        "Created At": { date: {} },
        "Updated At": { date: {} },
        "Collections": { relation: {} }
    },
    Variants: {
        "Price": { number: { format: "dollar" } },
        "Compare At Price": { number: { format: "dollar" } },
        "SKU": { rich_text: {} },
        "Barcode": { rich_text: {} },
        "Weight": { number: {} },
        "Weight Unit": { select: {} },
        "Taxable": { checkbox: {} },
        "Inventory": { number: {} },
        "ID": { number: {} },
        "Product": {
            relation: {}
        }
    },
    Collections: {
        "ID": { number: {} },
        "Handle": { rich_text: {} },
        "URL": { url: {} }
    },
    Orders: {
        "Price": { number: { format: "dollar" } },
        "Customer Name": { rich_text: {} },
        "Financial Status": { select: {} },
        "Fulfillment Status": {
            select: {
                options: [
                    { name: "Unfulfilled", color: "yellow" },
                    { name: "In progress", color: "blue" },
                    { name: "On hold", color: "orange" },
                    { name: "Scheduled", color: "purple" },
                    { name: "Partially fulfilled", color: "yellow" },
                    { name: "Fulfilled", color: "green" },
                    { name: "Fulfillment not required", color: "gray" }
                ]
            }
        },
        "Order Status": {
            multi_select: {
                options: [
                    { name: "Open", color: "blue" },
                    { name: "Archived", color: "gray" },
                    { name: "Canceled", color: "red" }
                ]
            }
        },
        "Return Status": {
            select: {
                options: [
                    { name: "Return requested", color: "yellow" },
                    { name: "Return in progress", color: "blue" },
                    { name: "Returned", color: "green" },
                    { name: "Inspection complete", color: "purple" }
                ]
            }
        },
        "Tags": { multi_select: {} },
        "Note": { rich_text: {} },
        "ID": { number: {} },
        "Discount Codes": { rich_text: {} },
        "Discount Values": { rich_text: {} },
        "Total Refunded": { number: { format: "dollar" } },
        "Refund Notes": { rich_text: {} },
        "Tracking Company": { rich_text: {} },
        "Tracking Number": { rich_text: {} },
        "Tracking URL": { url: {} },
        "Created At": { date: {} },
        "Updated At": { date: {} },
        "Cancelled At": { date: {} },
    },
    Customers: {
        "Email": { email: {} },
        "Phone": { phone_number: {} },
        "Tags": { multi_select: {} },
        "Total Orders": { number: {} },
        "Total Spent": { number: { format: "dollar" } },
        "ID": { number: {} }
    }
} as const;

export const getNotionIdByShopifyId = async (client: Client, dbId: string, shopifyId: number) => {
    if (!dbId || !shopifyId) return null;
    try {
        const queryRes = await client.dataSources.query({
            data_source_id: dbId,
            filter: { property: "ID", number: { equals: shopifyId } }
        });
        if (queryRes.results && queryRes.results.length > 0) {
            if (queryRes.results.length > 1) {
                // 2. We have duplicates. Slice off the first one to keep it, archive the rest.
                await Promise.all(queryRes.results.slice(1).map(async (result) => {
                    await client.pages.update({
                        page_id: result.id,
                        in_trash: true
                    });
                }));
            }
            return queryRes.results[0].id;
        }
    } catch (e) {
        console.error(`Error fetching Notion ID by Shopify ID: ${shopifyId}`, e);
    }
    return null;
};

export const getNotionOrdersByCustomerId = async (
    client: Client,
    ordersDbId: string,
    shopifyCustomerId: number
) => {
    const orderPageIds: string[] = [];
    if (!ordersDbId || !shopifyCustomerId) return orderPageIds;

    let hasMore = true;
    let nextCursor: string | undefined = undefined;

    while (hasMore) {
        try {
            // Assuming rateLimitNotion() is defined in your file
            await rateLimitNotion();

            const res = await client.dataSources.query({
                data_source_id: ordersDbId,
                start_cursor: nextCursor,
                page_size: 100,
                filter: {
                    // IMPORTANT: Change "Customer_ID" to whatever you named the Number 
                    // property in your Orders database that stores the Shopify Customer ID.
                    // If you literally named the field "ID", change this to "ID".
                    property: "Customer_ID",
                    number: { equals: shopifyCustomerId }
                }
            });

            // Extract and store the Notion Page IDs for the matching orders
            for (const page of res.results) {
                orderPageIds.push(page.id);
            }

            hasMore = res.has_more;
            nextCursor = res.next_cursor || undefined;
        } catch (e) {
            console.error(`Failed to fetch orders for customer ${shopifyCustomerId}`, e);
            hasMore = false;
        }
    }

    return orderPageIds; // Returns an array of Notion Page UUIDs
};

export const fetchAllNotionItems = async (client: Client, dbId: string, label: string) => {
    const mapping = new Map<string, { id: string, properties: any }>();
    if (!dbId) return mapping;

    let hasMore = true;
    let nextCursor: string | undefined = undefined;
    while (hasMore) {
        try {
            const res = await client.dataSources.query({
                data_source_id: dbId,
                start_cursor: nextCursor,
                page_size: 100
            });
            for (const page of res.results) {
                const props = "properties" in page ? (page.properties as Record<string, any>) : {};
                const shopifyId = props["ID"]?.rich_text?.[0]?.plain_text;
                if (shopifyId) {
                    mapping.set(shopifyId, { id: page.id, properties: props });
                }
            }
            hasMore = res.has_more;
            nextCursor = res.next_cursor || undefined;
        } catch (e) {
            console.error(`Bulk fetch failed for ${label} db`, dbId, e);
            break;
        }
    }
    return mapping;
};

export const getNotionCollectionsMap = async (client: Client, collectionsDbId: string) => {
    const mapping: Record<string, string> = {};
    if (!collectionsDbId) return mapping;

    let hasMore = true;
    let nextCursor: string | undefined = undefined;
    while (hasMore) {
        try {
            await rateLimitNotion();
            const res = await client.dataSources.query({
                data_source_id: collectionsDbId,
                start_cursor: nextCursor,
                page_size: 100
            });
            for (const page of res.results) {
                const props = "properties" in page ? (page.properties as any) : {};
                const shopifyId = props["ID"]?.number;
                if (shopifyId) {
                    mapping[shopifyId] = page.id;
                }
            }
            hasMore = res.has_more;
            nextCursor = res.next_cursor || undefined;
        } catch (e) {
            console.error(`Bulk fetch failed for Collections Map`, e);
            hasMore = false;
        }
    }
    return mapping;
};
export const getNotionCustomersMap = async (client: Client, customersDbId: string) => {
    const mapping: Record<string, string> = {};
    if (!customersDbId) return mapping;

    let hasMore = true;
    let nextCursor: string | undefined = undefined;
    while (hasMore) {
        try {
            await rateLimitNotion();
            const res = await client.dataSources.query({
                data_source_id: customersDbId,
                start_cursor: nextCursor,
                page_size: 100
            });
            for (const page of res.results) {
                const props = "properties" in page ? (page.properties as any) : {};
                const shopifyId = props["ID"]?.number;
                if (shopifyId) {
                    mapping[shopifyId] = page.id;
                }
            }
            hasMore = res.has_more;
            nextCursor = res.next_cursor || undefined;
        } catch (e) {
            console.error(`Bulk fetch failed for Customers Map`, e);
            hasMore = false;
        }
    }
    return mapping;
};
export const getNotionOrdersMap = async (client: Client, ordersDbId: string) => {
    const mapping: Record<string, string> = {};
    if (!ordersDbId) return mapping;

    let hasMore = true;
    let nextCursor: string | undefined = undefined;
    while (hasMore) {
        try {
            await rateLimitNotion();
            const res = await client.dataSources.query({
                data_source_id: ordersDbId,
                start_cursor: nextCursor,
                page_size: 100
            });
            for (const page of res.results) {
                const props = "properties" in page ? (page.properties as any) : {};
                const shopifyId = props["ID"]?.number;
                if (shopifyId) {
                    mapping[shopifyId] = page.id;
                }
            }
            hasMore = res.has_more;
            nextCursor = res.next_cursor || undefined;
        } catch (e) {
            console.error(`Bulk fetch failed for Orders Map`, e);
            hasMore = false;
        }
    }
    return mapping;
};

export const getNotionProductsMap = async (client: Client, productsDbId: string) => {
    const mapping: Record<string, string> = {};
    if (!productsDbId) return mapping;

    let hasMore = true;
    let nextCursor: string | undefined = undefined;
    while (hasMore) {
        try {
            await rateLimitNotion();
            const res = await client.dataSources.query({
                data_source_id: productsDbId,
                start_cursor: nextCursor,
                page_size: 100
            });
            for (const page of res.results) {
                const props = "properties" in page ? (page.properties as any) : {};
                const shopifyId = props["ID"]?.number;
                if (shopifyId) {
                    mapping[shopifyId] = page.id;
                }
            }
            hasMore = res.has_more;
            nextCursor = res.next_cursor || undefined;
        } catch (e) {
            console.error(`Bulk fetch failed for Products Map`, e);
            hasMore = false;
        }
    }
    return mapping;
};

export const clearDataSource = async (client: Client, dataSourceId: string) => {
    if (!dataSourceId) return;
    let hasMore = true;
    let nextCursor: string | undefined = undefined;
    while (hasMore) {
        try {
            await rateLimitNotion();
            const res = await client.dataSources.query({
                data_source_id: dataSourceId,
                start_cursor: nextCursor,
                page_size: 100
            });
            for (const page of res.results) {
                await rateLimitNotion();
                await client.pages.update({ page_id: page.id, in_trash: true }).catch(() => { });
            }
            hasMore = res.has_more;
            nextCursor = res.next_cursor || undefined;
        } catch (e) {
            console.error(`Failed to clear data source ${dataSourceId}`, e);
            hasMore = false;
        }
    }
};

export const syncItem = async (notion: Client, dbId: string, shopifyId: string, properties: NotionProperties, existingPageId?: string) => {
    try {
        await rateLimitNotion();
        if (existingPageId) {
            const res = await notion.pages.update({ page_id: existingPageId, properties });
            return { id: res.id, last_edited_time: "last_edited_time" in res ? res.last_edited_time : undefined };
        }
        const res = await notion.pages.create({ parent: { data_source_id: dbId }, properties });
        return { id: res.id, last_edited_time: "last_edited_time" in res ? res.last_edited_time : undefined };
    } catch (e: any) {
        console.error("syncItem FAILED!");
        console.error("dbId:", dbId);
        console.error("existingPageId:", existingPageId);
        console.error("properties payload:", JSON.stringify(properties, null, 2));
        console.error("Error:", e);
        throw e;
    }
};

export const ensureDb = async (notion: Client, shop: string, config: Record<string, any>, configKey: "notionProductsDbId" | "notionVariantsDbId" | "notionCollectionsDbId" | "notionOrdersDbId" | "notionCustomersDbId", title: string, properties: Record<string, any>) => {
    let cachedId = config[configKey] as string | null;
    if (cachedId) {
        try {
            await rateLimitNotion();
            const db = await notion.dataSources.retrieve({ data_source_id: cachedId });
            const existingProps = "properties" in db ? db.properties : {};

            const updateProps: Record<string, any> = {};
            let hasChanges = false;

            for (const [key, expectedValue] of Object.entries(properties)) {
                if (key === "title") continue;

                let existingProp = existingProps[key];
                let oldNameForRename: string | null = null;

                if (!existingProp && expectedValue.relation) {
                    for (const [eKey, eVal] of Object.entries(existingProps)) {
                        if (eVal.type === "relation") {
                            // Find an auto-generated property that matches our intended name or looks like a backlink
                            if (eKey.toLowerCase().includes(key.toLowerCase()) || eKey.includes("Related to")) {
                                existingProp = eVal;
                                oldNameForRename = eKey;
                                break;
                            }
                        }
                    }
                }

                if (!existingProp) {
                    // Do not attempt to create a relation if we don't have the target DB ID
                    if (expectedValue.relation && !expectedValue.relation.data_source_id && !expectedValue.relation.database_id) {
                        continue;
                    }
                    updateProps[key] = expectedValue;
                    hasChanges = true;
                } else if (oldNameForRename) {
                    updateProps[oldNameForRename] = { name: key };
                    hasChanges = true;
                }
            }

            if (hasChanges) {
                await rateLimitNotion();
                await notion.dataSources.update({ data_source_id: cachedId, properties: updateProps });
            }
            return cachedId;
        } catch (e) {
            console.log(`Failed to update existing DB ${title} (${cachedId}), recreating. Error: ${(e as Error).message}`);
            cachedId = null;
        }
    }

    if (!cachedId) {
        await rateLimitNotion();
        const createProps = { "title": { title: {} }, ...properties };
        const newDb = await notion.databases.create({
            parent: { type: "page_id", page_id: config.notionParentPageId as string },
            title: [{ type: "text", text: { content: title } }],
            initial_data_source: { properties: createProps }
        });
        const dsId = (newDb as { data_sources?: { id: string }[] }).data_sources?.[0]?.id;
        if (!dsId) throw new Error(`Failed to create DB: ${title}`);

        await prisma.storeConfig.update({
            where: { shop },
            data: { [configKey]: dsId }
        });

        const configMap = config as Record<string, unknown>;
        configMap[configKey as string] = dsId;
        return dsId;
    }
    return cachedId;
};

export const prepareNotionProduct = ({
    shop,
    product,
    collectionNotionMap
}: {
    shop: string,
    product: Product & { images?: Image[], variants?: Variant[], collections?: Collection[] },
    collectionNotionMap: Record<string, string>
}): ProductProps => {
    const fullUrl = product.url ? (product.url.startsWith("http") ? product.url : `https://${shop}/products/${product.handle}`) : null;

    let cleanTags: string[] = [];
    if (product.tags?.length) {
        cleanTags = Array.from(new Set(product.tags.flatMap((t: string) => t.split(",")).map((t: string) => t.trim().replace(/,/g, "")).filter(Boolean))).slice(0, 100);
    }

    const props: ProductProps = {
        "title": { title: [{ type: "text", text: { content: product.title || "Untitled" } }] },
        "ID": { number: cleanGid(product.shopifyId) },
        "Min Price": { number: product.minPrice ?? null },
        "Max Price": { number: product.maxPrice ?? null },
        "URL": fullUrl ? { url: fullUrl } : { url: null },
        "Description": { rich_text: [{ type: "text", text: { content: product.description?.substring(0, 2000) || "" } }] },
        "Tags": { multi_select: cleanTags.map(t => ({ name: t })) },
        "Handle": { rich_text: [{ type: "text", text: { content: product.handle || "" } }] },
        "Vendor": { rich_text: [{ type: "text", text: { content: product.vendor || "" } }] },
        "Product Type": { rich_text: [{ type: "text", text: { content: product.productType || "" } }] },
        "Total Inventory": { number: product.totalInventory ?? 0 },
        "Tracks Inventory": { checkbox: product.tracksInventory || false },
        "Has Only Default Variant": { checkbox: product.hasOnlyDefaultVariant || false },
        "SEO Title": { rich_text: [{ type: "text", text: { content: product.seoTitle || "" } }] },
        "SEO Description": { rich_text: [{ type: "text", text: { content: product.seoDescription?.substring(0, 2000) || "" } }] },
        "Published At": product.publishedAt ? { date: { start: new Date(product.publishedAt).toISOString() } } : { date: null },
        "Image": product.images?.[0]?.url ? { files: [{ type: "external", name: "Product Image", external: { url: product.images[0].url } }] } : { files: [] },
        "Created At": product.createdAt ? { date: { start: new Date(product.createdAt).toISOString() } } : { date: null },
        "Updated At": product.updatedAt ? { date: { start: new Date(product.updatedAt).toISOString() } } : { date: null },
        "Collections": { relation: [] }
    };

    let collectionNotionUUIDS: string[] = [];
    if (product.collections && collectionNotionMap) {
        collectionNotionUUIDS = product.collections
            .map(c => collectionNotionMap[String(cleanGid(c.shopifyId))])
            .filter(Boolean) as string[];
    }

    if (collectionNotionUUIDS.length > 0) {
        props["Collections"] = { relation: collectionNotionUUIDS.map((id: string) => ({ id })).slice(0, 100) };
    }

    return props;
};

export const prepareNotionVariant = ({
    variant,
    notionProductId
}: {
    variant: Variant,
    notionProductId?: string | null
}): Partial<VariantProps> => {
    const varProps: Partial<VariantProps> = {
        "title": { title: [{ type: "text", text: { content: variant.title || "Untitled" } }] },
        "ID": { number: cleanGid(variant.shopifyVariantId) },
        "Price": { number: variant.price ?? null },
        "Compare At Price": { number: variant.compareAtPrice ?? null },
        "SKU": { rich_text: [{ type: "text", text: { content: variant.sku || "" } }] },
        "Barcode": { rich_text: [{ type: "text", text: { content: variant.barcode || "" } }] },
        "Inventory": { number: variant.inventory ?? null },
        "Weight": { number: variant.weight ?? null },
        "Weight Unit": variant.weightUnit ? { select: { name: variant.weightUnit } } : { select: null },
        "Taxable": { checkbox: variant.taxable ?? true },
        "Product": { relation: [] }
    };

    if (notionProductId) {
        varProps["Product"] = { relation: [{ id: notionProductId }] };
    }

    return varProps;
};

export const prepareNotionCustomer = async ({
    shop,
    customer,
    ordersDbId,
    ordersMap
}: {
    shop: string,
    customer: Customer,
    ordersDbId?: string | null,
    ordersMap?: Record<string, string>,
}): Promise<Partial<CustomerProps>> => {
    const name = [customer.firstName, customer.lastName].filter(Boolean).join(" ") || "Unnamed Customer";
    const props: Partial<CustomerProps> = {
        "title": { title: [{ text: { content: name } }] },
        "ID": { number: cleanGid(customer.shopifyId) },
        "Email": customer.email ? { email: customer.email } : { email: null },
        "Phone": customer.phone ? { phone_number: customer.phone } : { phone_number: null },
        "Tags": { multi_select: customer.tags && customer.tags.length > 0 ? customer.tags.map((t: string) => ({ name: t })) : [] },
        "Total Orders": { number: customer.ordersCount },
        "Total Spent": { number: customer.totalSpent },
        "Orders": { relation: [] }
    };

    const customerOrders = await prisma.order.findMany({
        where: { shop, customerId: customer.shopifyId }, select: { shopifyId: true }
    });
    const relatedIds: { id: string }[] = [];
    if (ordersDbId) {
        for (const o of customerOrders) {
            let oNotionId = ordersMap?.[o.shopifyId];
            if (oNotionId) relatedIds.push({ id: oNotionId });
        }
    }
    if (relatedIds.length) {
        props["Orders"] = { relation: relatedIds.slice(0, 100) };
    }
    return props;
};

export const prepareNotionOrder = async ({
    order,
    productsDbId,
    variantsDbId,
    customersDbId,
    notionClient
}: {
    order: Order,
    productsDbId: string | null,
    variantsDbId: string | null,
    customersDbId: string | null,
    notionClient: Client
}): Promise<Partial<OrderProps>> => {
    const orderStatuses: { name: string }[] = [];
    if (order.closed) orderStatuses.push({ name: "Archived" });
    if (order.cancelledAt) orderStatuses.push({ name: "Canceled" });
    if (!order.closed && !order.cancelledAt) orderStatuses.push({ name: "Open" });

    const props: OrderProps = {
        "title": { title: [{ text: { content: order.name || "Untitled" } }] },
        "ID": { number: cleanGid(order.shopifyId) },
        "Price": { number: order.totalPrice ?? null },
        "Financial Status": order.financialStatus ? { select: { name: order.financialStatus } } : { select: null },
        "Fulfillment Status": order.fulfillmentStatus ? { select: { name: order.fulfillmentStatus } } : { select: null },
        "Return Status": order.returnStatus ? { select: { name: order.returnStatus } } : { select: null },
        "Order Status": { multi_select: orderStatuses },
        "Tags": { multi_select: Array.isArray(order.tags) && order.tags.length > 0 ? order.tags.map((t: string) => ({ name: t.replace(/,/g, '') })) : [] },
        "Customer Name": { rich_text: [{ text: { content: order.customerName || "" } }] },
        "Note": { rich_text: [{ text: { content: order.note?.substring(0, 2000) || "" } }] },
        "Tracking URL": order.trackingUrls?.[0] ? { url: order.trackingUrls[0] } : { url: null },
        "Discount Codes": { rich_text: [{ text: { content: order.discountCodes?.length ? order.discountCodes.join(", ") : "" } }] },
        "Discount Values": { rich_text: [{ text: { content: order.discountValues?.length ? order.discountValues.join(", ") : "" } }] },
        "Total Refunded": { number: order.totalRefunded ?? null },
        "Refund Notes": { rich_text: [{ text: { content: order.refundNotes?.length ? order.refundNotes.join(" | ") : "" } }] },
        "Tracking Company": { rich_text: [{ text: { content: order.trackingCompanies?.length ? order.trackingCompanies.join(", ") : "" } }] },
        "Tracking Number": { rich_text: [{ text: { content: order.trackingNumbers?.length ? order.trackingNumbers.join(", ") : "" } }] },
        "Created At": order.createdAt ? { date: { start: new Date(order.createdAt).toISOString() } } : { date: null },
        "Updated At": order.updatedAt ? { date: { start: new Date(order.updatedAt).toISOString() } } : { date: null },
        "Cancelled At": order.cancelledAt ? { date: { start: new Date(order.cancelledAt).toISOString() } } : { date: null },
        "Products": { relation: [] },
        "Variants": { relation: [] },
        "Customer": { relation: [] },
    };

    if (order.customerId && customersDbId) {
        let customerNotionId = await getNotionIdByShopifyId(notionClient, customersDbId, cleanGid(order.customerId));
        if (customerNotionId) props["Customer"] = { relation: [{ id: customerNotionId }] };
    }

    const relatedIds: { id: string }[] = [];
    if (productsDbId) {
        for (const productId of order.productIds || []) {
            let pNotionId = await getNotionIdByShopifyId(notionClient, productsDbId, cleanGid(productId));
            if (pNotionId) relatedIds.push({ id: pNotionId });
        }
    }
    if (relatedIds.length) {
        props["Products"] = { relation: relatedIds.slice(0, 100) };
    }

    const relatedVariantIds: { id: string }[] = [];
    if (variantsDbId) {
        for (const variantId of order.variantIds || []) {
            let vNotionId = await getNotionIdByShopifyId(notionClient, variantsDbId, cleanGid(variantId));
            if (vNotionId) relatedVariantIds.push({ id: vNotionId });
        }
    }
    if (relatedVariantIds.length) {
        props["Variants"] = { relation: relatedVariantIds.slice(0, 100) };
    }
    return props;
};

export async function logErrorToNotion(
    config: Record<string, any>,
    notionClient: Client,
    pageId: string,
    shopifyId: string,
    dbId: string,
    isError: boolean = true
) {
    try {
        const logUrl = buildAppUrl(`logs/${config?.syncToken || ''}/?id=${shopifyId}`);

        try {
            await notionClient.dataSources.update({
                data_source_id: dbId,
                properties: {
                    "Sync Status": {
                        rich_text: {} // Defines the column type as an object
                    }
                }
            });
        } catch (dbError) {
            console.error('dbError', dbError)
            // It is safe to ignore this if the column already exists
        }

        // ACTION 2: Update the actual cell data in the specific Row (Page)
        // You MUST use pages.update here, not dataSources!
        let richTextValue: any[] = [];

        if (isError) {
            console.log('logging error', pageId, logUrl);
            richTextValue = [
                {
                    text: { content: "❌ Error " }
                },
                {
                    text: {
                        content: "[View Log]",
                        link: { url: logUrl }
                    }
                }
            ];
        } else {
            console.log('clearing error status', pageId);
        }

        await notionClient.pages.update({
            page_id: pageId,
            properties: {
                "Sync Status": {
                    rich_text: richTextValue
                }
            }
        });
    } catch (e) {
        console.error("Failed to update Notion error status:", e);
    }
}


export const logToDb = async (
    shop: string,
    topic: string,
    status: string,
    entityId: string | null,
    output: string,
    syncToNotion = true,
    entityType: "orders" | "products" | "variants" | "customers" = "orders"
) => {
    try {
        await prisma.webhookStatus.create({
            data: { shop, topic, status, output }
        });

        if (!entityId || !syncToNotion) return;

        const config = await prisma.storeConfig.findUnique({ where: { shop } });
        if (!config?.notionAccessToken) throw new Error("Notion access token not found.");

        let dbId: string | null = null;
        if (entityType === "orders") dbId = config.notionOrdersDbId;
        if (entityType === "products") dbId = config.notionProductsDbId;
        if (entityType === "variants") dbId = config.notionVariantsDbId;
        if (entityType === "customers") dbId = config.notionCustomersDbId;

        if (dbId) {
            const notion = new Client({ auth: config.notionAccessToken });
            const pageId = await getNotionIdByShopifyId(notion, dbId, cleanGid(entityId));
            const isError = status === "error";
            if (pageId) await logErrorToNotion(config, notion, pageId, entityId, dbId, isError);
        }
    } catch (e) {
        console.error(e)

    }
};

export const generateWebhookSetupHtml = (webhookUrl: string, entityName: string, pluralEntityName: string) => `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Notion Webhook Setup</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; padding: 2rem; max-width: 800px; margin: 0 auto; color: #333; }
            h1 { color: #111; display: flex; align-items: center; gap: 1rem; font-size:2rem }
            .logo { height: 40px; width: auto; }
            code { background: #f4f4f4; padding: 0.2rem 0.4rem; border-radius: 3px; font-family: monospace; font-size: 0.9em; word-break: break-all; }
            .url-box { background: #eef9fd; border: 1px solid #b6e0f2; padding: 1rem; border-radius: 6px; margin: 1.5rem 0; font-weight: bold; word-break: break-all; }
            ol { padding-left: 1.5rem; }
            li { margin-bottom: 0.5rem; }
        </style>
    </head>
    <body>
        <img src="/logo.png" alt="Logo" class="logo" />
        <h1> Notion ${entityName} Sync Webhook</h1>
        <p>This is your unique webhook URL for syncing ${entityName.toLowerCase()} updates from Notion back to Shopify.</p>
        
        <div class="url-box">
            ${webhookUrl}
        </div>

        <h2>How to set this up in Notion:</h2>
        <ol>
            <li>Go to your <strong>${pluralEntityName}</strong> database in Notion.</li>
            <li>Click the lightning bolt icon (<strong>Automations</strong>) at the top right of the database.</li>
            <li>Click <strong>+ New automation</strong>.</li>
            <li>Under <strong>Trigger</strong>, select <strong>Any property edited</strong> (or choose specific properties you want to sync).</li>
            <li>Under <strong>Action</strong>, select <strong>Send Webhook</strong>.</li>
            <li>Paste the URL above into the <strong>Webhook URL</strong> field.</li>
            <li>Click <strong>Create</strong> to save your automation.</li>
        </ol>
        <p>Now, whenever you update a ${entityName.toLowerCase()} in Notion, the changes will automatically sync to Shopify!</p>
    </body>
    </html>
`;
