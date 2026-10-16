import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "@remix-run/react";
import { Page, Layout, Card, Button, TextField, Checkbox, AppProvider, BlockStack, Text, Banner } from "@shopify/polaris";

import db from "../db.server";
import { useState, useEffect } from "react";
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
        const formData = await request.formData();

        const trackingNumber = formData.get("trackingNumber") as string;
        const trackingCompany = formData.get("trackingCompany") as string;
        const notifyCustomer = formData.get("notifyCustomer") === "true";
        const shopifyId = `gid://shopify/Order/${params.id}`;

        const shopifyOrderQuery = `
          query GetOrder($id: ID!) {
            order(id: $id) {
              id
              fulfillmentOrders(first: 10) {
                nodes {
                  id
                  status
                }
              }
            }
          }
        `;

        const orderRes = await admin.graphql(shopifyOrderQuery, { variables: { id: shopifyId } });
        const orderData = (await orderRes.json()) as any;
        const order = orderData?.data?.order;

        if (!order) {
            return json({ error: "Order not found in Shopify" }, { status: 404 });
        }

        const openFOs = order.fulfillmentOrders?.nodes?.filter((fo: any) => fo.status === "OPEN" || fo.status === "IN_PROGRESS") || [];

        if (openFOs.length === 0) {
            return json({ error: "No open fulfillment orders found for this order." }, { status: 400 });
        }

        for (const fo of openFOs) {
            const fulfillMutation = `
              mutation fulfillmentCreateV2($fulfillment: FulfillmentV2Input!) {
                fulfillmentCreateV2(fulfillment: $fulfillment) {
                  userErrors { message }
                }
              }
            `;
            const trackingInfo: any = {};
            if (trackingNumber) trackingInfo.number = trackingNumber;
            if (trackingCompany) trackingInfo.company = trackingCompany;

            const fulfillmentInput: any = {
                lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: fo.id }],
                notifyCustomer
            };

            if (Object.keys(trackingInfo).length > 0) {
                fulfillmentInput.trackingInfo = trackingInfo;
            }

            const res = await admin.graphql(fulfillMutation, {
                variables: {
                    fulfillment: fulfillmentInput
                }
            });
            const fulfillData = await res.json() as any;
            if (fulfillData?.data?.fulfillmentCreateV2?.userErrors?.length > 0) {
                const errorMsg = fulfillData.data.fulfillmentCreateV2.userErrors[0].message;
                await logToDb(shop, "NOTION_SYNC_ORDER_FULFILLED", "error", params.id!, `Fulfillment failed: ${errorMsg}`, false, "orders");
                return json({ error: errorMsg }, { status: 400 });
            }
        }

        await logToDb(shop, "NOTION_SYNC_ORDER_FULFILLED", "success", params.id!, "Order fulfilled successfully", false, "orders");

        return json({ success: true, token: params.token, message: "Order fulfilled successfully" });
    } catch (err: any) {
        return json({ error: err.message || "An unexpected error occurred." }, { status: 500 });
    }
};

export default function FulfillOrderPage() {
    const { orderId } = useLoaderData<typeof loader>();
    const actionData = useActionData<any>();
    const submit = useSubmit();
    const nav = useNavigation();

    const [trackingNumber, setTrackingNumber] = useState("");
    const [trackingCompany, setTrackingCompany] = useState("");
    const [notifyCustomer, setNotifyCustomer] = useState(true);

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
                    <Text variant="headingLg" as="h1">{`Fulfill Order #${orderId}`}</Text>
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
                                    <TextField
                                        label="Tracking Number (Optional)"
                                        value={trackingNumber}
                                        onChange={setTrackingNumber}
                                        autoComplete="off"
                                    />
                                    <TextField
                                        label="Tracking Company (Optional)"
                                        value={trackingCompany}
                                        onChange={setTrackingCompany}
                                        autoComplete="off"
                                        helpText="Shopify will try to auto-detect the carrier if left blank."
                                    />
                                    <Checkbox
                                        label="Send shipment notification to customer"
                                        checked={notifyCustomer}
                                        onChange={setNotifyCustomer}
                                    />
                                    <Button
                                        variant="primary"
                                        onClick={() => submit({ trackingNumber, trackingCompany, notifyCustomer: String(notifyCustomer) }, { method: "post" })}
                                        loading={nav.state === "submitting"}
                                    >
                                        Fulfill Items
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