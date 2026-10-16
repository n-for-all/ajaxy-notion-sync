import prisma from "../../db.server";
import { Client } from "@notionhq/client";
import {
    NOTION_SCHEMAS, ensureDb, syncItem, prepareNotionProduct,
    prepareNotionVariant,
    clearDataSource, NotionProperties,
    getNotionCollectionsMap
} from "./utils";
import { syncCollectionsToNotion } from "./syncCollections";

export async function syncProductsToNotion(shop: string, isStandalone: boolean = true, isResume: boolean = false) {
    const config = await prisma.storeConfig.findUnique({ where: { shop } });
    if (!config?.notionAccessToken) throw new Error("Notion access token not found.");
    if (!config.notionParentPageId) throw new Error("No Notion page linked. Please reconnect.");

    const notion = new Client({ auth: config.notionAccessToken });
    const currentStatus = await prisma.notionSyncStatus.findUnique({ where: { shop } });
    const startCount = isResume ? (currentStatus?.productsCount || 0) : 0;

    if (!isResume) {
        await prisma.notionSyncStatus.upsert({
            where: { shop },
            update: { status: "syncing", errorMessage: null, productsCount: 0, variantsCount: 0 },
            create: { shop, status: "syncing", productsCount: 0, variantsCount: 0 }
        });
    }



    let count = startCount;

    const collectionsDbId = await ensureDb(notion, shop, config, "notionCollectionsDbId", "Collections", {
        ...NOTION_SCHEMAS.Collections
    });

    const productsDbId = await ensureDb(notion, shop, config, "notionProductsDbId", "Products", {
        ...NOTION_SCHEMAS.Products,
        "Collections": { relation: { data_source_id: collectionsDbId, type: "dual_property", dual_property: {} } }
    });

    const variantsDbId = await ensureDb(notion, shop, config, "notionVariantsDbId", "Variants", {
        ...NOTION_SCHEMAS.Variants,
        "Product": {
            relation: { data_source_id: productsDbId, type: "dual_property", dual_property: {} }
        }
    });

    const products = await prisma.product.findMany({
        where: { shop },
        include: { images: true, variants: true, collections: true },
        orderBy: { id: "asc" },
        skip: startCount
    });

    if (!isResume) {
        await prisma.notionSyncStatus.update({
            where: { shop },
            data: { totalProducts: await prisma.product.count({ where: { shop } }) }
        });

        // 1. Wipe the products and variants databases
        await clearDataSource(notion, productsDbId);
        await clearDataSource(notion, variantsDbId);

        // 2. Sync Collections (which also wipes the Collections DB)
        await syncCollectionsToNotion(shop, false, false);
    }

    const collectionsMap = await getNotionCollectionsMap(notion, collectionsDbId);

    let skippedProducts = 0;
    let totalSyncedVariants = isResume ? (currentStatus?.variantsCount || 0) : 0;

    for (const product of products) {
        const props = prepareNotionProduct({
            shop,
            product,
            collectionNotionMap: collectionsMap
        });

        const syncRes = await syncItem(notion, productsDbId, product.shopifyId, props as NotionProperties, undefined);
        let notionProductId = syncRes.id;
        await prisma.product.update({
            where: { id: product.id },
            data: { notionLastEditedAt: syncRes.last_edited_time ? new Date(syncRes.last_edited_time) : null }
        });

        for (const variant of product.variants) {
            const varProps = prepareNotionVariant({
                variant,
                notionProductId
            });

            const syncRes = await syncItem(notion, variantsDbId, variant.shopifyVariantId, varProps as NotionProperties, undefined);
            await prisma.variant.update({
                where: { id: variant.id },
                data: { notionLastEditedAt: syncRes.last_edited_time ? new Date(syncRes.last_edited_time) : null }
            });
        }
        totalSyncedVariants += product.variants.length;

        count++;

        const s = await prisma.notionSyncStatus.findUnique({ where: { shop }, select: { status: true } });
        if (s?.status === "cancelling") return;

        await prisma.notionSyncStatus.update({
            where: { shop },
            data: { productsCount: count, variantsCount: totalSyncedVariants }
        });
    }

    console.log(`Finished Products. Skipped unchanged: ${skippedProducts}/${products.length}`);
    const endStatus = isStandalone ? "idle" : "syncing";
    await prisma.notionSyncStatus.update({ where: { shop }, data: { status: endStatus, productsCount: count, variantsCount: totalSyncedVariants, lastSyncedAt: new Date(), lastProductsSyncedAt: new Date() } });
}
