import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import db from "../db.server";
import { getPlanLimits } from "../services/plan-limits.server";
import { unauthenticated } from "../shopify.server";
import { logToDb, generateWebhookSetupHtml } from "../services/sync/utils";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const url = new URL(request.url);
    const webhookUrl = url.href;

    const html = generateWebhookSetupHtml(webhookUrl, "Variant", "Variants");

    return new Response(html, {
        headers: { "Content-Type": "text/html" },
    });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
    let variantId: number | null = null;
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
            await logToDb(shop, "NOTION_SYNC_VARIANT", "error", null, "Plan limit reached for items. Please upgrade.", true, "variants");
            return json({ error: "Plan limit reached" }, { status: 403 });
        }

        const { admin } = await unauthenticated.admin(shop);

        const body = await request.json();
        const props = body?.data?.properties; 

        if (!props) {
            const msg = "No properties found in payload";
            await logToDb(shop, "NOTION_SYNC_VARIANT", "error", null, msg, true, "variants");
            return json({ error: msg }, { status: 400 });
        }

        variantId = props["ID"]?.number;
        const shopifyId = "gid://shopify/ProductVariant/" + variantId;
        if (!shopifyId || !variantId) {
            const msg = "No Shopify ID found in payload";
            console.error(msg);
            await logToDb(shop, "NOTION_SYNC_VARIANT", "error", shopifyId, msg, true, "variants");
            return json({ error: msg }, { status: 400 });
        }

        // Extract properties from Notion payload
        const notionBarcode = props["Barcode"]?.rich_text?.map((rt: any) => rt.plain_text).join("") || "";
        const notionCompareAtPrice = props["Compare At Price"]?.number;
        const notionPrice = props["Price"]?.number;
        const notionInventory = props["Inventory"]?.number;
        const notionWeight = props["Weight"]?.number;
        const notionWeightUnit = props["Weight Unit"]?.select?.name;
        const notionSku = props["SKU"]?.rich_text?.map((rt: any) => rt.plain_text).join("") || "";

        const shopifyVariantQuery = `
      query GetVariant($id: ID!) {
        productVariant(id: $id) {
          id
          product { id }
          sku
          barcode
          price
          compareAtPrice
          inventoryQuantity
          inventoryItem {
            id
            measurement {
              weight {
                value
                unit
              }
            }
            inventoryLevels(first: 1) {
              nodes {
                quantities(names: ["available"]) {
                  name
                  quantity
                }
                location {
                  id
                }
              }
            }
          }
        }
      }
    `;

        const variantRes = await admin.graphql(shopifyVariantQuery, { variables: { id: shopifyId } });
        const variantData = (await variantRes.json()) as any;
        const variant = variantData?.data?.productVariant;

        if (!variant) {
            const msg = `Variant ${shopifyId} not found in Shopify`;
            await logToDb(shop, "NOTION_SYNC_VARIANT", "error", null, msg, true, "variants");
            return json({ error: "Variant not found in Shopify" }, { status: 404 });
        }

        let actionsTaken = [];
        
        const updateInput: any = { id: shopifyId };
        let needsVariantUpdate = false;
        let needsInventoryUpdate = false;

        // 1. Sync Basic Properties
        if (notionBarcode && notionBarcode !== (variant.barcode || "")) {
            updateInput.barcode = notionBarcode;
            needsVariantUpdate = true;
            actionsTaken.push("Updated Barcode");
        }
        
        if (notionSku && notionSku !== (variant.sku || "")) {
            updateInput.sku = notionSku;
            needsVariantUpdate = true;
            actionsTaken.push("Updated SKU");
        }

        if (notionPrice !== undefined && notionPrice !== null) {
            if (Number(notionPrice) !== Number(variant.price)) {
                updateInput.price = String(notionPrice);
                needsVariantUpdate = true;
                actionsTaken.push("Updated Price");
            }
        }

        if (notionCompareAtPrice !== undefined) {
            const currentCompareAt = variant.compareAtPrice ? Number(variant.compareAtPrice) : null;
            const newCompareAt = notionCompareAtPrice === null ? null : Number(notionCompareAtPrice);
            
            if (newCompareAt !== currentCompareAt) {
                updateInput.compareAtPrice = notionCompareAtPrice === null ? null : String(notionCompareAtPrice);
                needsVariantUpdate = true;
                actionsTaken.push("Updated Compare At Price");
            }
        }

        const currentWeight = variant.inventoryItem?.measurement?.weight?.value;
        const currentWeightUnit = variant.inventoryItem?.measurement?.weight?.unit;

        if (notionWeight !== undefined) {
            const newWeight = notionWeight === null ? 0 : notionWeight;
            const currentWeightVal = currentWeight || 0;
            
            if (newWeight !== currentWeightVal) {
                updateInput.inventoryItem = {
                    measurement: {
                        weight: {
                            value: newWeight,
                            unit: notionWeightUnit ? notionWeightUnit.toUpperCase() : (currentWeightUnit || "KILOGRAMS")
                        }
                    }
                };
                needsVariantUpdate = true;
                actionsTaken.push("Updated Weight");
            }
        }
        
        // 2. Sync Inventory
        let locationId = variant.inventoryItem?.inventoryLevels?.nodes?.[0]?.location?.id;
        let inventoryItemId = variant.inventoryItem?.id;
        let currentQuantity = variant.inventoryItem?.inventoryLevels?.nodes?.[0]?.quantities?.[0]?.quantity || 0;
        
        if (notionInventory !== undefined && notionInventory !== null && notionInventory !== currentQuantity) {
            if (locationId && inventoryItemId) {
                needsInventoryUpdate = true;
            } else {
                console.error(`Cannot update inventory for variant ${shopifyId}: missing locationId or inventoryItemId`);
                actionsTaken.push("Failed to update Inventory (No Location)");
            }
        }

        if (!needsVariantUpdate && !needsInventoryUpdate) {
            return json({ success: true, message: "No actions needed" });
        }

        // Apply Variant Update
        if (needsVariantUpdate) {
            const updateMutation = `
        mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            userErrors { message }
          }
        }
      `;
            const res = await admin.graphql(updateMutation, { variables: { productId: variant.product.id, variants: [updateInput] } });
            const updateData = await res.json() as any;
            if (updateData?.data?.productVariantsBulkUpdate?.userErrors?.length > 0) {
                console.error(`Failed to update variant ${shopifyId}:`, updateData.data.productVariantsBulkUpdate.userErrors);
            }
        }
        
        // Apply Inventory Update
        if (needsInventoryUpdate) {
            const inventoryMutation = `
            mutation inventorySetQuantities($input: InventorySetQuantitiesInput!, $key: String!) {
              inventorySetQuantities(input: $input) @idempotent(key: $key) {
                userErrors {
                  field
                  message
                }
              }
            }
            `;
            const invInput = {
                name: "available",
                reason: "correction",
                quantities: [
                    {
                        inventoryItemId: inventoryItemId,
                        locationId: locationId,
                        quantity: Math.round(notionInventory!),
                        changeFromQuantity: currentQuantity
                    }
                ]
            };
            
            const idempotencyKey = String(Date.now()) + Math.random().toString(36).substring(2);
            
            const res = await admin.graphql(inventoryMutation, { variables: { input: invInput, key: idempotencyKey } });
            const invData = await res.json() as any;
            if (invData?.data?.inventorySetQuantities?.userErrors?.length > 0) {
                console.error(`Failed to update inventory for variant ${shopifyId}:`, invData.data.inventorySetQuantities.userErrors);
            } else {
                actionsTaken.push("Updated Inventory");
            }
        }

        const logMsg = `Variant ${shopifyId}: ${actionsTaken.length > 0 ? actionsTaken.join(" | ") : "No actions needed"}`;
        await logToDb(shop, "NOTION_SYNC_VARIANT", "success", variantId.toString(), logMsg, true, "variants");

        return json({ success: true, message: logMsg });
    } catch (err: any) {
        console.error(`Webhook processing error for ${variantId}: `, err.message);
        await logToDb(shop, "NOTION_SYNC_VARIANT", "error", variantId?.toString() || null, err.message, true, "variants");
        return json({ error: "Internal Server Error" }, { status: 500 });
    }
}
