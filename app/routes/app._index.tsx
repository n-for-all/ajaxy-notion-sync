import type { LoaderFunctionArgs } from "@remix-run/node";
import { isAppStore } from "~/app-mode";
import { json } from "@remix-run/node";
import {
    Page,
    Layout,
    Card,
    BlockStack,
    Text,
    Button,
    InlineStack,
    InlineGrid,
    Banner,
    Badge,
    Divider,
    Box,
    Icon,
    MediaCard,
    Collapsible,
    ProgressBar,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { checkBilling, FeedbackModal, getShop } from "./components";
import { checkTrialDays, syncSubscription } from "~/db.server";
import { PLAN_CONFIG } from "~/constants";
import { useLoaderData, useRevalidator } from "@remix-run/react";
import {
    ChatIcon,
    CheckCircleIcon,
    ChevronDownIcon,
    ChevronUpIcon,
    CollectionIcon,
    DatabaseIcon,
    ListBulletedIcon,
    OrderIcon,
    PersonIcon,
    ProductIcon,
    RefreshIcon,
} from "@shopify/polaris-icons";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { SyncAnimation } from "~/components/Animation";
import { useReviewRequest } from "~/components/review-request";
import * as Sentry from "@sentry/remix";
import prisma from "~/db.server";

export async function loader({ request }: LoaderFunctionArgs) {
    let trialDays = -1;
    const { billing, session, admin } = await authenticate.admin(request);

    let plan = null;
    try {
        trialDays = Math.ceil(await checkTrialDays(session));

        const billingCheck = await checkBilling({
            billing,
            onFailure: (error?) => {
                throw new Error("no-active-plan");
            },
        });

        let subscription = null;
        if (billingCheck && billingCheck.appSubscriptions.length > 0) {
            subscription = billingCheck?.appSubscriptions[0];
            // Check if this subscription exists in our database, create if missing
            await syncSubscription(session, subscription.name, subscription.id, "", PLAN_CONFIG['growth'].trialDays);

            // if we have a subscription that is not saved, save it
            if (trialDays == -1) {
                trialDays = PLAN_CONFIG['growth'].trialDays;
            }
            plan = PLAN_CONFIG[((subscription.name || "growth").toLowerCase()) as keyof typeof PLAN_CONFIG];
        }
    } catch (error: any) {
        if (error?.message !== "no-active-plan") {
            Sentry.captureException(error);
            console.error("error", error);
        }
    }

    const [config, syncStatus, shopInfo] = await Promise.all([
        prisma.storeConfig.findUnique({ where: { shop: session.shop } }),
        prisma.notionSyncStatus.findUnique({ where: { shop: session.shop } }),
        getShop(admin).catch(() => null),
    ]);
    const isConnected = !!config?.notionAccessToken;

    return json({
        plan,
        days: trialDays,
        shop: session.shop,
        appStore: isAppStore(),
        isConnected: !!isConnected,
        isDevelopment: !!shopInfo?.plan?.partnerDevelopment,
        sync: {
            status: syncStatus?.status || "idle",
            errorMessage: syncStatus?.errorMessage || null,
            lastSyncedAt: syncStatus?.lastSyncedAt ? syncStatus.lastSyncedAt.toISOString() : null,
            products: syncStatus?.productsCount || 0,
            collections: syncStatus?.collectionsCount || 0,
            customers: syncStatus?.customersCount || 0,
            orders: syncStatus?.ordersCount || 0,
        },
    });
}

const TWO_WAY_KEY = "ans-setup-two-way";
const ORDER_ACTIONS_KEY = "ans-setup-order-actions";

const readFlag = (key: string) => {
    try {
        return window.localStorage.getItem(key) === "1";
    } catch (e) {
        return false;
    }
};

const saveFlag = (key: string) => {
    try {
        window.localStorage.setItem(key, "1");
    } catch (e) {}
};

const formatNumber = (value: number) => new Intl.NumberFormat().format(value || 0);

const timeAgo = (iso: string | null) => {
    if (!iso) return "Never";
    const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} ${hours == 1 ? "hour" : "hours"} ago`;
    const days = Math.round(hours / 24);
    return `${days} ${days == 1 ? "day" : "days"} ago`;
};

type SetupStepType = {
    id: string;
    title: string;
    done: boolean;
    content: ReactNode;
    actions?: ReactNode;
};

const StepStatus = ({ done }: { done: boolean }) => {
    if (done) {
        return (
            <Box minWidth="20px">
                <Icon source={CheckCircleIcon} tone="success" accessibilityLabel="Completed" />
            </Box>
        );
    }
    return <Box minWidth="20px" minHeight="20px" borderWidth="050" borderStyle="dashed" borderColor="border" borderRadius="full" />;
};

const SetupStep = ({ step, open, onToggle }: { step: SetupStepType; open: boolean; onToggle: () => void }) => (
    <Box padding="300" borderRadius="300" background={open ? "bg-surface-secondary" : undefined}>
        <BlockStack gap="200">
            <InlineStack gap="300" blockAlign="center" wrap={false}>
                <StepStatus done={step.done} />
                <Button variant="monochromePlain" textAlign="left" onClick={onToggle} ariaExpanded={open} ariaControls={`setup-step-${step.id}`}>
                    {step.title}
                </Button>
            </InlineStack>
            <Collapsible open={open} id={`setup-step-${step.id}`} transition={{ duration: "250ms", timingFunction: "ease-in-out" }}>
                <Box paddingInlineStart="800" paddingBlockStart="100">
                    <BlockStack gap="300">
                        {step.content}
                        {step.actions && <InlineStack gap="200">{step.actions}</InlineStack>}
                    </BlockStack>
                </Box>
            </Collapsible>
        </BlockStack>
    </Box>
);

const Stat = ({ icon, label, value }: { icon: any; label: string; value: string }) => (
    <Box padding="300" borderRadius="200" background="bg-surface-secondary">
        <BlockStack gap="100">
            <InlineStack gap="100" blockAlign="center" wrap={false}>
                <Box>
                    <Icon source={icon} tone="subdued" />
                </Box>
                <Text as="span" variant="bodySm" tone="subdued">
                    {label}
                </Text>
            </InlineStack>
            <Text as="p" variant="headingLg">
                {value}
            </Text>
        </BlockStack>
    </Box>
);

const FeatureCard = ({ icon, title, description }: { icon: any; title: string; description: string }) => (
    <Card>
        <BlockStack gap="200">
            <InlineStack gap="200" blockAlign="center" wrap={false}>
                <Box background="bg-surface-secondary" padding="150" borderRadius="200">
                    <Icon source={icon} tone="base" />
                </Box>
                <Text as="h3" variant="headingSm">
                    {title}
                </Text>
            </InlineStack>
            <Text as="p" tone="subdued">
                {description}
            </Text>
        </BlockStack>
    </Card>
);

const otherApps = [
    {
        title: "Ajaxy AI Sales Agent",
        description: "An AI sales agent that answers product questions and helps customers buy.",
        url: "https://apps.shopify.com/ajaxy-ai-sales-agent",
        image: "https://ajaxy.org/wp-content/uploads/2026/06/CIrAk92gjJUDEAE-1200x675.webp",
    },
    {
        title: "Ajaxy Gym & Fitness Booking",
        description: "Let clients discover and book personal training and fitness classes.",
        url: "https://apps.shopify.com/gym-fitness-booking",
        image: "https://ajaxy.org/wp-content/uploads/2024/09/a.jpg",
    },
    {
        title: "Ajaxy Spa & Salon Booking",
        description: "Let customers book salon and spa services with your professionals.",
        url: "https://apps.shopify.com/ajaxy-spa-salon-booking",
        image: "https://ajaxy.org/wp-content/uploads/2025/07/CIXLo-HFoowDEAE.webp",
    },
];

export default function Index() {
    const { plan, days, isConnected, isDevelopment, sync, appStore } = useLoaderData<typeof loader>();
    const revalidator = useRevalidator();
    const [feedback, setFeedback] = useState({ show: false, title: "" });

    const [twoWayDone, setTwoWayDone] = useState(false);
    const [orderActionsDone, setOrderActionsDone] = useState(false);
    useEffect(() => {
        setTwoWayDone(readFlag(TWO_WAY_KEY));
        setOrderActionsDone(readFlag(ORDER_ACTIONS_KEY));
    }, []);

    const hasSynced = !!sync.lastSyncedAt;
    const isSyncing = sync.status === "syncing" || sync.status === "indexing";
    const hasPlan = !!plan || isDevelopment || !appStore;
    const inTrial = !!plan && days > 0;

    const steps: SetupStepType[] = [
        {
            id: "connect",
            title: "Connect your Notion workspace",
            done: isConnected,
            content: (
                <Text as="p" tone="subdued">
                    Sign in to Notion and pick the page where the app should create your Products, Collections, Customers and Orders databases.
                </Text>
            ),
            actions: (
                <Button variant={isConnected ? "secondary" : "primary"} icon={DatabaseIcon} url="/app/sync">
                    {isConnected ? "Manage connection" : "Connect Notion"}
                </Button>
            ),
        },
        {
            id: "sync",
            title: "Run your first sync",
            done: hasSynced,
            content: (
                <Text as="p" tone="subdued">
                    {isConnected
                        ? "Copy your existing products, collections, customers and orders to Notion. After that, changes in Shopify sync automatically."
                        : "Connect Notion first, then copy your store data to it in one click."}
                </Text>
            ),
            actions: (
                <Button variant={hasSynced ? "secondary" : "primary"} icon={RefreshIcon} url="/app/sync" disabled={!isConnected}>
                    {hasSynced ? "Open sync dashboard" : "Start sync"}
                </Button>
            ),
        },
        {
            id: "two-way",
            title: "Turn on Notion → Shopify updates",
            done: twoWayDone,
            content: (
                <Text as="p" tone="subdued">
                    Add a Notion automation that sends a webhook to the app, so edits you make in Notion (order tags and notes, products, variants, customers) update
                    Shopify. The sync dashboard has the links to paste.
                </Text>
            ),
            actions: (
                <>
                    <Button variant={twoWayDone ? "secondary" : "primary"} url="/app/sync" disabled={!hasSynced}>
                        Get webhook links
                    </Button>
                    {!twoWayDone && (
                        <Button
                            onClick={() => {
                                saveFlag(TWO_WAY_KEY);
                                setTwoWayDone(true);
                            }}
                        >
                            I've set it up
                        </Button>
                    )}
                </>
            ),
        },
        {
            id: "order-actions",
            title: "Add order buttons in Notion",
            done: orderActionsDone,
            content: (
                <Text as="p" tone="subdued">
                    Add Fulfill, Cancel and Resend buttons to your Orders database with the ready-made formulas, and manage orders without leaving Notion.
                </Text>
            ),
            actions: (
                <>
                    <Button variant={orderActionsDone ? "secondary" : "primary"} url="/app/sync" disabled={!hasSynced}>
                        Get button formulas
                    </Button>
                    {!orderActionsDone && (
                        <Button
                            onClick={() => {
                                saveFlag(ORDER_ACTIONS_KEY);
                                setOrderActionsDone(true);
                            }}
                        >
                            I've added them
                        </Button>
                    )}
                </>
            ),
        },
    ];

    const completed = steps.filter((s) => s.done).length;
    const allDone = completed === steps.length;
    const firstOpen = steps.find((s) => !s.done)?.id || null;

    const [openStep, setOpenStep] = useState<string | null>(firstOpen);
    const [guideOpen, setGuideOpen] = useState(!allDone);

    // move to the next step as soon as one is completed
    useEffect(() => {
        setOpenStep(firstOpen);
        if (allDone) setGuideOpen(false);
    }, [firstOpen, allDone]);

    // connecting and syncing happen on other pages and tabs: check again when the merchant comes back
    useEffect(() => {
        if (isConnected && hasSynced && !isSyncing) return;
        const onFocus = () => {
            if (revalidator.state === "idle") revalidator.revalidate();
        };
        window.addEventListener("focus", onFocus);
        return () => window.removeEventListener("focus", onFocus);
    }, [isConnected, hasSynced, isSyncing, revalidator]);

    // ask for a review once the store is synced to Notion
    // (Shopify's review prompt only works for apps listed on the App Store)
    useReviewRequest(appStore && isConnected && hasSynced && hasPlan);

    const toggleStep = useCallback((id: string) => setOpenStep((current) => (current === id ? null : id)), []);

    let planCard: ReactNode;
    if (!appStore) {
        // self-hosted custom app: no plans
        planCard = null;
    } else if (isDevelopment) {
        planCard = (
            <Card>
                <InlineStack align="space-between" blockAlign="center" gap="400">
                    <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center">
                            <Text as="h2" variant="headingMd">
                                Development store
                            </Text>
                            <Badge tone="info">Free</Badge>
                        </InlineStack>
                        <Text as="p" tone="subdued">
                            Every feature is unlocked for testing.
                        </Text>
                    </BlockStack>
                    <Button variant="plain" url="/app/pricing">
                        View plans
                    </Button>
                </InlineStack>
            </Card>
        );
    } else if (plan) {
        planCard = (
            <Card>
                <InlineStack align="space-between" blockAlign="center" gap="400">
                    <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center">
                            <Text as="h2" variant="headingMd">
                                {`${plan.title || plan.name}`}
                            </Text>
                            {inTrial ? <Badge tone="attention">{`Free trial · ${days} ${days == 1 ? "day" : "days"} left`}</Badge> : <Badge tone="success">Active</Badge>}
                        </InlineStack>
                        <Text as="p" tone="subdued">
                            {`Syncs up to ${formatNumber(plan.maxItems)} products and customers and ${formatNumber(plan.maxOrders || 0)} orders.${inTrial ? " You won't be charged until your trial ends." : ""}`}
                        </Text>
                    </BlockStack>
                    <Button url="/app/pricing">Manage plan</Button>
                </InlineStack>
            </Card>
        );
    } else {
        planCard = (
            <Banner title="You're on the free plan" tone="warning" action={{ content: "See plans", url: "/app/pricing" }}>
                <p>The free plan syncs up to 10 products and customers and 10 orders. Choose a plan to sync your whole store.</p>
            </Banner>
        );
    }

    return (
        <Page>
            <Box paddingInline={{ xs: "400", sm: "0" }}>
                <BlockStack gap="500">
                    <Box paddingBlockStart="400">
                        <BlockStack gap="200" align="center" inlineAlign="center">
                            <SyncAnimation />
                            <Text as="h1" variant="heading2xl">
                                Notion Sync
                            </Text>
                            <Text as="p" tone="subdued" variant="bodyLg">
                                Your products, customers and orders in Notion, kept in sync both ways.
                            </Text>
                        </BlockStack>
                    </Box>

                    {sync.status === "error" && (
                        <Banner title="The last sync didn't finish" tone="critical" action={{ content: "Open sync dashboard", url: "/app/sync" }}>
                            <p>{sync.errorMessage || "Something went wrong while syncing to Notion."}</p>
                        </Banner>
                    )}

                    {planCard}

                    <Card>
                        <BlockStack gap="400">
                            <InlineStack align="space-between" blockAlign="center" gap="400">
                                <BlockStack gap="100">
                                    <InlineStack gap="200" blockAlign="center">
                                        <Text as="h2" variant="headingMd">
                                            Your Notion workspace
                                        </Text>
                                        {isSyncing ? (
                                            <Badge tone="info">Syncing…</Badge>
                                        ) : isConnected ? (
                                            <Badge tone="success">Connected</Badge>
                                        ) : (
                                            <Badge>Not connected</Badge>
                                        )}
                                    </InlineStack>
                                    <Text as="p" tone="subdued">
                                        {isConnected ? `Last full sync: ${timeAgo(sync.lastSyncedAt)}. Changes in Shopify sync automatically.` : "Connect Notion to start syncing your store."}
                                    </Text>
                                </BlockStack>
                                <InlineStack gap="200">
                                    <Button url="/app/webhooks" icon={ListBulletedIcon}>
                                        Sync logs
                                    </Button>
                                    <Button variant="primary" url="/app/sync" icon={RefreshIcon}>
                                        Sync dashboard
                                    </Button>
                                </InlineStack>
                            </InlineStack>
                            {isConnected && (
                                <InlineGrid columns={{ xs: 2, md: 4 }} gap="300">
                                    <Stat icon={ProductIcon} label="Products" value={formatNumber(sync.products)} />
                                    <Stat icon={CollectionIcon} label="Collections" value={formatNumber(sync.collections)} />
                                    <Stat icon={PersonIcon} label="Customers" value={formatNumber(sync.customers)} />
                                    <Stat icon={OrderIcon} label="Orders" value={formatNumber(sync.orders)} />
                                </InlineGrid>
                            )}
                        </BlockStack>
                    </Card>

                    <Card padding="0">
                        <Box padding="400">
                            <BlockStack gap="300">
                                <InlineStack align="space-between" blockAlign="center" wrap={false}>
                                    <InlineStack gap="200" blockAlign="center">
                                        <Text as="h2" variant="headingMd">
                                            Setup guide
                                        </Text>
                                        {allDone && <Badge tone="success">Complete</Badge>}
                                    </InlineStack>
                                    <Button
                                        variant="tertiary"
                                        icon={guideOpen ? ChevronUpIcon : ChevronDownIcon}
                                        onClick={() => setGuideOpen((open) => !open)}
                                        accessibilityLabel={guideOpen ? "Collapse setup guide" : "Expand setup guide"}
                                        ariaExpanded={guideOpen}
                                        ariaControls="setup-guide"
                                    />
                                </InlineStack>
                                <Text as="p" tone="subdued">
                                    {allDone ? "Everything is set up: your store and Notion stay in sync both ways." : "Get your store into Notion in four steps."}
                                </Text>
                                <InlineStack gap="300" blockAlign="center" wrap={false}>
                                    <Text as="span" variant="bodySm" tone="subdued">
                                        {`${completed} of ${steps.length} completed`}
                                    </Text>
                                    <Box width="100%">
                                        <ProgressBar progress={(completed / steps.length) * 100} size="small" tone="success" />
                                    </Box>
                                </InlineStack>
                            </BlockStack>
                        </Box>
                        <Collapsible open={guideOpen} id="setup-guide" transition={{ duration: "300ms", timingFunction: "ease-in-out" }}>
                            <Box paddingInline="200" paddingBlockEnd="300">
                                <BlockStack gap="100">
                                    {steps.map((step) => (
                                        <SetupStep key={step.id} step={step} open={openStep === step.id} onToggle={() => toggleStep(step.id)} />
                                    ))}
                                </BlockStack>
                            </Box>
                        </Collapsible>
                    </Card>

                    <BlockStack gap="300">
                        <Text as="h2" variant="headingMd">
                            What you can do
                        </Text>
                        <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
                            <FeatureCard
                                icon={RefreshIcon}
                                title="Live sync to Notion"
                                description="New and updated products, collections, customers and orders appear in Notion automatically."
                            />
                            <FeatureCard
                                icon={DatabaseIcon}
                                title="Edit in Notion"
                                description="Change order tags and notes, products, variants and customers in Notion, and Shopify updates."
                            />
                            <FeatureCard
                                icon={OrderIcon}
                                title="Manage orders in Notion"
                                description="Fulfill, cancel or resend an order confirmation with a button on the order's page."
                            />
                        </InlineGrid>
                    </BlockStack>

                    <Divider />

                    <BlockStack gap="300">
                        <Text as="h2" variant="headingMd">
                            More apps from Ajaxy
                        </Text>
                        <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
                            {otherApps.map((app) => (
                                <MediaCard
                                    key={app.url}
                                    portrait
                                    size="small"
                                    title={app.title}
                                    description={app.description}
                                    primaryAction={{ content: "View app", onAction: () => window.open(app.url, "_blank") }}
                                >
                                    <img alt="" width="100%" height="100%" style={{ objectFit: "cover", objectPosition: "center" }} src={app.image} />
                                </MediaCard>
                            ))}
                        </InlineGrid>
                    </BlockStack>

                    <Card>
                        <InlineStack align="space-between" blockAlign="center" gap="400">
                            <BlockStack gap="100">
                                <Text as="h2" variant="headingMd">
                                    Need help?
                                </Text>
                                <Text as="p" tone="subdued">
                                    Questions, feedback or a feature you'd like to see? Our team is happy to help.
                                </Text>
                            </BlockStack>
                            <Button icon={ChatIcon} onClick={() => setFeedback({ show: true, title: "Feedback, support or feature request" })}>
                                Contact us
                            </Button>
                        </InlineStack>
                    </Card>

                    <Box paddingBlockEnd="1000" />
                </BlockStack>
            </Box>
            <FeedbackModal
                show={feedback.show}
                title={feedback.title}
                onClose={() => setFeedback({ show: false, title: "" })}
                onSubmit={() => {
                    setFeedback({ show: false, title: "" });
                }}
            />
        </Page>
    );
}
