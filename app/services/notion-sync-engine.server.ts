import { syncProductsToNotion } from "./sync/syncProducts";
import { syncCollectionsToNotion } from "./sync/syncCollections";
import { syncOrdersToNotion } from "./sync/syncOrders";
import { syncCustomersToNotion } from "./sync/syncCustomers";
import type { SyncEntity } from "./sync/utils";

export type { SyncEntity };

export async function syncEntityToNotion(shop: string, entity: SyncEntity, isStandalone: boolean = true, isResume: boolean = false) {
    if (entity === "products") {
        await syncProductsToNotion(shop, isStandalone, isResume);
    } else if (entity === "collections") {
        await syncCollectionsToNotion(shop, isStandalone, isResume);
    } else if (entity === "orders") {
        await syncOrdersToNotion(shop, isStandalone, isResume);
    } else if (entity === "customers") {
        await syncCustomersToNotion(shop, isStandalone, isResume);
    }
}
