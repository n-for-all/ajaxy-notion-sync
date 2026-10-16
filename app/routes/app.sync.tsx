import { json, redirect, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { isAppStore } from "~/app-mode";
import { useLoaderData, useFetcher, useRevalidator } from "@remix-run/react";
import {
    Page,
    Layout,
    Card,
    BlockStack,
    Text,
    Button,
    InlineStack,
    Grid,
    ProgressBar,
    Banner,
    Box,
    Divider,
    Icon,
    DataTable,
    Badge,
    Popover,
    ActionList,
    Modal,
    Tabs,
    TextField,
} from "@shopify/polaris";
import { useEffect, useState, useCallback } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { indexAllShopifyData, indexShopifyProducts, indexShopifyCollections, indexShopifyCustomers, indexShopifyOrders } from "../services/shopify-indexer.server";
import { getPlanLimits } from "../services/plan-limits.server";
import { CheckCircleIcon, CheckIcon, ClipboardIcon, XCircleIcon } from "@shopify/polaris-icons";
import crypto from "crypto";
import { syncToNotion, syncEntityToNotion } from "~/services/notion-sync.server";
import { encrypt } from "../utils/encryption.server";
import { buildAppUrl } from "~/services/sync/utils";
import { SyncAnimation } from "~/components/Animation";
import { checkBilling } from "./components";
import { checkTrialDays, syncSubscription } from "~/db.server";
import { PLAN_CONFIG } from "~/constants";

export async function loader({ request }: LoaderFunctionArgs) {
    const { billing, session } = await authenticate.admin(request);

    if (!session || !session.shop) {
        throw new Error("Unauthorized");
    }

    let trialDays = -1;
    let plan = null;
    const url = new URL(request.url);
    const isPolling = url.searchParams.has("_data");

    if (isPolling) {
        const localSub = await prisma.subscription.findUnique({ where: { shop: session.shop } });
        if (localSub) {
            trialDays = localSub.trialDays;
            plan = PLAN_CONFIG[(localSub.name || "growth").toLowerCase() as keyof typeof PLAN_CONFIG] || PLAN_CONFIG['growth'];
        }
    } else {
        try {
            trialDays = Math.ceil(await checkTrialDays(session));
            const billingCheck = await checkBilling({
                billing,
                onFailure: () => { throw new Error("no-active-plan"); },
            });

            if (billingCheck && billingCheck.appSubscriptions.length > 0) {
                const subscription = billingCheck.appSubscriptions[0];
                await syncSubscription(session, subscription.name, subscription.id, "", PLAN_CONFIG['growth'].trialDays);
                if (trialDays == -1) {
                    trialDays = PLAN_CONFIG['growth'].trialDays;
                }
                plan = PLAN_CONFIG[((subscription.name || "growth").toLowerCase()) as keyof typeof PLAN_CONFIG];
            }
        } catch (error: any) {
            if (error?.message !== "no-active-plan") {
                console.error("Billing check error in sync", error);
            }
        }
    }

    let config = await prisma.storeConfig.findUnique({
        where: { shop: session.shop },
    });

    if (config && !config.syncToken) {
        config = await prisma.storeConfig.update({
            where: { shop: session.shop },
            data: { syncToken: crypto.randomBytes(16).toString("hex") }
        });
    }

    const isConnected = !!config?.notionAccessToken;

    const productCount = await prisma.product.count({ where: { shop: session.shop } });
    const collectionCount = await prisma.collection.count({ where: { shop: session.shop } });
    const customerCount = await prisma.customer.count({ where: { shop: session.shop } });
    const orderCount = await prisma.order.count({ where: { shop: session.shop } });

    // Get Notion sync status
    const status = await prisma.notionSyncStatus.findUnique({
        where: { shop: session.shop },
    });

    // Get Shopify index status for progress tracking
    const indexStatus = await prisma.indexStatus.findUnique({
        where: { shop: session.shop },
    });

    const isSuccess = url.searchParams.get("success") === "1";
    const authError = url.searchParams.get("error");

    const clientId = process.env.NOTION_CLIENT_ID;
    const redirectUri = process.env.NOTION_REDIRECT_URI;

    const encryptedState = encrypt(session.shop);
    const notionAuthUrl = clientId && redirectUri
        ? `https://api.notion.com/v1/oauth/authorize?client_id=${clientId}&response_type=code&owner=user&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(encryptedState)}`
        : "";

    return json({
        appStore: isAppStore(),
        plan,
        days: trialDays,
        status: status || {
            id: "",
            shop: session.shop,
            status: "idle",
            lastSyncedAt: null,
            lastProductsSyncedAt: null,
            lastCollectionsSyncedAt: null,
            lastCustomersSyncedAt: null,
            lastOrdersSyncedAt: null,
            productsCount: 0,
            collectionsCount: 0,
            customersCount: 0,
            ordersCount: 0,
            totalProducts: 0,
            totalCollections: 0,
            totalCustomers: 0,
            totalOrders: 0,
            errorMessage: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
        indexStatus,
        isConnected,
        isSuccess,
        authError,
        notionAuthUrl,
        cachedConnections: {
            parentPageId: config?.notionParentPageId || null,
            productsDbId: config?.notionProductsDbId || null,
            variantsDbId: config?.notionVariantsDbId || null,
            collectionsDbId: config?.notionCollectionsDbId || null,
            customersDbId: config?.notionCustomersDbId || null,
            ordersDbId: config?.notionOrdersDbId || null,
        },
        dbCounts: {
            products: productCount,
            collections: collectionCount,
            customers: customerCount,
            orders: orderCount
        },
        webhookUrl: buildAppUrl(`api/notion/sync-order/${config?.syncToken || ''}`),
        productWebhookUrl: buildAppUrl(`api/notion/sync-product/${config?.syncToken || ''}`),
        customerWebhookUrl: buildAppUrl(`api/notion/sync-customer/${config?.syncToken || ''}`),
        variantWebhookUrl: buildAppUrl(`api/notion/sync-variant/${config?.syncToken || ''}`),
        fulfillOrderUrl: buildAppUrl(`action/${config?.syncToken || ''}/order/" + prop("ID") + "/fulfill/`),
        cancelOrderUrl: buildAppUrl(`action/${config?.syncToken || ''}/order/" + prop("ID") + "/cancel/`),
        resendOrderUrl: buildAppUrl(`action/${config?.syncToken || ''}/order/" + prop("ID") + "/resend/`)
    });
}

export async function action({ request }: ActionFunctionArgs) {
    if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, { status: 405 });
    }

    const { admin, session } = await authenticate.admin(request);

    if (!session || !session.shop) {
        return json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { action: actionType } = body;

    if (actionType === "disconnect") {
        await prisma.storeConfig.update({
            where: { shop: session.shop },
            data: {
                notionAccessToken: null,
                notionWorkspaceId: null,
                notionParentPageId: null,
                notionProductsDbId: null,
                notionVariantsDbId: null,
                notionCollectionsDbId: null,
                notionCustomersDbId: null,
                notionOrdersDbId: null,
            }
        });
        
        await prisma.notionSyncStatus.updateMany({
            where: { shop: session.shop },
            data: { 
                status: "idle", 
                errorMessage: null,
                lastSyncedAt: null,
                lastProductsSyncedAt: null,
                lastCollectionsSyncedAt: null,
                lastCustomersSyncedAt: null,
                lastOrdersSyncedAt: null,
                productsCount: 0,
                collectionsCount: 0,
                customersCount: 0,
                ordersCount: 0,
                totalProducts: 0,
                totalCollections: 0,
                totalCustomers: 0,
                totalOrders: 0
            }
        });
        
        await prisma.indexStatus.updateMany({
            where: { shop: session.shop },
            data: { 
                status: "idle", 
                errorMessage: null,
                productsCount: 0,
                collectionsCount: 0,
                customersCount: 0,
                ordersCount: 0,
                totalProducts: 0,
                totalCollections: 0,
                totalCustomers: 0,
                totalOrders: 0,
                lastProductsIndexedAt: null,
                lastCollectionsIndexedAt: null,
                lastCustomersIndexedAt: null,
                lastOrdersIndexedAt: null
            }
        });

        // Clear all Notion last edited timestamps so a new sync starts fresh
        await prisma.product.updateMany({ where: { shop: session.shop }, data: { notionLastEditedAt: null } });
        await prisma.variant.updateMany({ where: { product: { shop: session.shop } }, data: { notionLastEditedAt: null } });
        await prisma.collection.updateMany({ where: { shop: session.shop }, data: { notionLastEditedAt: null } });
        await prisma.customer.updateMany({ where: { shop: session.shop }, data: { notionLastEditedAt: null } });
        await prisma.order.updateMany({ where: { shop: session.shop }, data: { notionLastEditedAt: null } });

        return redirect("/app/sync");
    }

    if (actionType === "regenerate_token") {
        // the key is in every Notion webhook and action link: a new one revokes access for anyone who saw the old links
        await prisma.storeConfig.update({
            where: { shop: session.shop },
            data: { syncToken: crypto.randomBytes(16).toString("hex") }
        });
        return json({ success: true, tokenRegenerated: true });
    }

    if (actionType === "dismissError") {
        await prisma.notionSyncStatus.updateMany({
            where: { shop: session.shop },
            data: { status: "idle", errorMessage: null }
        });
        await prisma.indexStatus.updateMany({
            where: { shop: session.shop },
            data: { status: "idle", errorMessage: null }
        });
        return json({ success: true });
    }

    if (actionType === "unlinkDatabase") {
        const { dbKey } = body;
        if (["notionProductsDbId", "notionVariantsDbId", "notionCollectionsDbId", "notionCustomersDbId", "notionOrdersDbId", "notionParentPageId"].includes(dbKey)) {
            await prisma.storeConfig.update({
                where: { shop: session.shop },
                data: { [dbKey]: null }
            });
            return json({ success: true, message: `Unlinked ${dbKey}` });
        }
        return json({ error: "Invalid dbKey" }, { status: 400 });
    }

    if (actionType === "index") {
        try {
            const limits = await getPlanLimits(session.shop);

            const totalProducts = await prisma.product.count({ where: { shop: session.shop } });
            const totalCollections = await prisma.collection.count({ where: { shop: session.shop } });
            const totalCustomers = await prisma.customer.count({ where: { shop: session.shop } });
            const totalOrders = await prisma.order.count({ where: { shop: session.shop } });

            await prisma.notionSyncStatus.upsert({
                where: { shop: session.shop },
                update: { status: "indexing_shopify", errorMessage: null, productsCount: 0, collectionsCount: 0, customersCount: 0, ordersCount: 0, totalProducts, totalCollections, totalCustomers, totalOrders },
                create: { shop: session.shop, status: "indexing_shopify", productsCount: 0, collectionsCount: 0, customersCount: 0, ordersCount: 0, totalProducts, totalCollections, totalCustomers, totalOrders }
            });

            await prisma.indexStatus.upsert({
                where: { shop: session.shop },
                update: { status: "indexing", errorMessage: null, productsCount: 0, collectionsCount: 0, customersCount: 0, ordersCount: 0 },
                create: { shop: session.shop, status: "indexing", productsCount: 0, collectionsCount: 0, customersCount: 0, ordersCount: 0 }
            });

            indexAllShopifyData(admin, session.shop, { maxItems: limits.maxItems, maxOrders: limits.maxOrders }).then(async (result) => {
                if (result.success) {
                    await prisma.notionSyncStatus.update({
                        where: { shop: session.shop },
                        data: { status: "syncing", errorMessage: null }
                    });
                    syncToNotion(session.shop).catch(async (e) => {
                        console.error("Notion Sync process failed:", e);
                        await prisma.notionSyncStatus.update({
                            where: { shop: session.shop },
                            data: { status: "error", errorMessage: e.message }
                        });
                    });
                } else {
                    await prisma.notionSyncStatus.update({
                        where: { shop: session.shop },
                        data: {
                            status: "error",
                            errorMessage: result.message
                        }
                    });
                }
            }).catch(async (e) => {
                console.error("Index process failed:", e);
                await prisma.notionSyncStatus.update({
                    where: { shop: session.shop },
                    data: { status: "error", errorMessage: e.message }
                });
            });

            return json({ success: true, message: "Indexing started" });
        } catch (error) {
            console.error("Indexing start error:", error);
            return json(
                {
                    success: false,
                    error: error instanceof Error ? error.message : "Unknown error",
                },
                { status: 500 }
            );
        }
    }

    if (actionType === "sync") {
        try {
            const limits = await getPlanLimits(session.shop);

            const totalProducts = await prisma.product.count({ where: { shop: session.shop } });
            const totalCollections = await prisma.collection.count({ where: { shop: session.shop } });
            const totalCustomers = await prisma.customer.count({ where: { shop: session.shop } });
            const totalOrders = await prisma.order.count({ where: { shop: session.shop } });

            // Update Notion sync status to indicate we are syncing
            await prisma.notionSyncStatus.upsert({
                where: { shop: session.shop },
                update: { status: "syncing", errorMessage: null, productsCount: 0, collectionsCount: 0, customersCount: 0, ordersCount: 0, totalProducts, totalCollections, totalCustomers, totalOrders },
                create: { shop: session.shop, status: "syncing", productsCount: 0, collectionsCount: 0, customersCount: 0, ordersCount: 0, totalProducts, totalCollections, totalCustomers, totalOrders }
            });

            // Start Notion sync process without awaiting
            syncToNotion(session.shop).catch(async (e) => {
                console.error("Notion Sync process failed:", e);
                await prisma.notionSyncStatus.update({
                    where: { shop: session.shop },
                    data: { status: "error", errorMessage: e.message }
                });
            });

            return json({ success: true, message: "Sync started" });
        } catch (error) {
            console.error("Sync start error:", error);
            return json(
                {
                    success: false,
                    error: error instanceof Error ? error.message : "Unknown error",
                },
                { status: 500 }
            );
        }
    }

    if (actionType === "resume_sync") {
        try {
            // Update Notion sync status to indicate we are syncing but keep counts
            await prisma.notionSyncStatus.update({
                where: { shop: session.shop },
                data: { status: "syncing", errorMessage: null }
            });

            // Start Notion sync process in RESUME mode without awaiting
            syncToNotion(session.shop, true).catch(async (e) => {
                console.error("Notion Sync process failed:", e);
                await prisma.notionSyncStatus.update({
                    where: { shop: session.shop },
                    data: { status: "error", errorMessage: e.message }
                });
            });

            return json({ success: true, message: "Sync resumed" });
        } catch (error) {
            console.error("Sync resume error:", error);
            return json(
                {
                    success: false,
                    error: error instanceof Error ? error.message : "Unknown error",
                },
                { status: 500 }
            );
        }
    }

    if (actionType === "cancel_sync") {
        try {
            await prisma.notionSyncStatus.update({
                where: { shop: session.shop },
                data: { status: "cancelling" }
            });
            return json({ success: true, message: "Cancelling sync..." });
        } catch (error) {
            return json({ success: false, error: "Failed to cancel" }, { status: 500 });
        }
    }

    if (actionType === "index_entity") {
        const entity = body.entity as string;
        const indexFnMap: Record<string, (admin: any, shop: string, limit: number, onProgress?: (count: number) => Promise<void>) => Promise<any>> = {
            products: indexShopifyProducts,
            collections: indexShopifyCollections,
            customers: indexShopifyCustomers,
            orders: indexShopifyOrders,
        };
        const indexFn = indexFnMap[entity];
        if (!indexFn) return json({ error: "Unknown entity" }, { status: 400 });
        try {
            const limits = await getPlanLimits(session.shop);
            await prisma.notionSyncStatus.upsert({
                where: { shop: session.shop },
                update: { status: "indexing_shopify", errorMessage: null },
                create: { shop: session.shop, status: "indexing_shopify" }
            });
            await prisma.indexStatus.upsert({
                where: { shop: session.shop },
                update: { [`${entity}Count`]: 0, status: "indexing", errorMessage: null },
                create: { shop: session.shop, [`${entity}Count`]: 0, status: "indexing", errorMessage: null }
            });

            const updateProgress = async (count: number) => {
                await prisma.indexStatus.update({
                    where: { shop: session.shop },
                    data: { [`${entity}Count`]: count }
                });
            };

            indexFn(admin, session.shop, limits.maxItems, updateProgress).then(async () => {
                await prisma.notionSyncStatus.update({ where: { shop: session.shop }, data: { status: "idle" } });
                await prisma.indexStatus.update({ where: { shop: session.shop }, data: { status: "idle" } });
            }).catch(async (e: Error) => {
                await prisma.notionSyncStatus.update({ where: { shop: session.shop }, data: { status: "error", errorMessage: e.message } });
            });
            return json({ success: true, message: `Indexing ${entity} started` });
        } catch (error) {
            return json({ success: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
        }
    }

    if (actionType === "sync_entity") {
        const entity = body.entity as string;
        const validEntities = ["products", "collections", "customers", "orders"];
        if (!validEntities.includes(entity)) return json({ error: "Unknown entity" }, { status: 400 });
        try {
            let totalItems = 0;
            switch (entity) {
                case "products": totalItems = await prisma.product.count({ where: { shop: session.shop } }); break;
                case "collections": totalItems = await prisma.collection.count({ where: { shop: session.shop } }); break;
                case "customers": totalItems = await prisma.customer.count({ where: { shop: session.shop } }); break;
                case "orders": totalItems = await prisma.order.count({ where: { shop: session.shop } }); break;
            }
            
            await prisma.notionSyncStatus.upsert({
                where: { shop: session.shop },
                update: { status: "syncing", errorMessage: null, [`${entity}Count`]: 0, [`total${entity.charAt(0).toUpperCase() + entity.slice(1)}`]: totalItems },
                create: { shop: session.shop, status: "syncing", [`${entity}Count`]: 0, [`total${entity.charAt(0).toUpperCase() + entity.slice(1)}`]: totalItems }
            });
            syncEntityToNotion(session.shop, entity as any).catch(async (e: Error) => {
                await prisma.notionSyncStatus.update({ where: { shop: session.shop }, data: { status: "error", errorMessage: e.message } });
            });
            return json({ success: true, message: `Syncing ${entity} to Notion` });
        } catch (error) {
            return json({ success: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
        }
    }

    if (actionType === "clear_index") {
        try {
            await prisma.order.deleteMany({ where: { shop: session.shop } });
            await prisma.customer.deleteMany({ where: { shop: session.shop } });
            await prisma.product.deleteMany({ where: { shop: session.shop } });
            await prisma.collection.deleteMany({ where: { shop: session.shop } });
            
            await prisma.indexStatus.deleteMany({
                where: { shop: session.shop }
            });
            await prisma.notionSyncStatus.deleteMany({
                where: { shop: session.shop }
            });

            return json({ success: true, message: "Local index cleared" });
        } catch (error) {
            return json({ success: false, error: "Failed to clear index" }, { status: 500 });
        }
    }

    return json({ error: "Invalid action" }, { status: 400 });
}

export default function NotionSyncPage() {
    const data = useLoaderData<typeof loader>();
    const fetcher = useFetcher();
    const submit = fetcher.submit;
    const status = data.status;
    const indexStatus = data.indexStatus;
    const dbCounts = data.dbCounts;
    const cachedConnections = data.cachedConnections;
    const webhookUrl = data.webhookUrl;
    const productWebhookUrl = data.productWebhookUrl;
    const customerWebhookUrl = data.customerWebhookUrl;
    const variantWebhookUrl = data.variantWebhookUrl;
    const cancelOrderUrl = data.cancelOrderUrl;
    const fulfillOrderUrl = data.fulfillOrderUrl;
    const resendOrderUrl = data.resendOrderUrl;

    const [showSplash, setShowSplash] = useState(data.isSuccess);
    const [fadeSplash, setFadeSplash] = useState(false);
    const [isDisconnectModalOpen, setIsDisconnectModalOpen] = useState(false);
    const [isClearModalOpen, setIsClearModalOpen] = useState(false);
    const [unlinkDbKey, setUnlinkDbKey] = useState<string | null>(null);

    const revalidator = useRevalidator();
    const shopify = useAppBridge();
    const isProcessing = status.status === "syncing" || status.status === "indexing_shopify";

    type EntityKey = "products" | "collections" | "customers" | "orders"; 
    const [openDropdown, setOpenDropdown] = useState<EntityKey | null>(null);
    const toggleDropdown = useCallback((key: EntityKey) => {
        setOpenDropdown((prev) => (prev === key ? null : key));
    }, []);

    const [copiedItem, setCopiedItem] = useState<string | null>(null);

    const handleCopy = useCallback((text: string, itemName: string) => {
        navigator.clipboard.writeText(text);
        setCopiedItem(itemName);
        setTimeout(() => setCopiedItem(null), 2000); // Reset after 2 seconds
    }, []);

    const [selectedTab, setSelectedTab] = useState(0);
    const handleTabChange = useCallback(
        (selectedTabIndex: number) => setSelectedTab(selectedTabIndex),
        [],
    );

    // Check for review request 1 hour after syncing finishes
    useEffect(() => {
        const lastFinishedTime = indexStatus?.lastIndexedAt || status.lastSyncedAt;
        if (!lastFinishedTime || isProcessing) return;

        const oneHourMs = 60 * 60 * 1000;
        const timeSinceFinished = Date.now() - new Date(lastFinishedTime).getTime();

        if (timeSinceFinished >= oneHourMs) {
            const hasRequested = localStorage.getItem('reviewRequested');
            if (!hasRequested) {
                // Temporarily disable review request to see if it fixes the mobile freeze
                const requestReview = async () => {
                    try {
                        const result = await shopify.reviews.request();
                        if (!result?.success) {
                            console.log(`Review modal not displayed. Reason: ${result?.code}: ${result?.message}`);
                        }
                        localStorage.setItem('reviewRequested', 'true');
                    } catch (error) {
                        console.error('Error requesting review:', error);
                    }
                };
                requestReview();
            }
        }
    }, [indexStatus?.lastIndexedAt, status.lastSyncedAt, isProcessing, shopify]);

    // Auto-refresh when syncing is in progress
    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (isProcessing) {
            interval = setInterval(() => {
                revalidator.revalidate();
            }, 2000);
        }
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [isProcessing, revalidator]);

    useEffect(() => {
        if (data.isSuccess && data.isConnected) {
            const timer = setTimeout(() => {
                setFadeSplash(true);
                setTimeout(() => setShowSplash(false), 500); // 500ms fade transition
            }, 2500); // Show splash for 2.5s
            return () => clearTimeout(timer);
        }
    }, [data.isSuccess, data.isConnected]);

    // If not connected, or if we are showing the success splash screen
    if (!data.isConnected || showSplash) {
        return (
            <Page>
                <div className="notion-login-container" style={data.isConnected && showSplash ? { opacity: fadeSplash ? 0 : 1, transition: 'opacity 0.5s ease-in-out' } : undefined}>
                    <SyncAnimation />


                    {data.isConnected ? (
                        <>
                            <div className="notion-badge-connected">✓ Connected to Notion</div>
                            <h1 className="notion-title">Your workspace is linked.</h1>
                            <p className="notion-subtitle">Setting up your databases...</p>
                        </>
                    ) : (
                        <>
                            {data.authError === 'no_page_selected' && (
                                <div style={{ marginBottom: '16px', textAlign: 'left' }}>
                                    <Banner tone="critical" title="No Notion page linked">
                                        <p>Please ensure you select at least one page when connecting your Notion account.</p>
                                    </Banner>
                                </div>
                            )}
                            <h1 className="notion-title">Your workspace.</h1>
                            <p className="notion-subtitle">Connect your Notion account</p>
                            <a href={data.notionAuthUrl} target="_top" className="notion-button-blue">Continue</a>
                        </>
                    )}
                </div>
            </Page>
        );
    }

    const isIndexing = status.status === "indexing_shopify";
    const lastSynced = status.lastSyncedAt
        ? new Date(status.lastSyncedAt).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        })
        : "Never";

    // Calculate progress percentage
    let progressPercentage = 0;
    if (status.status === "syncing") {
        const current = (status.productsCount || 0) + (status.collectionsCount || 0) + (status.customersCount || 0) + (status.ordersCount || 0);
        const total = (status.totalProducts || 0) + (status.totalCollections || 0) + (status.totalCustomers || 0) + (status.totalOrders || 0);
        if (total > 0) {
            let percentage = Math.min(100, (current / Math.max(total, current)) * 100);
            progressPercentage = percentage;
        } else {
            // Fallback if syncing an empty store
            progressPercentage = 100; 
        }
    } else if (isIndexing && indexStatus) {
        const current = (indexStatus.productsCount || 0) + (indexStatus.collectionsCount || 0) + (indexStatus.customersCount || 0) + (indexStatus.ordersCount || 0);
        const total = (indexStatus.totalProducts || 0) + (indexStatus.totalCollections || 0) + (indexStatus.totalCustomers || 0) + (indexStatus.totalOrders || 0);
        if (total > 0) {
            let percentage = Math.min(100, (current / Math.max(total, current)) * 100);
            progressPercentage = percentage;
        } else {
            // Shopify doesn't give us total counts upfront, so we grow the bar logarithmically as items stream in
            // Starts at 5%, grows by chunks, caps at 95% until finished
            progressPercentage = Math.min(95, 5 + Math.floor(current / 10)); 
        }
    }

    const currentSynced = (status.productsCount || 0) + (status.collectionsCount || 0) + (status.customersCount || 0) + (status.ordersCount || 0);
    const totalToSync = (dbCounts.products || 0) + (dbCounts.collections || 0) + (dbCounts.customers || 0) + (dbCounts.orders || 0);
    const finalProgressPercentage = totalToSync > 0 ? Math.min(100, (currentSynced / totalToSync) * 100) : 100;

    const handleUnlinkDatabase = (dbKey: string) => {
        setUnlinkDbKey(dbKey);
    };

    const confirmUnlinkDatabase = () => {
        if (unlinkDbKey) {
            fetcher.submit(
                { action: "unlinkDatabase", dbKey: unlinkDbKey },
                { method: "POST", encType: "application/json" }
            );
            setUnlinkDbKey(null);
        }
    };

    const isIndexDone = !!(indexStatus && dbCounts.products > 0);

    const entityConfig: { key: EntityKey; label: string; dbCount: number; syncedCount: number; lastIndexedAt: string | null; lastSyncedAt: string | null }[] = [
        { key: "products", label: "Products", dbCount: dbCounts.products, syncedCount: status.productsCount, lastIndexedAt: indexStatus?.lastProductsIndexedAt || null, lastSyncedAt: status.lastProductsSyncedAt || null },
        { key: "collections", label: "Collections", dbCount: dbCounts.collections, syncedCount: status.collectionsCount, lastIndexedAt: indexStatus?.lastCollectionsIndexedAt || null, lastSyncedAt: status.lastCollectionsSyncedAt || null },
        { key: "orders", label: "Orders", dbCount: dbCounts.orders, syncedCount: status.ordersCount, lastIndexedAt: indexStatus?.lastOrdersIndexedAt || null, lastSyncedAt: status.lastOrdersSyncedAt || null },
        { key: "customers", label: "Customers", dbCount: dbCounts.customers, syncedCount: status.customersCount, lastIndexedAt: indexStatus?.lastCustomersIndexedAt || null, lastSyncedAt: status.lastCustomersSyncedAt || null },
    ];



    return (
        <Page title="Notion Data Sync">
            <BlockStack gap="500">
                {!data.appStore ? null : !data.plan ? (
                    <Banner title="Free Plan Active" tone="info" action={{ content: 'Upgrade', url: '/app/pricing' }}>
                        <p>You are currently on the Free Plan. Syncing is limited to 10 items (products, collections, orders, customers). Please upgrade to unlock more.</p>
                    </Banner>
                ) : (
                    <Card>
                        <BlockStack gap="400">
                            <InlineStack align="space-between" blockAlign="center">
                                <Text as="h2" variant="headingMd">Plan Usage & Limits ({data.plan.name})</Text>
                                <Button url="/app/pricing" variant="primary">Upgrade Plan</Button>
                            </InlineStack>
                            <Grid>
                                <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 6, xl: 6 }}>
                                    <BlockStack gap="200">
                                        <InlineStack align="space-between">
                                            <Text as="p" tone="subdued">Products & Items</Text>
                                            <Text as="p" tone="subdued">{dbCounts.products} / {data.plan.maxItems}</Text>
                                        </InlineStack>
                                        <ProgressBar progress={Math.min(100, (dbCounts.products / data.plan.maxItems) * 100)} tone={dbCounts.products >= data.plan.maxItems ? "critical" : "primary"} size="small" />
                                    </BlockStack>
                                </Grid.Cell>
                                <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 6, xl: 6 }}>
                                    <BlockStack gap="200">
                                        <InlineStack align="space-between">
                                            <Text as="p" tone="subdued">Orders</Text>
                                            <Text as="p" tone="subdued">{dbCounts.orders} / {data.plan.maxOrders}</Text>
                                        </InlineStack>
                                        <ProgressBar progress={Math.min(100, (dbCounts.orders / data.plan.maxOrders) * 100)} tone={dbCounts.orders >= data.plan.maxOrders ? "critical" : "primary"} size="small" />
                                    </BlockStack>
                                </Grid.Cell>
                            </Grid>
                        </BlockStack>
                    </Card>
                )}
                {(status.status === "error" || indexStatus?.errorMessage) && (
                    <Banner title="Sync Error" tone="critical" onDismiss={() => submit({ action: "dismissError" }, { method: "post", encType: "application/json" })}>
                        <BlockStack gap="200">
                            <Text as="p">{status.status === "error" && status.errorMessage ? status.errorMessage : indexStatus?.errorMessage}</Text>
                        </BlockStack>
                    </Banner>
                )}

                <Layout>
                    <Layout.Section>
                        <Card>
                            <BlockStack gap="500">
                                <BlockStack gap="100">
                                    <InlineStack align="space-between" blockAlign="center">
                                        <Text as="h1" variant="headingLg">
                                            Sync to Notion
                                        </Text>
                                        <Box>
                                            {status.status === "idle" && status.lastSyncedAt ? (
                                                <InlineStack gap="100" blockAlign="center">
                                                    <Icon source={CheckCircleIcon} tone="success" />
                                                    <Text as="span" tone="success">Ready</Text>
                                                </InlineStack>
                                            ) : status.status === "error" ? (
                                                <InlineStack gap="100" blockAlign="center">
                                                    <Icon source={XCircleIcon} tone="critical" />
                                                    <Text as="span" tone="critical">Error</Text>
                                                </InlineStack>
                                            ) : null}
                                        </Box>
                                    </InlineStack>
                                    <Text as="p" tone="subdued">
                                        Push your Shopify products and collections to your Notion workspace
                                    </Text>
                                </BlockStack>

                                <Divider />

                                <BlockStack gap="300">
                                    <BlockStack gap="100">
                                        <Text as="h2" variant="headingMd">
                                            Current Sync Status
                                        </Text>
                                        <Text as="p" tone="subdued" variant="bodySm">
                                            Last synced: <strong>{lastSynced}</strong>
                                        </Text>
                                    </BlockStack>

                                    {isProcessing || (status.status === "idle" && status.lastSyncedAt && !(dbCounts.products === 0 && dbCounts.collections === 0 && dbCounts.customers === 0 && dbCounts.orders === 0)) ? (
                                        <Box background={isProcessing ? "bg-surface-info" : (finalProgressPercentage < 100 ? "bg-surface-critical" : "bg-surface-success")} padding="300" borderRadius="200">
                                            <BlockStack gap="200">
                                                <InlineStack align="start" blockAlign="center" gap="200">
                                                    <Text as="span" tone="base">{isProcessing ? "⏳" : (finalProgressPercentage < 100 ? "⚠️" : "✅")}</Text>
                                                    <Text as="p" tone={isProcessing ? "base" : (finalProgressPercentage < 100 ? "critical" : "success")} fontWeight={isProcessing ? "regular" : "bold"}>
                                                        {isProcessing ? (
                                                            isIndexing
                                                                ? `Phase 1 of 2: Fetching data from Shopify (${indexStatus?.productsCount || 0} products, ${indexStatus?.collectionsCount || 0} collections, ${indexStatus?.customersCount || 0} customers, ${indexStatus?.ordersCount || 0} orders)`
                                                                : `Phase 2 of 2: Pushing to Notion (${status.productsCount} products, ${(status as any).variantsCount || 0} variants, ${status.collectionsCount} collections, ${status.customersCount} customers, ${status.ordersCount} orders)`
                                                        ) : (
                                                            finalProgressPercentage < 100 ? "Sync Incomplete" : "Index & Sync Complete!"
                                                        )}
                                                    </Text>
                                                </InlineStack>
                                                {isProcessing ? (
                                                    <ProgressBar progress={progressPercentage} size="small" />
                                                ) : (
                                                    <ProgressBar progress={finalProgressPercentage} size="small" tone={finalProgressPercentage < 100 ? "critical" : "success"} />
                                                )}
                                                <Text as="p" variant="bodySm" tone={isProcessing ? "subdued" : (finalProgressPercentage < 100 ? "critical" : "success")}>
                                                    {isProcessing 
                                                        ? `${Math.round(progressPercentage)}% complete` 
                                                        : finalProgressPercentage < 100
                                                            ? `${Math.round(finalProgressPercentage)}% complete. The sync was interrupted or encountered an error before finishing.`
                                                            : "100% complete. All your Shopify data has been successfully pushed to your Notion workspace and is up to date."
                                                    }
                                                </Text>
                                            </BlockStack>
                                        </Box>
                                    ) : null}

                                    {!isProcessing && (!status.lastSyncedAt || (dbCounts.products === 0 && dbCounts.collections === 0 && dbCounts.customers === 0 && dbCounts.orders === 0)) && (
                                        <Box background="bg-surface-caution" padding="300" borderRadius="200">
                                            <InlineStack align="start" blockAlign="center" gap="200">
                                                <Text as="span">ℹ️</Text>
                                                <Text as="p">No data synced to Notion yet. Click "Start Sync" to begin.</Text>
                                            </InlineStack>
                                        </Box>
                                    )}
                                </BlockStack>

                                <Grid columns={{ xs: 1, md: 2, lg: 4 }}>
                                    {entityConfig.map(({ key, label, dbCount, syncedCount, lastIndexedAt, lastSyncedAt }) => (
                                        <Grid.Cell key={key}>
                                            <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                                                <BlockStack gap="200">
                                                    <Text as="h3" variant="headingMd">{label}</Text>
                                                    <Text as="p" variant="bodyMd"><strong>{dbCount}</strong> in Database</Text>
                                                    <Text as="p" tone="subdued" variant="bodySm">{syncedCount} pushed to Notion</Text>
                                                    <Popover
                                                        active={openDropdown === key}
                                                        activator={
                                                            <Button
                                                                size="slim"
                                                                disclosure
                                                                onClick={() => toggleDropdown(key)}
                                                                disabled={isProcessing}
                                                            >
                                                                Actions
                                                            </Button>
                                                        }
                                                        onClose={() => setOpenDropdown(null)}
                                                    >
                                                        <ActionList
                                                            actionRole="menuitem"
                                                            items={[
                                                                {
                                                                    content: "Reindex from Shopify",
                                                                    onAction: () => {
                                                                        setOpenDropdown(null);
                                                                        fetcher.submit(
                                                                            { action: "index_entity", entity: key },
                                                                            { method: "POST", encType: "application/json" }
                                                                        );
                                                                    },
                                                                },
                                                                {
                                                                    content: "Push to Notion",
                                                                    disabled: !isIndexDone,
                                                                    helpText: !isIndexDone ? "Index data first" : undefined,
                                                                    onAction: () => {
                                                                        setOpenDropdown(null);
                                                                        fetcher.submit(
                                                                            { action: "sync_entity", entity: key },
                                                                            { method: "POST", encType: "application/json" }
                                                                        );
                                                                    },
                                                                },
                                                            ]}
                                                        />
                                                    </Popover>
                                                </BlockStack>
                                            </Box>
                                        </Grid.Cell>
                                    ))}
                                </Grid>

                                <Divider />

                                <BlockStack gap="200">
                                    <InlineStack gap="200">
                                        <Button
                                            variant="primary"
                                            size="large"
                                            onClick={() => {
                                                fetcher.submit(
                                                    { action: "index" },
                                                    { method: "POST", encType: "application/json" }
                                                );
                                            }}
                                            loading={isIndexing}
                                            disabled={isProcessing}
                                        >
                                            Fetch & Sync to Notion
                                        </Button>
                                        {isProcessing && (
                                            <>
                                                <Button
                                                    variant="primary"
                                                    tone="success"
                                                    size="large"
                                                    onClick={() => {
                                                        fetcher.submit(
                                                            { action: "resume_sync" },
                                                            { method: "POST", encType: "application/json" }
                                                        );
                                                    }}
                                                >
                                                    Force Resume
                                                </Button>
                                                <Button
                                                    variant="primary"
                                                    tone="critical"
                                                    size="large"
                                                    onClick={() => {
                                                        fetcher.submit(
                                                            { action: "cancel_sync" },
                                                            { method: "POST", encType: "application/json" }
                                                        );
                                                    }}
                                                    disabled={status.status === "cancelling"}
                                                >
                                                    {status.status === "cancelling" ? "Cancelling..." : "Cancel"}
                                                </Button>
                                            </>
                                        )}
                                    </InlineStack>
                                    <InlineStack align="space-between" blockAlign="center">
                                        <Text as="p" variant="bodySm" tone="subdued">
                                            This will find or create 5 databases in your Notion workspace.
                                        </Text>
                                        {!isProcessing && (
                                            <Button
                                                size="slim"
                                                onClick={() => {
                                                    setIsClearModalOpen(true);
                                                }}
                                                disabled={isProcessing}
                                                tone="critical"
                                                variant="plain"
                                            >
                                                Clear Local Index
                                            </Button>
                                        )}
                                    </InlineStack>
                                </BlockStack>
                            </BlockStack>
                        </Card>



                        <BlockStack gap="400">
                            <Divider />
                            <Box paddingBlockStart="400" paddingInlineStart="400">
                                <Text as="h2" variant="headingMd">Two-Way Sync (Notion ➡️ Shopify) Setup</Text>
                            </Box>
                            <Banner
                                tone="info"
                                title="Keep these links private"
                                action={{
                                    content: "Generate a new secret key",
                                    onAction: () => {
                                        if (window.confirm("Generate a new secret key? All current webhook and button links stop working, and you'll need to update them in your Notion automations and formulas.")) {
                                            submit({ action: "regenerate_token" }, { method: "post", encType: "application/json" });
                                        }
                                    },
                                }}
                            >
                                <p>
                                    The links below contain your secret key. Anyone who has them can update products and cancel or fulfill orders. If someone you don't
                                    trust has seen them, generate a new key, then update the links in Notion.
                                </p>
                            </Banner>
                            <BlockStack>
                                <Tabs
                                    tabs={[
                                        { id: 'orders', content: 'Orders', panelID: 'panel-orders' },
                                        { id: 'products', content: 'Products', panelID: 'panel-products' },
                                        { id: 'variants', content: 'Variants', panelID: 'panel-variants' },
                                        { id: 'customers', content: 'Customers', panelID: 'panel-customers' },
                                    ]}
                                    selected={selectedTab}
                                    onSelect={handleTabChange}
                                />
                                <Card>

                                    <BlockStack gap="400">


                                        {selectedTab === 0 && (
                                            <BlockStack gap="600">
                                                <BlockStack gap="400">
                                                    <Text as="h3" variant="headingSm">Order Two-Way Sync Webhook</Text>
                                                    <Text as="p" tone="subdued">
                                                        Add Tags and Order Note directly from Notion!
                                                        Simply create a Notion Database Automation, set its action to "Send Webhook", and paste your unique secure Webhook URL below. <strong>Don't forget to select all fields.</strong>
                                                    </Text>
                                                    <BlockStack gap="100">
                                                        <InlineStack wrap={false} gap="200" blockAlign="center">
                                                            <div style={{ flexGrow: 1 }}>
                                                                <TextField
                                                                    labelHidden
                                                                    label="Action Webhook URL"
                                                                    value={webhookUrl}
                                                                    readOnly
                                                                    autoComplete="off"
                                                                />
                                                            </div>
                                                            <Button
                                                                icon={copiedItem === "SyncOrder" ? CheckIcon : ClipboardIcon}
                                                                onClick={() => handleCopy(webhookUrl, "SyncOrder")}
                                                                tone={copiedItem === "SyncOrder" ? "success" : undefined}
                                                            >
                                                                {copiedItem === "SyncOrder" ? "Copied" : "Copy"}
                                                            </Button>
                                                        </InlineStack>
                                                        <Text as="p" variant="bodySm" tone="subdued">
                                                            *This URL contains an encrypted token specifically for your store. Keep it private.
                                                        </Text>
                                                    </BlockStack>
                                                </BlockStack>

                                                <Divider />

                                                <BlockStack gap="400">
                                                    <Text as="h3" variant="headingSm">Order Actions (Notion Formulas)</Text>
                                                    <Text as="p" tone="subdued">
                                                        You can trigger interactive Shopify actions (Cancel, Fulfill, Resend Confirmation Email) directly from your Orders database.
                                                        Simply add a new Property to your Notion database, set its type to <strong>Formula</strong>, and paste the corresponding code below.
                                                    </Text>
                                                    <BlockStack gap="400">
                                                        {[
                                                            {
                                                                name: "Cancel Order",
                                                                id: "formulaCancel",
                                                                formula: `link("❌ Cancel", "${cancelOrderUrl}")`
                                                            },
                                                            {
                                                                name: "Fulfill Order",
                                                                id: "formulaFulfill",
                                                                formula: `link("📦 Fulfill", "${fulfillOrderUrl}")`
                                                            },
                                                            {
                                                                name: "Resend Email",
                                                                id: "formulaResend",
                                                                formula: `link("📧 Resend Email", "${resendOrderUrl}")`
                                                            }
                                                        ].map((actionItem) => {
                                                            const isCopied = copiedItem === actionItem.id;

                                                            return (
                                                                <BlockStack gap="100" key={actionItem.id}>
                                                                    <Text as="p" fontWeight="medium">
                                                                        {actionItem.name} Formula
                                                                    </Text>
                                                                    <InlineStack wrap={false} gap="200" blockAlign="center">
                                                                        <div style={{ flexGrow: 1 }}>
                                                                            <TextField
                                                                                labelHidden
                                                                                label={`${actionItem.name} Formula`}
                                                                                value={actionItem.formula}
                                                                                readOnly
                                                                                autoComplete="off"
                                                                            />
                                                                        </div>
                                                                        <Button
                                                                            icon={isCopied ? CheckIcon : ClipboardIcon}
                                                                            onClick={() => handleCopy(actionItem.formula, actionItem.id)}
                                                                            tone={isCopied ? "success" : undefined}
                                                                        >
                                                                            {isCopied ? "Copied" : "Copy"}
                                                                        </Button>
                                                                    </InlineStack>
                                                                </BlockStack>
                                                            );
                                                        })}
                                                    </BlockStack>

                                                    <Text as="p" variant="bodySm" tone="subdued">
                                                        *These links contain an encrypted token specifically for your store. Keep them private.
                                                    </Text>
                                                </BlockStack>
                                            </BlockStack>
                                        )}

                                        {selectedTab === 1 && (
                                            <BlockStack gap="400">
                                                <Text as="h3" variant="headingSm">Product Two-Way Sync Webhook</Text>
                                                <Text as="p" tone="subdued">
                                                    Sync Product Title, Tags, SEO Title, and SEO Description directly from Notion!
                                                    Simply create a Notion Database Automation on your Products database, set its action to "Send Webhook", and paste your unique secure Webhook URL below. <strong>Don't forget to select all fields.</strong>
                                                </Text>
                                                <BlockStack gap="100">
                                                    <InlineStack wrap={false} gap="200" blockAlign="center">
                                                        <div style={{ flexGrow: 1 }}>
                                                            <TextField
                                                                labelHidden
                                                                label="Product Webhook URL"
                                                                value={productWebhookUrl}
                                                                readOnly
                                                                autoComplete="off"
                                                            />
                                                        </div>
                                                        <Button
                                                            icon={copiedItem === "SyncProduct" ? CheckIcon : ClipboardIcon}
                                                            onClick={() => handleCopy(productWebhookUrl, "SyncProduct")}
                                                            tone={copiedItem === "SyncProduct" ? "success" : undefined}
                                                        >
                                                            {copiedItem === "SyncProduct" ? "Copied" : "Copy"}
                                                        </Button>
                                                    </InlineStack>
                                                    <Text as="p" variant="bodySm" tone="subdued">
                                                        *This URL contains an encrypted token specifically for your store. Keep it private.
                                                    </Text>
                                                </BlockStack>
                                            </BlockStack>
                                        )}

                                        {selectedTab === 2 && (
                                            <BlockStack gap="400">
                                                <Text as="h3" variant="headingSm">Variant Two-Way Sync Webhook</Text>
                                                <Text as="p" tone="subdued">
                                                    Sync Variant Price, Compare At Price, SKU, Barcode, Weight, and Inventory directly from Notion!
                                                    Simply create a Notion Database Automation on your Variants database, set its action to "Send Webhook", and paste your unique secure Webhook URL below. <strong>Don't forget to select all fields.</strong>
                                                </Text>
                                                <BlockStack gap="100">
                                                    <InlineStack wrap={false} gap="200" blockAlign="center">
                                                        <div style={{ flexGrow: 1 }}>
                                                            <TextField
                                                                labelHidden
                                                                label="Variant Webhook URL"
                                                                value={variantWebhookUrl}
                                                                readOnly
                                                                autoComplete="off"
                                                            />
                                                        </div>
                                                        <Button
                                                            icon={copiedItem === "SyncVariant" ? CheckIcon : ClipboardIcon}
                                                            onClick={() => handleCopy(variantWebhookUrl, "SyncVariant")}
                                                            tone={copiedItem === "SyncVariant" ? "success" : undefined}
                                                        >
                                                            {copiedItem === "SyncVariant" ? "Copied" : "Copy"}
                                                        </Button>
                                                    </InlineStack>
                                                    <Text as="p" variant="bodySm" tone="subdued">
                                                        *This URL contains an encrypted token specifically for your store. Keep it private.
                                                    </Text>
                                                </BlockStack>
                                            </BlockStack>
                                        )}

                                        {selectedTab === 3 && (
                                            <BlockStack gap="400">
                                                <Text as="h3" variant="headingSm">Customer Two-Way Sync Webhook</Text>
                                                <Text as="p" tone="subdued">
                                                    Sync Customer Tags directly from Notion!
                                                    Simply create a Notion Database Automation on your Customers database, set its action to "Send Webhook", and paste your unique secure Webhook URL below. <strong>Don't forget to select all fields.</strong>
                                                </Text>
                                                <BlockStack gap="100">
                                                    <InlineStack wrap={false} gap="200" blockAlign="center">
                                                        <div style={{ flexGrow: 1 }}>
                                                            <TextField
                                                                labelHidden
                                                                label="Customer Webhook URL"
                                                                value={customerWebhookUrl}
                                                                readOnly
                                                                autoComplete="off"
                                                            />
                                                        </div>
                                                        <Button
                                                            icon={copiedItem === "SyncCustomer" ? CheckIcon : ClipboardIcon}
                                                            onClick={() => handleCopy(customerWebhookUrl, "SyncCustomer")}
                                                            tone={copiedItem === "SyncCustomer" ? "success" : undefined}
                                                        >
                                                            {copiedItem === "SyncCustomer" ? "Copied" : "Copy"}
                                                        </Button>
                                                    </InlineStack>
                                                    <Text as="p" variant="bodySm" tone="subdued">
                                                        *This URL contains an encrypted token specifically for your store. Keep it private.
                                                    </Text>
                                                </BlockStack>
                                            </BlockStack>
                                        )}
                                    </BlockStack>
                                </Card>
                            </BlockStack>
                        </BlockStack>

                        <Box paddingBlockStart="400">
                            <Card>
                                <BlockStack gap="400">
                                    <Text as="h2" variant="headingMd">Connected Notion Databases</Text>
                                    <Text as="p" tone="subdued">
                                        The following databases are actively linked to your Notion workspace. You can unlink any connection to force the app to recreate and resync it to a brand new database on the next run.
                                    </Text>
                                    <DataTable
                                        columnContentTypes={['text', 'text', 'text', 'text', 'text']}
                                        headings={['Resource', 'ID', 'Last Indexed', 'Last Pushed', 'Action']}
                                        rows={[
                                            ['Parent Page', cachedConnections?.parentPageId || 'Not linked yet', '-', '-', 'notionParentPageId'],
                                            ['Products Database', cachedConnections?.productsDbId || 'Not linked yet', indexStatus?.lastProductsIndexedAt ? new Date(indexStatus.lastProductsIndexedAt).toLocaleString() : 'Never', status?.lastProductsSyncedAt ? new Date(status.lastProductsSyncedAt).toLocaleString() : 'Never', 'notionProductsDbId'],
                                            ['Variants Database', cachedConnections?.variantsDbId || 'Not linked yet', indexStatus?.lastProductsIndexedAt ? new Date(indexStatus.lastProductsIndexedAt).toLocaleString() : 'Never', status?.lastProductsSyncedAt ? new Date(status.lastProductsSyncedAt).toLocaleString() : 'Never', 'notionVariantsDbId'],
                                            ['Collections Database', cachedConnections?.collectionsDbId || 'Not linked yet', indexStatus?.lastCollectionsIndexedAt ? new Date(indexStatus.lastCollectionsIndexedAt).toLocaleString() : 'Never', status?.lastCollectionsSyncedAt ? new Date(status.lastCollectionsSyncedAt).toLocaleString() : 'Never', 'notionCollectionsDbId'],
                                            ['Orders Database', cachedConnections?.ordersDbId || 'Not linked yet', indexStatus?.lastOrdersIndexedAt ? new Date(indexStatus.lastOrdersIndexedAt).toLocaleString() : 'Never', status?.lastOrdersSyncedAt ? new Date(status.lastOrdersSyncedAt).toLocaleString() : 'Never', 'notionOrdersDbId'],
                                            ['Customers Database', cachedConnections?.customersDbId || 'Not linked yet', indexStatus?.lastCustomersIndexedAt ? new Date(indexStatus.lastCustomersIndexedAt).toLocaleString() : 'Never', status?.lastCustomersSyncedAt ? new Date(status.lastCustomersSyncedAt).toLocaleString() : 'Never', 'notionCustomersDbId'],
                                        ].map(row => [
                                            <Text as="span" fontWeight="bold">{row[0]}</Text>,
                                            row[1] === 'Not linked yet' ? <Badge tone="warning">Not linked yet</Badge> : <Text as="span">{row[1]}</Text>,
                                            <Text as="span" tone="subdued" variant="bodySm">{row[2]}</Text>,
                                            <Text as="span" tone="subdued" variant="bodySm">{row[3]}</Text>,
                                            row[1] !== 'Not linked yet' && row[4] !== 'notionParentPageId' ? (
                                                <Button
                                                    tone="critical"
                                                    variant="plain"
                                                    onClick={() => handleUnlinkDatabase(row[4] as string)}
                                                >
                                                    Unlink
                                                </Button>
                                            ) : null
                                        ])}
                                    />
                                </BlockStack>
                            </Card>
                        </Box>
                        <Box paddingBlockStart="400" paddingBlockEnd="800">
                            <Card background="bg-surface-caution">
                                <BlockStack gap="400">
                                    <InlineStack align="space-between" blockAlign="center" gap="400">
                                        <BlockStack gap="200">
                                            <Text as="h2" variant="headingMd">Danger Zone</Text>
                                            <Text as="p">
                                                Disconnecting will stop all live syncing between Shopify and Notion. Your existing Notion databases will not be deleted, but they will no longer be updated.
                                            </Text>
                                        </BlockStack>
                                        <Button
                                            tone="critical"
                                            onClick={() => setIsDisconnectModalOpen(true)}
                                        >
                                            Disconnect Workspace
                                        </Button>
                                    </InlineStack>
                                </BlockStack>
                            </Card>
                        </Box>
                    </Layout.Section>
                </Layout>
            </BlockStack>

            <Modal
                open={isDisconnectModalOpen}
                onClose={() => setIsDisconnectModalOpen(false)}
                title="Disconnect Notion Workspace"
                primaryAction={{
                    content: 'Disconnect Workspace',
                    destructive: true,
                    onAction: () => {
                        setIsDisconnectModalOpen(false);
                        submit({ action: "disconnect" }, { method: "post", encType: "application/json" });
                    },
                }}
                secondaryActions={[
                    {
                        content: 'Cancel',
                        onAction: () => setIsDisconnectModalOpen(false),
                    },
                ]}
            >
                <Modal.Section>
                    <Text as="p">
                        Are you sure you want to disconnect your Notion workspace? All live syncing between Shopify and Notion will stop immediately. Your existing Notion databases will remain intact but will no longer receive updates.
                    </Text>
                </Modal.Section>
            </Modal>

            <Modal
                open={isClearModalOpen}
                onClose={() => setIsClearModalOpen(false)}
                title="Clear Local Index?"
                primaryAction={{
                    content: 'Clear Index',
                    destructive: true,
                    onAction: () => {
                        setIsClearModalOpen(false);
                        fetcher.submit({ action: "clear_index" }, { method: "post", encType: "application/json" });
                    },
                }}
                secondaryActions={[
                    {
                        content: 'Cancel',
                        onAction: () => setIsClearModalOpen(false),
                    },
                ]}
            >
                <Modal.Section>
                    <Text as="p">
                        Are you sure you want to clear the local index? This will completely wipe the Shopify cache (Products, Collections, Customers, Orders, Variants) from your app's database. This will not delete data from Notion or Shopify.
                    </Text>
                </Modal.Section>
            </Modal>

            <Modal
                open={unlinkDbKey !== null}
                onClose={() => setUnlinkDbKey(null)}
                title="Unlink Database"
                primaryAction={{
                    content: 'Unlink',
                    destructive: true,
                    onAction: confirmUnlinkDatabase,
                }}
                secondaryActions={[
                    {
                        content: 'Cancel',
                        onAction: () => setUnlinkDbKey(null),
                    },
                ]}
            >
                <Modal.Section>
                    <Text as="p">
                        Are you sure you want to unlink this database? It will be recreated in Notion on the next sync.
                    </Text>
                </Modal.Section>
            </Modal>
        </Page>
    );
}
