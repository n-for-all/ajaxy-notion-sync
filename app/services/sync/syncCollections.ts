import prisma from "../../db.server";
import { Client } from "@notionhq/client";
import {
    NOTION_SCHEMAS,
    CollectionProps,
    ensureDb,
    syncItem,
    clearDataSource,
    cleanGid,
    NotionProperties,
    getNotionCollectionsMap
} from "./utils";

export async function syncCollectionsToNotion(shop: string, isStandalone: boolean = true, isResume: boolean = false) {
    const config = await prisma.storeConfig.findUnique({ where: { shop } });
    if (!config?.notionAccessToken || !config.notionParentPageId) return;

    const notion = new Client({ auth: config.notionAccessToken });
    const currentStatus = await prisma.notionSyncStatus.findUnique({ where: { shop } });
    const startCount = isResume ? (currentStatus?.collectionsCount || 0) : 0;

    if (!isResume) {
        await prisma.notionSyncStatus.upsert({
            where: { shop },
            update: { status: "syncing", errorMessage: null, collectionsCount: 0 },
            create: { shop, status: "syncing", collectionsCount: 0 }
        });
    }

    const collectionsDbId = await ensureDb(notion, shop, config, "notionCollectionsDbId", "Collections", {
        ...NOTION_SCHEMAS.Collections
    });

    if (!isResume) {
        await clearDataSource(notion, collectionsDbId);
    }

    const collections = await prisma.collection.findMany({
        where: { shop },
        orderBy: { id: "asc" },
        skip: startCount
    });

    if (!isResume) {
        await prisma.notionSyncStatus.update({
            where: { shop },
            data: { totalCollections: await prisma.collection.count({ where: { shop } }) }
        });
    }

    const collectionsMap = !isResume ? {} : await getNotionCollectionsMap(notion, collectionsDbId);

    let count = startCount;
    const chunkArray = (arr: any[], size: number) => {
        const chunks = [];
        for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
        return chunks;
    };
    const chunks = chunkArray(collections, 3);

    for (const chunk of chunks) {
        await Promise.all(chunk.map(async col => {
            const fullUrl = `https://${shop}/collections/${col.handle}`;
            const props: CollectionProps = {
                "title": { title: [{ type: "text", text: { content: col.title || "Untitled" } }] },
                "ID": { number: cleanGid(col.shopifyId) },
                "Handle": { rich_text: [{ type: "text", text: { content: col.handle || "" } }] },
                "URL": { url: fullUrl }
            };

            const existing = collectionsMap[col.shopifyId];
            const syncRes = await syncItem(notion, collectionsDbId, col.shopifyId, props as NotionProperties, existing);
            await prisma.collection.update({
                where: { id: col.id },
                data: { notionLastEditedAt: syncRes.last_edited_time ? new Date(syncRes.last_edited_time) : null }
            });
        }));
        count += chunk.length;

        const s = await prisma.notionSyncStatus.findUnique({ where: { shop }, select: { status: true } });
        if (s?.status === "cancelling") return;
        await prisma.notionSyncStatus.update({ where: { shop }, data: { collectionsCount: count } });
    }

    const endStatus = isStandalone ? "idle" : "syncing";
    await prisma.notionSyncStatus.update({ where: { shop }, data: { status: endStatus, collectionsCount: count, lastSyncedAt: new Date(), lastCollectionsSyncedAt: new Date() } });
}
