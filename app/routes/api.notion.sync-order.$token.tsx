import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { getPlanLimits } from "../services/plan-limits.server";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { cleanGid, getNotionIdByShopifyId, logErrorToNotion, logToDb, generateWebhookSetupHtml } from "~/services/sync/utils";
import { Client } from "@notionhq/client";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const url = new URL(request.url);
    const webhookUrl = url.href;

    const html = generateWebhookSetupHtml(webhookUrl, "Order", "Orders");

    return new Response(html, {
        headers: { "Content-Type": "text/html" },
    });
};

export async function action({ request, params }: ActionFunctionArgs) {
    if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, { status: 405 });
    }

    const token = params.token;
    if (!token) return json({ error: "Missing token" }, { status: 400 });

    const storeConfig = await prisma.storeConfig.findUnique({
        where: { syncToken: token }
    });

    if (!storeConfig) return json({ error: "Invalid token" }, { status: 401 });

    const shop = storeConfig.shop;
    
    // Limit Check
    const { maxOrders } = await getPlanLimits(shop);
    const currentOrders = await prisma.order.count({ where: { shop } });
    
    if (currentOrders >= maxOrders) {
        await logToDb(shop, "NOTION_SYNC_ORDER", "error", null, "Plan limit reached for orders. Please upgrade.", true, "orders");
        return json({ error: "Plan limit reached" }, { status: 403 });
    }

    const { admin } = await unauthenticated.admin(shop);

    let orderId = null;
    try {
        const body = await request.json();
        const props = body?.data?.properties;

        if (!props) {
            const msg = "No properties found in payload";
            await logToDb(shop, "NOTION_SYNC_ORDER", "error", null, msg, true, "orders");
            return json({ error: msg }, { status: 400 });
        }

        orderId = props["ID"]?.number;
        const shopifyId = "gid://shopify/Order/" + orderId;
        if (!shopifyId) {
            const msg = "No Shopify ID found in payload";
            console.error(msg);
            await logToDb(shop, "NOTION_SYNC_ORDER", "error", shopifyId, msg, true, "orders");
            return json({ error: msg }, { status: 400 });
        }

        const tags = props["Tags"]?.multi_select?.map((s: any) => s.name) || [];
        const notionNote = props["Note"]?.rich_text?.map((rt: any) => rt.plain_text).join("") || "";

        const shopifyOrderQuery = `
      query GetOrder($id: ID!) {
        order(id: $id) {
          id
          closed
          cancelledAt
          displayFulfillmentStatus
          tags
          note
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
            const msg = `Order ${shopifyId} not found in Shopify`;
            await logToDb(shop, "NOTION_SYNC_ORDER", "error", null, msg, true, "orders");
            return json({ error: "Order not found in Shopify" }, { status: 404 });
        }

        let actionsTaken = [];

        // 1. Sync Tags
        const existingTags = order.tags || [];
        const tagsToAdd = tags.filter((t: string) => !existingTags.includes(t));
        const tagsToRemove = existingTags.filter((t: string) => !tags.includes(t));
        
        let needsUpdate = false;
        const updateInput: any = { id: shopifyId };

        if (tagsToAdd.length > 0 || tagsToRemove.length > 0) {
            updateInput.tags = tags;
            needsUpdate = true;
            actionsTaken.push("Updated Tags");
        }

        // 2. Sync Note
        const existingNote = order.note || "";
        if (notionNote !== existingNote) {
            updateInput.note = notionNote;
            needsUpdate = true;
            actionsTaken.push("Updated Note");
        }

        if (!needsUpdate) {
            // Prevent infinite loop & log spam: do nothing if Notion and Shopify match
            return json({ success: true, message: "No actions needed" });
        }

        const updateMutation = `
        mutation orderUpdate($input: OrderInput!) {
          orderUpdate(input: $input) {
            userErrors { message }
          }
        }
      `;
        const res = await admin.graphql(updateMutation, { variables: { input: updateInput } });
        const updateData = await res.json() as any;
        if (updateData?.data?.orderUpdate?.userErrors?.length > 0) {
            console.error(`Failed to update order ${shopifyId}:`, updateData.data.orderUpdate.userErrors);
        }

        const logMsg = `Order ${shopifyId}: ${actionsTaken.join(" | ")}`;
        await logToDb(shop, "NOTION_SYNC_ORDER", "success", orderId, logMsg, true, "orders");

        return json({ success: true, message: logMsg });
    } catch (err: any) {
        console.error(`Webhook processing error for ${orderId}: `, err.message);
        await logToDb(shop, "NOTION_SYNC_ORDER", "error", orderId, err.message, true, "orders");
        return json({ error: "Internal Server Error" }, { status: 500 });
    }
}
