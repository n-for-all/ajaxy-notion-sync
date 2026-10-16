import type { ActionFunctionArgs } from "@remix-run/node";
import { PLAN_CONFIG } from "~/constants";
import { getPlanLimits } from "../services/plan-limits.server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { indexSingleShopifyCollection, indexSingleShopifyProduct, indexSingleShopifyOrder, indexSingleShopifyCustomer } from "~/services/shopify-indexer.server";
import { syncSingleEntityToNotion, deleteSingleEntityFromNotion } from "~/services/notion-sync.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { topic, shop, session, admin, payload } = await authenticate.webhook(request);

    const logWebhook = async (status: string, output: string) => {
        if (!shop || !topic) return;
        try {
            await db.webhookStatus.create({
                data: { shop, topic, status, output }
            });
        } catch (e) {
            console.error("Failed to log webhook status:", e);
        }
    };

    // free tier limits when there's no subscription (see plan-limits.server)
    const getLimits = () => getPlanLimits(shop!);

    try {
        switch (topic) {
            case "APP_UNINSTALLED":
                if (shop) {
                    await db.session.deleteMany({ where: { shop } });
                    await db.subscription.deleteMany({ where: { shop } });
                    await db.shop.updateMany({
                        where: { shop },
                        data: { status: "deleted" }
                    });
                }
                return new Response(`App is uninstalled for ${shop}`, { status: 200 });

            case "SHOP_REDACT":
                if (shop) {
                    await db.$transaction([
                        db.session.deleteMany({ where: { shop } }),
                        db.subscription.deleteMany({ where: { shop } }),
                        db.product.deleteMany({ where: { shop } }),
                        db.collection.deleteMany({ where: { shop } }),
                        db.customer.deleteMany({ where: { shop } }),
                        db.order.deleteMany({ where: { shop } }),
                        db.indexStatus.deleteMany({ where: { shop } }),
                        db.notionSyncStatus.deleteMany({ where: { shop } }),
                        db.storeConfig.deleteMany({ where: { shop } }),
                        db.shop.deleteMany({ where: { shop } }),
                        // sync logs contain customer and order IDs
                        db.webhookStatus.deleteMany({ where: { shop } })
                    ]);
                }
                return new Response("Shop data fully redacted", { status: 200 });

            case "APP_SUBSCRIPTIONS_UPDATE":
                if (payload && (payload as any).app_subscription) {
                    const sub = (payload as any).app_subscription;
                    const subscriptionId: string | undefined = sub.admin_graphql_api_id;
                    if (sub.status === "CANCELLED" || sub.status === "DECLINED" || sub.status === "EXPIRED" || sub.status === "FROZEN") {
                        // when the merchant changes plan the old plan is cancelled too (possibly after the new one is active):
                        // only remove the row if it belongs to the cancelled subscription
                        await db.subscription.deleteMany({
                            where: subscriptionId ? { shop, subscriptionId } : { shop },
                        });
                    } else if (sub.status === "ACTIVE" && sub.name) {
                        // e.g. a frozen store paying again: restore the plan without waiting for the merchant to open the app
                        const planName = String(sub.name).toLowerCase();
                        const planConfig = PLAN_CONFIG[planName as keyof typeof PLAN_CONFIG];
                        if (planConfig) {
                            const planData = {
                                name: planName,
                                plan: planName,
                                maxItems: planConfig.maxItems,
                                maxOrders: planConfig.maxOrders || 500,
                                maxMessages: planConfig.maxMessages,
                                price: planConfig.price,
                                syncMethod: planConfig.syncMethod,
                                ...(subscriptionId ? { subscriptionId } : {}),
                            };
                            const now = new Date();
                            await db.subscription.upsert({
                                where: { shop },
                                update: planData,
                                create: {
                                    ...planData,
                                    shop,
                                    messagesRemaining: planConfig.maxMessages,
                                    nextRefillDate: new Date(now.getFullYear(), now.getMonth() + 1, now.getDate()),
                                },
                            });
                        }
                    }
                }
                return new Response("Subscription updated", { status: 200 });

            case "PRODUCTS_CREATE":
            case "PRODUCTS_UPDATE":
                if (!admin) {
                    throw new Response();
                }
                if (payload && (payload as any).id) {
                    try {
                        const shopifyIdStr = (payload as any).id.toString();
                        const formattedId = shopifyIdStr.includes("gid://") ? shopifyIdStr : `gid://shopify/Product/${shopifyIdStr}`;
                        
                        const limits = await getLimits();
                        const currentItems = await db.product.count({ where: { shop } });
                        const existing = await db.product.findFirst({ where: { shop, shopifyId: formattedId } });
                        if (currentItems >= limits.maxItems && !existing) {
                            await logWebhook("error", "Plan limit reached for products");
                            return new Response("Plan limit reached", { status: 200 });
                        }

                        await indexSingleShopifyProduct(admin, shop, shopifyIdStr);
                        await syncSingleEntityToNotion(shop, "products", formattedId);
                    } catch (error: any) {
                        console.error("Error processing product update webhook:", error);
                        await logWebhook("error", `Error: ${error.message}`);
                        return new Response("Error syncing product", { status: 500 });
                    }
                }
                await logWebhook("success", "Product synced successfully");
                return new Response("Product synced", { status: 200 });

            case "PRODUCTS_DELETE":
                if (payload && (payload as any).id) {
                    const shopifyIdStr = (payload as any).id.toString();
                    const formattedId = shopifyIdStr.includes("gid://") ? shopifyIdStr : `gid://shopify/Product/${shopifyIdStr}`;
                    await deleteSingleEntityFromNotion(shop, "products", formattedId);
                    await db.product.deleteMany({
                        where: { shop, shopifyId: formattedId }
                    });
                }
                await logWebhook("success", "Product deleted successfully");
                return new Response("Product deleted", { status: 200 });
            case "COLLECTIONS_CREATE":
            case "COLLECTIONS_UPDATE":
                if (!admin) {
                    throw new Response();
                }
                if (payload && (payload as any).id) {
                    try {
                        const shopifyIdStr = (payload as any).id.toString();
                        const formattedId = shopifyIdStr.includes("gid://") ? shopifyIdStr : `gid://shopify/Collection/${shopifyIdStr}`;
                        
                        const limits = await getLimits();
                        const currentCollections = await db.collection.count({ where: { shop } });
                        const existing = await db.collection.findFirst({ where: { shop, shopifyId: formattedId } });
                        if (currentCollections >= limits.maxItems && !existing) {
                            await logWebhook("error", "Plan limit reached for collections");
                            return new Response("Plan limit reached", { status: 200 });
                        }

                        await indexSingleShopifyCollection(admin, shop, shopifyIdStr);
                        await syncSingleEntityToNotion(shop, "collections", formattedId);
                    } catch (error: any) {
                        console.error("Error processing collection update webhook:", error);
                        await logWebhook("error", `Error: ${error.message}`);
                        return new Response("Error syncing collection", { status: 500 });
                    }
                }
                await logWebhook("success", "Collection synced successfully");
                return new Response("Collection synced", { status: 200 });

            case "COLLECTIONS_DELETE":
                if (payload && (payload as any).id) {
                    const shopifyIdStr = (payload as any).id.toString();
                    const formattedId = shopifyIdStr.includes("gid://") ? shopifyIdStr : `gid://shopify/Collection/${shopifyIdStr}`;
                    await deleteSingleEntityFromNotion(shop, "collections", formattedId);
                    await db.collection.deleteMany({
                        where: { shop, shopifyId: formattedId }
                    });
                }
                await logWebhook("success", "Collection deleted successfully");
                return new Response("Collection deleted", { status: 200 });
            case "ORDERS_CREATE":
            case "ORDERS_UPDATED":
                if (!admin) {
                    throw new Response();
                }
                if (payload && (payload as any).id) {
                    try {
                        const shopifyIdStr = (payload as any).id.toString();
                        const formattedId = shopifyIdStr.includes("gid://") ? shopifyIdStr : `gid://shopify/Order/${shopifyIdStr}`;
                        
                        const limits = await getLimits();
                        const currentOrders = await db.order.count({ where: { shop } });
                        const existing = await db.order.findFirst({ where: { shop, shopifyId: formattedId } });
                        if (currentOrders >= limits.maxOrders && !existing) {
                            await logWebhook("error", "Plan limit reached for orders");
                            return new Response("Plan limit reached", { status: 200 });
                        }
                        
                        const customerData = (payload as any).customer;
                        if (customerData && customerData.id) {
                            const customerIdStr = customerData.id.toString();
                            // Pass the CUSTOMER ID here, not the Order ID
                            await indexSingleShopifyCustomer(admin, shop, customerIdStr);
                        }
                        await indexSingleShopifyOrder(admin, shop, shopifyIdStr);
                        await syncSingleEntityToNotion(shop, "orders", formattedId);
                    } catch (error: any) {
                        console.error("Error processing order update webhook:", error);
                        await logWebhook("error", `Error: ${error.message}`);
                        return new Response("Error syncing order", { status: 500 });
                    }
                }
                await logWebhook("success", "Order synced successfully");
                return new Response("Order synced", { status: 200 });

            case "ORDERS_DELETE":
                if (payload && (payload as any).id) {
                    const shopifyIdStr = (payload as any).id.toString();
                    const formattedId = shopifyIdStr.includes("gid://") ? shopifyIdStr : `gid://shopify/Order/${shopifyIdStr}`;
                    await deleteSingleEntityFromNotion(shop, "orders", formattedId);
                    await db.order.deleteMany({
                        where: { shop, shopifyId: formattedId }
                    });
                }
                await logWebhook("success", "Order deleted successfully");
                return new Response("Order deleted", { status: 200 });

            case "CUSTOMERS_CREATE":
            case "CUSTOMERS_UPDATE":
                if (!admin) {
                    throw new Response();
                }
                if (payload && (payload as any).id) {
                    try {
                        const shopifyIdStr = (payload as any).id.toString();
                        const formattedId = shopifyIdStr.includes("gid://") ? shopifyIdStr : `gid://shopify/Customer/${shopifyIdStr}`;
                        
                        const limits = await getLimits();
                        const currentCustomers = await db.customer.count({ where: { shop } });
                        const existing = await db.customer.findFirst({ where: { shop, shopifyId: formattedId } });
                        if (currentCustomers >= limits.maxItems && !existing) {
                            await logWebhook("error", "Plan limit reached for customers");
                            return new Response("Plan limit reached", { status: 200 });
                        }
                        
                        await indexSingleShopifyCustomer(admin, shop, shopifyIdStr);
                        await syncSingleEntityToNotion(shop, "customers", formattedId);
                    } catch (error: any) {
                        console.error("Error processing customer update webhook:", error);
                        await logWebhook("error", `Error: ${error.message}`);
                        return new Response("Error syncing customer", { status: 500 });
                    }
                }
                await logWebhook("success", "Customer synced successfully");
                return new Response("Customer synced", { status: 200 });

            case "CUSTOMERS_DELETE":
                if (payload && (payload as any).id) {
                    const shopifyIdStr = (payload as any).id.toString();
                    const formattedId = shopifyIdStr.includes("gid://") ? shopifyIdStr : `gid://shopify/Customer/${shopifyIdStr}`;
                    await deleteSingleEntityFromNotion(shop, "customers", formattedId);
                    await db.customer.deleteMany({
                        where: { shop, shopifyId: formattedId }
                    });
                }
                await logWebhook("success", "Customer deleted successfully");
                return new Response("Customer deleted", { status: 200 });

            case "CUSTOMERS_REDACT": {
                // a customer asked the store to delete their data: remove it from our database and from Notion
                const redact = payload as any;
                const customerGid = redact?.customer?.id ? `gid://shopify/Customer/${redact.customer.id}` : null;
                const orderGids: string[] = (redact?.orders_to_redact || []).map((id: number | string) =>
                    String(id).includes("gid://") ? String(id) : `gid://shopify/Order/${id}`,
                );

                if (orderGids.length) {
                    await db.order.updateMany({
                        where: { shop, shopifyId: { in: orderGids } },
                        data: { customerName: null, note: null, customerId: null },
                    });
                }
                if (customerGid) {
                    await deleteSingleEntityFromNotion(shop, "customers", customerGid);
                    await db.customer.deleteMany({ where: { shop, shopifyId: customerGid } });
                }
                // update the orders in Notion so they no longer show the customer
                for (const orderGid of orderGids) {
                    await syncSingleEntityToNotion(shop, "orders", orderGid);
                }

                await logWebhook("success", `Customer data redacted (customer ${customerGid || "-"}, ${orderGids.length} orders)`);
                return new Response("Customer data redacted", { status: 200 });
            }

            case "CUSTOMERS_DATA_REQUEST": {
                // the merchant must be able to give the customer their data: record the request so it can be answered
                const request = payload as any;
                const customerGid = request?.customer?.id ? `gid://shopify/Customer/${request.customer.id}` : "-";
                const orders = (request?.orders_requested || []).join(", ") || "-";
                await logWebhook(
                    "success",
                    `Customer data request: customer ${customerGid}, orders ${orders}. Stored data: name, email, phone, order totals and tags (database and Notion).`,
                );
                return new Response("Customer data request recorded", { status: 200 });
            }

            default:
                await logWebhook("success", "Ignored webhook");
                return new Response(
                    "Customer and shop data is not used by this app",
                    { status: 200 },
                );
        }
    } catch (err: any) {
        console.error("Webhook processing error:", err.message);
        await logWebhook("error", `Unhandled exception: ${err.message}`);
        return new Response("Internal Server Error", { status: 500 });
    }
};
