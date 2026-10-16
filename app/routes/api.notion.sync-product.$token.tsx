import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import db from "../db.server";
import { getPlanLimits } from "../services/plan-limits.server";
import { unauthenticated } from "~/shopify.server";
import { logToDb, generateWebhookSetupHtml } from "~/services/sync/utils";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const url = new URL(request.url);
    const webhookUrl = url.href;

    const html = generateWebhookSetupHtml(webhookUrl, "Product", "Products");

    return new Response(html, {
        headers: { "Content-Type": "text/html" },
    });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
    let productId: number | null = null;
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
        const currentItems = await db.product.count({ where: { shop } });
        
        if (currentItems >= maxItems) {
            await logToDb(shop, "NOTION_SYNC_PRODUCT", "error", null, "Plan limit reached for products. Please upgrade.", true, "products");
            return json({ error: "Plan limit reached" }, { status: 403 });
        }

        const { admin } = await unauthenticated.admin(shop);

        const body = await request.json();
        const props = body?.data?.properties;

        if (!props) {
            const msg = "No properties found in payload";
            await logToDb(shop, "NOTION_SYNC_PRODUCT", "error", null, msg, true, "products");
            return json({ error: msg }, { status: 400 });
        }

        productId = props["ID"]?.number;
        const shopifyId = "gid://shopify/Product/" + productId;
        if (!shopifyId || !productId) {
            const msg = "No Shopify ID found in payload";
            console.error(msg);
            await logToDb(shop, "NOTION_SYNC_PRODUCT", "error", shopifyId, msg, true, "products");
            return json({ error: msg }, { status: 400 });
        }

        // Extract properties from Notion payload
        const notionTitle = (props["title"] || props["Name"])?.title?.map((rt: any) => rt.plain_text).join("") || "";
        const notionTags = props["Tags"]?.multi_select?.map((s: any) => s.name) || [];
        const notionSeoTitle = props["SEO Title"]?.rich_text?.map((rt: any) => rt.plain_text).join("") || "";
        const notionSeoDescription = props["SEO Description"]?.rich_text?.map((rt: any) => rt.plain_text).join("") || "";

        const shopifyProductQuery = `
      query GetProduct($id: ID!) {
        product(id: $id) {
          id
          title
          tags
          seo {
            title
            description
          }
        }
      }
    `;

        const productRes = await admin.graphql(shopifyProductQuery, { variables: { id: shopifyId } });
        const productData = (await productRes.json()) as any;
        const product = productData?.data?.product;

        if (!product) {
            const msg = `Product ${shopifyId} not found in Shopify`;
            await logToDb(shop, "NOTION_SYNC_PRODUCT", "error", null, msg, true, "products");
            return json({ error: "Product not found in Shopify" }, { status: 404 });
        }

        let actionsTaken = [];
        
        const updateInput: any = { id: shopifyId };
        let needsUpdate = false;

        // 1. Sync Title
        if (notionTitle && notionTitle !== product.title) {
            updateInput.title = notionTitle;
            needsUpdate = true;
            actionsTaken.push("Updated Title");
        }

        // 2. Sync Tags
        const existingTags = product.tags || [];
        const tagsToAdd = notionTags.filter((t: string) => !existingTags.includes(t));
        const tagsToRemove = existingTags.filter((t: string) => !notionTags.includes(t));
        
        if (tagsToAdd.length > 0 || tagsToRemove.length > 0) {
            updateInput.tags = notionTags;
            needsUpdate = true;
            actionsTaken.push(`Updated Tags`);
        }

        // 3. Sync SEO
        const existingSeoTitle = product.seo?.title || "";
        const existingSeoDesc = product.seo?.description || "";
        
        if (notionSeoTitle !== existingSeoTitle || notionSeoDescription !== existingSeoDesc) {
            updateInput.seo = {
                title: notionSeoTitle,
                description: notionSeoDescription
            };
            needsUpdate = true;
            actionsTaken.push("Updated SEO");
        }

        if (!needsUpdate) {
            return json({ success: true, message: "No actions needed" });
        }

        const updateMutation = `
        mutation productUpdate($input: ProductInput!) {
          productUpdate(input: $input) {
            userErrors { message }
          }
        }
      `;
        const res = await admin.graphql(updateMutation, { variables: { input: updateInput } });
        const updateData = await res.json() as any;
        if (updateData?.data?.productUpdate?.userErrors?.length > 0) {
            console.error(`Failed to update product ${shopifyId}:`, updateData.data.productUpdate.userErrors);
        }

        const logMsg = `Product ${shopifyId}: ${actionsTaken.join(" | ")}`;
        await logToDb(shop, "NOTION_SYNC_PRODUCT", "success", productId.toString(), logMsg, true, "products");

        return json({ success: true, message: logMsg });
    } catch (err: any) {
        console.error(`Webhook processing error for ${productId}: `, err.message);
        await logToDb(shop, "NOTION_SYNC_PRODUCT", "error", productId?.toString() || null, err.message, true, "products");
        return json({ error: "Internal Server Error" }, { status: 500 });
    }
}
