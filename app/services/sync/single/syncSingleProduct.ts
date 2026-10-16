import prisma from "../../../db.server";
import { Client } from "@notionhq/client";
import {
    syncItem,
    getNotionIdByShopifyId,
    prepareNotionProduct,
    getNotionCollectionsMap,
    cleanGid,
    NotionProperties
} from "../utils";

export async function syncSingleProductToNotion(shop: string, shopifyId: string) {
    try {
        const config = await prisma.storeConfig.findUnique({ where: { shop } });
        if (!config?.notionAccessToken || !config.notionParentPageId || !config.notionProductsDbId) return;

        const notion = new Client({ auth: config.notionAccessToken });

        const product = await prisma.product.findUnique({ where: { shop_shopifyId: { shop, shopifyId } }, include: { images: true, collections: true } });
        if (!product) return;

        const collectionsDbId = config.notionCollectionsDbId;
        const allCollectionsMap = collectionsDbId ? await getNotionCollectionsMap(notion, collectionsDbId) : {};

        const props = prepareNotionProduct({
            shop,
            product,
            collectionNotionMap: allCollectionsMap
        });

        const existingId = await getNotionIdByShopifyId(notion, config.notionProductsDbId, cleanGid(product.shopifyId));
        const syncRes = await syncItem(notion, config.notionProductsDbId, product.shopifyId, props as NotionProperties, existingId || undefined);
        await prisma.product.update({
            where: { id: product.id },
            data: { notionLastEditedAt: syncRes.last_edited_time ? new Date(syncRes.last_edited_time) : null }
        });
    } catch (error: any) {
        console.error(`[APP_LOGIC_ERROR] Notion Single Product Sync Error:`, error);
    }
}
