import prisma from "../../../db.server";
import { Client } from "@notionhq/client";
import {
    CollectionProps,
    syncItem,
    getNotionIdByShopifyId,
    cleanGid,
    NotionProperties
} from "../utils";

export async function syncSingleCollectionToNotion(shop: string, shopifyId: string) {
    try {
        const config = await prisma.storeConfig.findUnique({ where: { shop } });
        if (!config?.notionAccessToken || !config.notionParentPageId || !config.notionCollectionsDbId) return;

        const notion = new Client({ auth: config.notionAccessToken });

        const collection = await prisma.collection.findUnique({ where: { shop_shopifyId: { shop, shopifyId } } });
        if (!collection) return;

        const fullUrl = collection.url ? (collection.url.startsWith("http") ? collection.url : `https://${shop}/collections/${collection.handle}`) : null;

        const shopifyIdNumber = cleanGid(shopifyId);

        const props: CollectionProps = {
            "title": { title: [{ type: "text", text: { content: collection.title || "Untitled" } }] },
            "ID": { number: shopifyIdNumber },
            "Handle": { rich_text: [{ text: { content: collection.handle || "" } }] },
            "URL": { url: fullUrl }
        };

        const existingId = await getNotionIdByShopifyId(notion, config.notionCollectionsDbId, shopifyIdNumber);
        const syncRes = await syncItem(notion, config.notionCollectionsDbId, collection.shopifyId, props as NotionProperties, existingId || undefined);
        await prisma.collection.update({
            where: { id: collection.id },
            data: { notionLastEditedAt: syncRes.last_edited_time ? new Date(syncRes.last_edited_time) : null }
        });
    } catch (error: any) {
        console.error(`[APP_LOGIC_ERROR] Notion Single Collection Sync Error:`, error);
    }
}
