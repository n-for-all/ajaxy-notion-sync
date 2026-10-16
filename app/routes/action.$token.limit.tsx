import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, Button, AppProvider, BlockStack, Text, Icon } from "@shopify/polaris";
import { AlertCircleIcon } from "@shopify/polaris-icons";
import db from "../db.server";

export const loader = async ({ params }: LoaderFunctionArgs) => {
    const config = await db.storeConfig.findFirst({ where: { syncToken: params.token } });
    if (!config) {
        throw new Response("Not Found", { status: 404 });
    }
    
    // Convert e.g. "my-store.myshopify.com" to "my-store"
    const shopName = config.shop.replace(".myshopify.com", "");
    const apiKey = process.env.SHOPIFY_API_KEY || "";
    const upgradeUrl = `https://admin.shopify.com/store/${shopName}/apps/${apiKey}/app/pricing`;

    return json({ upgradeUrl });
};

export default function LimitReached() {
    const { upgradeUrl } = useLoaderData<typeof loader>();

    return (
        <AppProvider i18n={{}}>
            <Page>
                <Layout>
                    <Layout.Section>
                        <Card>
                            <BlockStack gap="400" align="center" inlineAlign="center">
                                <div style={{ color: "var(--p-color-icon-critical)" }}>
                                    <Icon source={AlertCircleIcon} tone="critical" />
                                </div>
                                <Text as="h1" variant="headingLg" alignment="center">
                                    Plan Limit Reached
                                </Text>
                                <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                                    You have reached the maximum number of orders allowed on your current plan. Please upgrade your plan in Shopify to continue using Notion actions.
                                </Text>
                                <Button
                                    variant="primary"
                                    onClick={() => window.open(upgradeUrl, "_blank")}
                                >
                                    Upgrade in Shopify
                                </Button>
                            </BlockStack>
                        </Card>
                    </Layout.Section>
                </Layout>
            </Page>
        </AppProvider>
    );
}
