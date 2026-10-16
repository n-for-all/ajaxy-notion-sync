import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "@remix-run/react";
import { Page, Layout, Card, Button, Select, Checkbox, AppProvider, BlockStack, Text, Banner } from "@shopify/polaris";

import db from "../db.server";
import { useState, useEffect } from "react";
import { unauthenticated } from "../shopify.server";
import { logToDb } from "../services/sync/utils";

// 1. Fetch Store Credentials
async function getShopifyShop(token: string) {
    const config = await db.storeConfig.findFirst({ where: { syncToken: token } });
    if (!config) throw new Error("Invalid token");
    return config.shop;
}

export const loader = async ({ params }: LoaderFunctionArgs) => {
    const shop = await getShopifyShop(params.token!); // Validate token on load
    

    return json({ orderId: params.id, token: params.token });
};

// 2. Process the Cancellation
export const action = async ({ request, params }: ActionFunctionArgs) => {
    try {
        const shop = await getShopifyShop(params.token!);
        const { admin } = await unauthenticated.admin(shop);
        const formData = await request.formData();
        const reason = formData.get("reason") as string;
        const restock = formData.get("restock") === "true";

        const graphqlQuery = `
        mutation orderCancel($orderId: ID!, $reason: OrderCancelReason!, $restock: Boolean!) {
          orderCancel(orderId: $orderId, reason: $reason, restock: $restock) {
            orderCancelUserErrors { field message }
          }
        }
      `;

        const response = await admin.graphql(graphqlQuery, {
            variables: {
                orderId: `gid://shopify/Order/${params.id}`,
                reason: reason,
                restock: restock
            }
        });

        const data = (await response.json()) as any;
        if (data?.data?.orderCancel?.orderCancelUserErrors?.length > 0) {
            const errorMsg = data.data.orderCancel.orderCancelUserErrors[0].message;
            await logToDb(shop, "NOTION_SYNC_ORDER_CANCELLED", "error", params.id!, `Cancel failed: ${errorMsg}`, false, "orders");
            return json({ error: errorMsg }, { status: 400 });
        }

        await logToDb(shop, "NOTION_SYNC_ORDER_CANCELLED", "success", params.id!, "Order cancelled successfully", false, "orders");

        return json({ success: true, token: params.token, message: "Order cancelled successfully" });
    } catch (err: any) {
        return json({ error: err.message || "An unexpected error occurred." }, { status: 500 });
    }
};

// 3. The UI
export default function CancelOrderPage() {
    const { orderId } = useLoaderData<typeof loader>();
    const actionData = useActionData<any>();
    const submit = useSubmit();
    const nav = useNavigation();

    const [reason, setReason] = useState("CUSTOMER");
    const [restock, setRestock] = useState(true);

    useEffect(() => {
        if (actionData?.success) {
            const timer = setTimeout(() => {
                window.close();
            }, 5000);
            return () => clearTimeout(timer);
        }
    }, [actionData]);

    const handleCancel = () => {
        submit({ reason, restock: String(restock) }, { method: "post" });
    };

    return (
        <AppProvider i18n={{}}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: "1rem", marginTop: "2rem" }}>
                <img src="/logo.png" alt="Logo" style={{ height: "60px", objectFit: "contain" }} />
            </div>
            <Page narrowWidth>
                <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
                    <Text variant="headingLg" as="h1">{`Cancel Order #${orderId}`}</Text>
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
                                <BlockStack gap="400">
                                    <Text as="p">Please confirm cancellation details.</Text>
                                    <Select
                                        label="Reason for cancellation"
                                        options={[
                                            { label: "Customer changed/canceled", value: "CUSTOMER" },
                                            { label: "Items unavailable (Out of stock)", value: "INVENTORY" },
                                            { label: "Fraudulent order", value: "FRAUD" },
                                            { label: "Payment declined", value: "DECLINED" }
                                        ]}
                                        onChange={setReason}
                                        value={reason}
                                    />
                                    <Checkbox
                                        label="Restock inventory"
                                        checked={restock}
                                        onChange={setRestock}
                                    />
                                    <Button
                                        tone="critical"
                                        onClick={handleCancel}
                                        loading={nav.state === "submitting"}
                                    >
                                        Cancel Order Now
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