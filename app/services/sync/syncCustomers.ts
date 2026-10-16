import prisma from "../../db.server";
import { Client } from "@notionhq/client";
import {
    NOTION_SCHEMAS, ensureDb,
    fetchAllNotionItems,
    syncItem, prepareNotionCustomer,
    getNotionCustomersMap,
    NotionProperties,
    getNotionOrdersMap,
    clearDataSource
} from "./utils";

export async function syncCustomersToNotion(shop: string, isStandalone: boolean = true, isResume: boolean = false) {
    const config = await prisma.storeConfig.findUnique({ where: { shop } });
    if (!config?.notionAccessToken || !config.notionParentPageId) return;

    const notion = new Client({ auth: config.notionAccessToken });
    const currentStatus = await prisma.notionSyncStatus.findUnique({ where: { shop } });
    const startCount = isResume ? (currentStatus?.customersCount || 0) : 0;

    if (!isResume) {
        await prisma.notionSyncStatus.upsert({
            where: { shop },
            update: { status: "syncing", errorMessage: null, customersCount: 0 },
            create: { shop, status: "syncing", customersCount: 0 }
        });
    }

    const productsDbId = await ensureDb(notion, shop, config, "notionProductsDbId", "Products", NOTION_SCHEMAS.Products);
    let ordersDbId = config.notionOrdersDbId;
    if (ordersDbId) {
        ordersDbId = await ensureDb(notion, shop, config, "notionOrdersDbId", "Orders", {
            ...NOTION_SCHEMAS.Orders,
            "Products": { relation: { data_source_id: productsDbId, type: "dual_property", dual_property: {} } }
        });
    }
    const customersDbId = await ensureDb(notion, shop, config, "notionCustomersDbId", "Customers", {
        ...NOTION_SCHEMAS.Customers,
        ...(ordersDbId ? { "Orders": { relation: { data_source_id: ordersDbId, type: "dual_property", dual_property: {} } } } : {})
    });

    const customers = await prisma.customer.findMany({
        where: { shop },
        orderBy: { id: "asc" },
        skip: startCount
    });

    if (!isResume) {
        await clearDataSource(notion, customersDbId);
        await prisma.notionSyncStatus.update({
            where: { shop },
            data: { totalCustomers: await prisma.customer.count({ where: { shop } }) }
        });
    }

    const customersMap = !isResume ? {} : await getNotionCustomersMap(notion, customersDbId);
    const ordersMap = (!isResume || !ordersDbId) ? {} : await getNotionOrdersMap(notion, ordersDbId);

    let count = startCount;
    const chunkArray = (arr: any[], size: number) => {
        const chunks = [];
        for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
        return chunks;
    };
    const chunks = chunkArray(customers, 3);

    for (const chunk of chunks) {
        await Promise.all(chunk.map(async customer => {
            const props = await prepareNotionCustomer({
                shop,
                customer,
                ordersDbId,
                ordersMap,
            });

            const existing = customersMap[customer.shopifyId];
            const syncRes = await syncItem(notion, customersDbId, customer.shopifyId, props as NotionProperties, existing);
            await prisma.customer.update({
                where: { id: customer.id },
                data: { notionLastEditedAt: syncRes.last_edited_time ? new Date(syncRes.last_edited_time) : null }
            });
        }));
        count += chunk.length;

        const s = await prisma.notionSyncStatus.findUnique({ where: { shop }, select: { status: true } });
        if (s?.status === "cancelling") return;
        await prisma.notionSyncStatus.update({ where: { shop }, data: { customersCount: count } });
    }

    const endStatus = isStandalone ? "idle" : "syncing";
    await prisma.notionSyncStatus.update({ where: { shop }, data: { status: endStatus, customersCount: count, lastSyncedAt: new Date(), lastCustomersSyncedAt: new Date() } });
}
