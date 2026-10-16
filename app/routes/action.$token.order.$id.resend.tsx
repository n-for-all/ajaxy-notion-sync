import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "@remix-run/react";
import { Page, Layout, Card, Button, AppProvider, BlockStack, Text, Badge, Banner } from "@shopify/polaris";

import db from "../db.server";
import { useEffect } from "react";
import { unauthenticated } from "../shopify.server";
import { logToDb } from "../services/sync/utils";

async function getShopifyShop(token: string) {
    const config = await db.storeConfig.findFirst({ where: { syncToken: token } });
    if (!config) throw new Error("Invalid token");
    return config.shop;
}

export const loader = async ({ params }: LoaderFunctionArgs) => {
    const shop = await getShopifyShop(params.token!); // Validate token on load
    

    return json({ orderId: params.id, token: params.token });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
    try {
        const shop = await getShopifyShop(params.token!);
        const { admin } = await unauthenticated.admin(shop);

        const graphqlQuery = `
        mutation OrderInvoiceSend($orderId: ID!) {
          orderInvoiceSend(id: $orderId) {
            order {
              id
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

        const response = await admin.graphql(graphqlQuery, {
            variables: {
                orderId: `gid://shopify/Order/${params.id}`
            }
        });

        const data = (await response.json()) as any;
        if (data?.data?.orderInvoiceSend?.userErrors?.length > 0) {
            const errorMsg = data.data.orderInvoiceSend.userErrors[0].message;
            await logToDb(shop, "NOTION_SYNC_ORDER_RESENT", "error", params.id!, `Resend failed: ${errorMsg}`, false, "orders");
            return json({ error: errorMsg }, { status: 400 });
        }

        await logToDb(shop, "NOTION_SYNC_ORDER_RESENT", "success", params.id!, "Order confirmation resent", false, "orders");

        return json({ success: true, token: params.token, message: "Order confirmation resent" });
    } catch (err: any) {
        return json({ error: err.message || "An unexpected error occurred." }, { status: 500 });
    }
};

export default function ResendConfirmationPage() {
    const { orderId } = useLoaderData<typeof loader>();
    const actionData = useActionData<any>();
    const submit = useSubmit();
    const nav = useNavigation();

    useEffect(() => {
        if (actionData?.success) {
            const timer = setTimeout(() => {
                window.close();
            }, 5000);
            return () => clearTimeout(timer);
        }
    }, [actionData]);

    return (
        <AppProvider i18n={{}}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: "1rem", marginTop: "2rem" }}>
                <img src="/logo.png" alt="Logo" style={{ height: "60px", objectFit: "contain" }} />
            </div>
            <Page narrowWidth>
                <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
                    <Text variant="headingLg" as="h1">Resend Order Confirmation</Text>
                </div>
                <Layout>
                    <Layout.Section>
                        {actionData?.error && (
                            <div style={{ marginBottom: '1rem' }}>
                                <Banner tone="critical">
                                    <p>{actionData.error}</p>
                                </Banner>
                            </div>
                        )}
                        {actionData?.success ? (
                            <Card>
                                <BlockStack gap="400" align="center">
                                    <Banner tone="success">
                                        <p>{actionData.message}. Closing this tab in 5 seconds...</p>
                                    </Banner>
                                </BlockStack>
                            </Card>
                        ) : (
                            <Card>
                                <BlockStack gap="400" align="center">
                                    <Badge tone="info">{`Order #${orderId!}`}</Badge>
                                    <Text as="p">Are you sure you want to resend the order confirmation email to the customer?</Text>
                                    <Button
                                        variant="primary"
                                        onClick={() => submit({}, { method: "post" })}
                                        loading={nav.state === "submitting"}
                                    >
                                        Yes, Resend Email
                                    </Button>
                                </BlockStack>
                            </Card>
                        )}
                    </Layout.Section>
                </Layout>
            </Page>
        </AppProvider>
    );
}