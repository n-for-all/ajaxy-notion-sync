import prisma from "../../../db.server";
import { Client } from "@notionhq/client";
import {
    syncItem,
    getNotionIdByShopifyId,
    prepareNotionCustomer,
    cleanGid,
    NotionProperties,
} from "../utils";
// Make sure you import syncSingleOrderToNotion and getNotionIdByShopifyId at the top of your file
export async function syncSingleCustomerToNotion(shop: string, shopifyId: string) {
    try {
        const config = await prisma.storeConfig.findUnique({ where: { shop } });
        if (!config?.notionAccessToken || !config.notionParentPageId || !config.notionCustomersDbId) return;

        const notion = new Client({ auth: config.notionAccessToken });

        // Get the customer (no need to include orders anymore!)
        const customer = await prisma.customer.findUnique({ 
            where: { shop_shopifyId: { shop, shopifyId } } 
        });

        if (!customer) return;

        // Note: You may need to update prepareNotionCustomer to not require ordersMap anymore
        const props = await prepareNotionCustomer({
            shop,
            customer,
        });

        const customerNumericId = Number(cleanGid(customer.shopifyId));
        const existingId = await getNotionIdByShopifyId(notion, config.notionCustomersDbId, customerNumericId);
        
        const syncRes = await syncItem(
            notion, 
            config.notionCustomersDbId, 
            customer.shopifyId, 
            props as NotionProperties, 
            existingId || undefined
        );
        
        await prisma.customer.update({
            where: { id: customer.id },
            data: { notionLastEditedAt: syncRes.last_edited_time ? new Date(syncRes.last_edited_time) : null }
        });

    } catch (error: any) {
        console.error(`[APP_LOGIC_ERROR] Notion Single Customer Sync Error:`, error);
    }
}