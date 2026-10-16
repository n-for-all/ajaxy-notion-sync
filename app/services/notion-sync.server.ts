import prisma from "../db.server";
import { syncEntityToNotion, type SyncEntity } from "./notion-sync-engine.server";
import { syncSingleProductToNotion } from "./sync/single/syncSingleProduct";
import { syncSingleCollectionToNotion } from "./sync/single/syncSingleCollection";
import { syncSingleOrderToNotion } from "./sync/single/syncSingleOrder";
import { syncSingleCustomerToNotion } from "./sync/single/syncSingleCustomer";
import { Client } from "@notionhq/client";
import { cleanGid, getNotionIdByShopifyId } from "./sync/utils";

export { syncEntityToNotion, type SyncEntity };

export async function syncToNotion(shop: string, isResume: boolean = false) {
    try {
        await prisma.notionSyncStatus.upsert({
            where: { shop },
            update: { status: "syncing", errorMessage: null },
            create: { shop, status: "syncing" }
        });

        await syncEntityToNotion(shop, "products", false, isResume);
        // Note: Collections are intentionally omitted here because syncProductsToNotion strictly 
        // synchronizes them first to ensure relational mapping exists before products sync.
        await syncEntityToNotion(shop, "orders", false, isResume);
        await syncEntityToNotion(shop, "customers", false, isResume);

        await prisma.notionSyncStatus.update({
            where: { shop },
            data: {
                status: "idle",
                lastSyncedAt: new Date()
            }
        });
    } catch (error: any) {
        console.error("[APP_LOGIC_ERROR] Full Notion Sync Error:", error);
        await prisma.notionSyncStatus.upsert({
            where: { shop },
            update: { status: "error", errorMessage: error.message },
            create: { shop, status: "error", errorMessage: error.message }
        });
    }
}

export async function syncSingleEntityToNotion(shop: string, entity: SyncEntity, shopifyId: string) {
    console.log(`\n\n=== syncSingleEntityToNotion CALLED ===`);
    console.log(`Shop: ${shop}, Entity: ${entity}, ID: ${shopifyId}`);
    try {
        if (entity === "products") {
            await syncSingleProductToNotion(shop, shopifyId);
        } else if (entity === "collections") {
            await syncSingleCollectionToNotion(shop, shopifyId);
        } else if (entity === "orders") {
            await syncSingleOrderToNotion(shop, shopifyId);
        } else if (entity === "customers") {
            await syncSingleCustomerToNotion(shop, shopifyId);
        }
    } catch (error: any) {
        console.error(`[APP_LOGIC_ERROR] Notion Single Entity Sync Error (${entity}):`, error);
    }
}

export async function deleteSingleEntityFromNotion(shop: string, entity: SyncEntity, shopifyId: string) {
    try {
        const config = await prisma.storeConfig.findUnique({ where: { shop } });
        if (!config?.notionAccessToken) return;

        const notion = new Client({ auth: config.notionAccessToken });
        const cleanId = cleanGid(shopifyId);

        let dbId: string | null = null;
        let variantDbId: string | null = null;

        if (entity === "products") {
            dbId = config.notionProductsDbId;
            variantDbId = config.notionVariantsDbId;
        } else if (entity === "collections") {
            dbId = config.notionCollectionsDbId;
        } else if (entity === "orders") {
            dbId = config.notionOrdersDbId;
        } else if (entity === "customers") {
            dbId = config.notionCustomersDbId;
        }

        if (entity === "products" && variantDbId) {
            const variants = await prisma.variant.findMany({
                where: { product: { shop, shopifyId } }
            });
            for (const variant of variants) {
                const vPageId = await getNotionIdByShopifyId(notion, variantDbId, cleanGid(variant.shopifyVariantId));
                if (vPageId) {
                    await notion.pages.update({ page_id: vPageId, in_trash: true });
                }
            }
        }

        if (dbId) {
            const pageId = await getNotionIdByShopifyId(notion, dbId, cleanId);
            if (pageId) {
                await notion.pages.update({ page_id: pageId, in_trash: true });
            }
        }
    } catch (error: any) {
        console.error(`[APP_LOGIC_ERROR] Notion Single Entity Delete Error (${entity}):`, error);
    }
}
