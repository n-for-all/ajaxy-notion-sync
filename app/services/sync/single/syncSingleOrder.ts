import prisma from "../../../db.server";
import { Client } from "@notionhq/client";
import { 
    OrderProps, 
    syncItem,
    getNotionIdByShopifyId,
    prepareNotionOrder,
    cleanGid,
    NotionProperties
} from "../utils";
import { syncSingleCustomerToNotion } from "./syncSingleCustomer";

export async function syncSingleOrderToNotion(shop: string, shopifyId: string) {
    try {
        const config = await prisma.storeConfig.findUnique({ where: { shop } });
        if (!config?.notionAccessToken || !config.notionParentPageId || !config.notionOrdersDbId) return;

        const notion = new Client({ auth: config.notionAccessToken });
        const order = await prisma.order.findUnique({ where: { shop_shopifyId: { shop, shopifyId } } });
        if (!order) return;

        if (order.customerId && config.notionCustomersDbId) {
            // Find the local customer record associated with this order
            const customer = await prisma.customer.findUnique({ 
                where: { id: order.customerId } 
            });
            
            if (customer) {
                const customerNumericId = cleanGid(customer.shopifyId);
                let notionCustomerId = await getNotionIdByShopifyId(notion, config.notionCustomersDbId, customerNumericId);
                
                // If Notion doesn't have this customer yet, sync them NOW.
                // Because we removed the order loop from syncSingleCustomerToNotion, 
                // this is 100% safe and will NOT cause an infinite loop!
                if (!notionCustomerId) {
                    console.log(`[SYNC] Customer missing for Order ${shopifyId}. Syncing customer to Notion first...`);
                    await syncSingleCustomerToNotion(shop, customer.shopifyId);
                }
            }
        }

        const props = await prepareNotionOrder({
            order,
            productsDbId: config.notionProductsDbId,
            variantsDbId: config.notionVariantsDbId,
            customersDbId: config.notionCustomersDbId,
            notionClient: notion
        });

        const existingId = await getNotionIdByShopifyId(notion, config.notionOrdersDbId, cleanGid(order.shopifyId));
        const syncRes = await syncItem(notion, config.notionOrdersDbId, order.shopifyId, props as NotionProperties, existingId || undefined);
        await prisma.order.update({
            where: { id: order.id },
            data: { notionLastEditedAt: syncRes.last_edited_time ? new Date(syncRes.last_edited_time) : null }
        });
    } catch (error: any) {
        console.error(`[APP_LOGIC_ERROR] Notion Single Order Sync Error:`, error);
    }
}
