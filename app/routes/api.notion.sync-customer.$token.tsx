import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import db from "../db.server";
import { getPlanLimits } from "../services/plan-limits.server";
import { unauthenticated } from "../shopify.server";
import { logToDb, generateWebhookSetupHtml } from "../services/sync/utils";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const url = new URL(request.url);
    const webhookUrl = url.href;

    const html = generateWebhookSetupHtml(webhookUrl, "Customer", "Customers");

    return new Response(html, {
        headers: { "Content-Type": "text/html" },
    });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
    let customerId: number | null = null;
    let shop = "";
    
    try {
        const token = params.token;
        if (!token) {
            return json({ error: "Missing token" }, { status: 400 });
        }

        const config = await db.storeConfig.findFirst({ where: { syncToken: token } });
        if (!config) {
            return json({ error: "Invalid token" }, { status: 401 });
        }
        shop = config.shop;

        // Limit Check
        const { maxItems } = await getPlanLimits(shop);
        const currentCustomers = await db.customer.count({ where: { shop } });
        
        if (currentCustomers >= maxItems) {
            await logToDb(shop, "NOTION_SYNC_CUSTOMER", "error", null, "Plan limit reached for customers. Please upgrade.", true, "customers");
            return json({ error: "Plan limit reached" }, { status: 403 });
        }

        const { admin } = await unauthenticated.admin(shop);

        const body = await request.json();
        const props = body?.data?.properties;

        if (!props) {
            const msg = "No properties found in payload";
            await logToDb(shop, "NOTION_SYNC_CUSTOMER", "error", null, msg, true, "customers");
            return json({ error: msg }, { status: 400 });
        }

        customerId = props["ID"]?.number;
        const shopifyId = "gid://shopify/Customer/" + customerId;
        if (!shopifyId || !customerId) {
            const msg = "No Shopify ID found in payload";
            console.error(msg);
            await logToDb(shop, "NOTION_SYNC_CUSTOMER", "error", shopifyId, msg, true, "customers");
            return json({ error: msg }, { status: 400 });
        }

        // Extract properties from Notion payload
        const notionTags = props["Tags"]?.multi_select?.map((s: any) => s.name) || [];

        const shopifyCustomerQuery = `
      query GetCustomer($id: ID!) {
        customer(id: $id) {
          id
          tags
        }
      }
    `;

        const customerRes = await admin.graphql(shopifyCustomerQuery, { variables: { id: shopifyId } });
        const customerData = (await customerRes.json()) as any;
        const customer = customerData?.data?.customer;

        if (!customer) {
            const msg = `Customer ${shopifyId} not found in Shopify`;
            await logToDb(shop, "NOTION_SYNC_CUSTOMER", "error", null, msg, true, "customers");
            return json({ error: "Customer not found in Shopify" }, { status: 404 });
        }

        let actionsTaken = [];
        let needsUpdate = false;
        
        const existingTags = customer.tags || [];
        const tagsToAdd = notionTags.filter((t: string) => !existingTags.includes(t));
        const tagsToRemove = existingTags.filter((t: string) => !notionTags.includes(t));
        
        if (tagsToAdd.length > 0 || tagsToRemove.length > 0) {
            needsUpdate = true;
        }

        if (!needsUpdate) {
            return json({ success: true, message: "No actions needed" });
        }

        if (tagsToAdd.length > 0) {
            const tagsAddMutation = `
                mutation tagsAdd($id: ID!, $tags: [String!]!) {
                  tagsAdd(id: $id, tags: $tags) {
                    userErrors { message }
                  }
                }
            `;
            const addRes = await admin.graphql(tagsAddMutation, { variables: { id: shopifyId, tags: tagsToAdd } });
            const addData = await addRes.json() as any;
            if (addData?.data?.tagsAdd?.userErrors?.length > 0) {
                console.error(`Failed to add tags to customer ${shopifyId}:`, addData.data.tagsAdd.userErrors);
            } else {
                actionsTaken.push(`Added Tags: ${tagsToAdd.join(", ")}`);
            }
        }

        if (tagsToRemove.length > 0) {
            const tagsRemoveMutation = `
                mutation tagsRemove($id: ID!, $tags: [String!]!) {
                  tagsRemove(id: $id, tags: $tags) {
                    userErrors { message }
                  }
                }
            `;
            const remRes = await admin.graphql(tagsRemoveMutation, { variables: { id: shopifyId, tags: tagsToRemove } });
            const remData = await remRes.json() as any;
            if (remData?.data?.tagsRemove?.userErrors?.length > 0) {
                console.error(`Failed to remove tags from customer ${shopifyId}:`, remData.data.tagsRemove.userErrors);
            } else {
                actionsTaken.push(`Removed Tags: ${tagsToRemove.join(", ")}`);
            }
        }

        const logMsg = `Customer ${shopifyId}: ${actionsTaken.join(" | ")}`;
        await logToDb(shop, "NOTION_SYNC_CUSTOMER", "success", customerId.toString(), logMsg, true, "customers");

        return json({ success: true, message: logMsg });
    } catch (err: any) {
        console.error(`Webhook processing error for ${customerId}: `, err.message);
        await logToDb(shop, "NOTION_SYNC_CUSTOMER", "error", customerId?.toString() || null, err.message, true, "customers");
        return json({ error: "Internal Server Error" }, { status: 500 });
    }
}
