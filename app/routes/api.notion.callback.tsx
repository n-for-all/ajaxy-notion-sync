import { LoaderFunctionArgs, redirect } from "@remix-run/node";
import { decrypt } from "../utils/encryption.server";
import db from "../db.server";
import { Client } from "@notionhq/client";

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const url = new URL(request.url);
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");

	if (!code || !state) {
		return new Response("Missing code or state parameter", { status: 400 });
	}

	const clientId = process.env.NOTION_CLIENT_ID;
	const clientSecret = process.env.NOTION_CLIENT_SECRET;
	const redirectUri = process.env.NOTION_REDIRECT_URI;

	if (!clientId || !clientSecret || !redirectUri) {
		return new Response("Server configuration error", { status: 500 });
	}

	let shop: string;
	try {
		shop = decrypt(state);
	} catch (error) {
		return new Response("Invalid state parameter", { status: 400 });
	}

	if (!shop.endsWith(".myshopify.com")) {
		return new Response("Invalid shop value", { status: 400 });
	}

	// Exchange code for token
	const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
	
	try {
		const tokenResponse = await fetch("https://api.notion.com/v1/oauth/token", {
			method: "POST",
			headers: {
				"Authorization": `Basic ${authHeader}`,
				"Content-Type": "application/json"
			},
			body: JSON.stringify({
				grant_type: "authorization_code",
				code: code,
				redirect_uri: redirectUri
			})
		});

		if (!tokenResponse.ok) {
			const errorData = await tokenResponse.text();
			console.error("Notion token error:", errorData);
			return new Response("Failed to authenticate with Notion", { status: 500 });
		}

		const data = await tokenResponse.json();
		const accessToken = data.access_token;
		const workspaceId = data.workspace_id;
		const notionEmail = data.owner?.user?.person?.email || null;

		if (notionEmail) {
			await db.shop.upsert({
				where: { shop },
				update: { notionEmail },
				create: { shop, notionEmail, storeName: shop.replace(".myshopify.com", "") }
			}).catch(e => console.error("Failed to save Notion email:", e));
		}

		// Fetch selected page ID immediately
		const notion = new Client({ auth: accessToken });
		let parentPageId = null;
		try {
			const searchPageResults = await notion.search({
				filter: { value: "page", property: "object" }
			});
			const activeResults = searchPageResults.results.filter((r: any) => !r.in_trash);
			const sharedPages = activeResults.filter((r: any) => r.object === "page" && r.parent?.type === "workspace");
			
			if (sharedPages.length > 0) {
				parentPageId = sharedPages[0].id;
			} else {
				const anyPage = activeResults.find((r: any) => r.object === "page");
				if (anyPage) parentPageId = anyPage.id;
			}
		} catch (err) {
			console.error("Failed to fetch page ID during connect:", err);
		}

		if (!parentPageId) {
			const shopName = shop.replace(".myshopify.com", "");
			const shopifyApiKey = process.env.SHOPIFY_API_KEY;
			return redirect(`https://admin.shopify.com/store/${shopName}/apps/${shopifyApiKey}/app/sync?error=no_page_selected`);
		}

		// Save to StoreConfig
		await db.storeConfig.upsert({
			where: { shop },
			update: {
				notionAccessToken: accessToken,
				notionWorkspaceId: workspaceId,
				notionParentPageId: parentPageId,
				notionProductsDbId: null,
				notionVariantsDbId: null,
				notionCollectionsDbId: null,
				notionCustomersDbId: null,
				notionOrdersDbId: null,
			},
			create: {
				shop,
				storeName: shop.replace(".myshopify.com", ""),
				notionAccessToken: accessToken,
				notionWorkspaceId: workspaceId,
				notionParentPageId: parentPageId,
			}
		});

		// Clear any previous sync errors on successful reconnect
		await db.notionSyncStatus.updateMany({
			where: { shop },
			data: { status: "idle", errorMessage: null }
		});
		await db.indexStatus.updateMany({
			where: { shop },
			data: { status: "idle", errorMessage: null }
		});

		// Redirect back to Shopify Admin embedded app
		const shopName = shop.replace(".myshopify.com", "");
		const shopifyApiKey = process.env.SHOPIFY_API_KEY;
		
		return redirect(`https://admin.shopify.com/store/${shopName}/apps/${shopifyApiKey}/app/sync?success=1`);

	} catch (error) {
		console.error("Error exchanging Notion token:", error);
		return new Response("Internal Server Error", { status: 500 });
	}
};
