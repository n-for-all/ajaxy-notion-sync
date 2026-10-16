import prisma from "../../db.server";
import { Client } from "@notionhq/client";
import {
    NOTION_SCHEMAS, ensureDb,
    fetchAllNotionItems,
    syncItem, prepareNotionOrder,
    NotionProperties,
    getNotionOrdersMap,
    clearDataSource
} from "./utils";

export async function syncOrdersToNotion(shop: string, isStandalone: boolean = true, isResume: boolean = false) {
    const config = await prisma.storeConfig.findUnique({ where: { shop } });
    if (!config?.notionAccessToken || !config.notionParentPageId) return;

    const notion = new Client({ auth: config.notionAccessToken });
    const currentStatus = await prisma.notionSyncStatus.findUnique({ where: { shop } });
    const startCount = isResume ? (currentStatus?.ordersCount || 0) : 0;

    if (!isResume) {
        await prisma.notionSyncStatus.upsert({
            where: { shop },
            update: { status: "syncing", errorMessage: null, ordersCount: 0 },
            create: { shop, status: "syncing", ordersCount: 0 }
        });
    }

    const productsDbId = await ensureDb(notion, shop, config, "notionProductsDbId", "Products", NOTION_SCHEMAS.Products);
    const variantsDbId = await ensureDb(notion, shop, config, "notionVariantsDbId", "Variants", NOTION_SCHEMAS.Variants);

    const ordersDbId = await ensureDb(notion, shop, config, "notionOrdersDbId", "Orders", {
        ...NOTION_SCHEMAS.Orders,
        "Products": { relation: { data_source_id: productsDbId, type: "dual_property", dual_property: {} } },
        "Variants": { relation: { data_source_id: variantsDbId, type: "dual_property", dual_property: {} } },
        "Customer": { relation: { data_source_id: variantsDbId, type: "dual_property", dual_property: {} } },
    });
    if (!isResume) {
        await clearDataSource(notion, ordersDbId);
    }
    const orders = await prisma.order.findMany({
        where: { shop },
        orderBy: { id: "asc" },
        skip: startCount
    });

    if (!isResume) {
        await prisma.notionSyncStatus.update({
            where: { shop },
            data: { totalOrders: await prisma.order.count({ where: { shop } }) }
        });
    }

    const customersDbId = await ensureDb(notion, shop, config, "notionCustomersDbId", "Customers", {
        ...NOTION_SCHEMAS.Customers,
        ...(ordersDbId ? { "Orders": { relation: { data_source_id: ordersDbId, type: "dual_property", dual_property: {} } } } : {})
    });

    const ordersMap = !isResume ? {} : await getNotionOrdersMap(notion, ordersDbId);
    // const productsMap = (!isResume || !productsDbId) ? new Map() : await fetchAllNotionItems(notion, productsDbId, "Products");

    let count = startCount;
    const chunkArray = (arr: any[], size: number) => {
        const chunks = [];
        for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
        return chunks;
    };
    const chunks = chunkArray(orders, 3);

    for (const chunk of chunks) {
        await Promise.all(chunk.map(async order => {
            const props = await prepareNotionOrder({
                order,
                productsDbId,
                variantsDbId,
                customersDbId,
                notionClient: notion
            });

            const existing = ordersMap[order.shopifyId];
            const syncRes = await syncItem(notion, ordersDbId, order.shopifyId, props as NotionProperties, existing);
            await prisma.order.update({
                where: { id: order.id },
                data: { notionLastEditedAt: syncRes.last_edited_time ? new Date(syncRes.last_edited_time) : null }
            });
        }));
        count += chunk.length;

        const s = await prisma.notionSyncStatus.findUnique({ where: { shop }, select: { status: true } });
        if (s?.status === "cancelling") return;
        await prisma.notionSyncStatus.update({ where: { shop }, data: { ordersCount: count } });
    }

    const endStatus = isStandalone ? "idle" : "syncing";
    await prisma.notionSyncStatus.update({ where: { shop }, data: { status: endStatus, ordersCount: count, lastSyncedAt: new Date(), lastOrdersSyncedAt: new Date() } });
}
