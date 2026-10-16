import "@shopify/shopify-app-remix/adapters/node";
import { isAppStore } from "./app-mode";
import { ApiVersion, AppDistribution, BillingInterval, DeliveryMethod, LogSeverity, shopifyApp } from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { BillingReplacementBehavior, type BillingConfig } from "@shopify/shopify-api";
import { GROWTH_PLAN, MAX_PLAN, NAMESPACE, PLAN_CONFIG } from "./constants";
import { createMetaFields, getAppInstallation, getMetaFields } from "./routes/components";
import { IAppSettings } from "./globals";

const isProduction = process.env.NODE_ENV === "production";

const shopify = shopifyApp({
	apiKey: process.env.SHOPIFY_API_KEY,
	apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
	apiVersion: ApiVersion.April26,
	scopes: process.env.SCOPES?.split(","),
	appUrl: process.env.SHOPIFY_APP_URL || "",
	authPathPrefix: "/auth",
	sessionStorage: new PrismaSessionStorage(prisma),
	distribution: isAppStore() ? AppDistribution.AppStore : AppDistribution.SingleMerchant,
	// only used by the App Store version: self-hosted custom apps never call billing (see app-mode.ts)
	billing: {
		[GROWTH_PLAN]: {
			interval: BillingInterval.Every30Days,
			amount: PLAN_CONFIG[GROWTH_PLAN].price,
			currencyCode: "USD",
			trialDays: PLAN_CONFIG[GROWTH_PLAN].trialDays,
			replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
			lineItems: [
				{
					interval: BillingInterval.Every30Days,
					amount: PLAN_CONFIG[GROWTH_PLAN].price,
					currencyCode: "USD",
				}
			],
		},
		[MAX_PLAN]: {
			interval: BillingInterval.Every30Days,
			amount: PLAN_CONFIG[MAX_PLAN].price,
			currencyCode: "USD",
			trialDays: PLAN_CONFIG[MAX_PLAN].trialDays,
			replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
			lineItems: [
				{
					interval: BillingInterval.Every30Days,
					amount: PLAN_CONFIG[MAX_PLAN].price,
					currencyCode: "USD",
				}
			],
		},
	} as BillingConfig,
	webhooks: {
		APP_UNINSTALLED: { deliveryMethod: DeliveryMethod.Http, callbackUrl: "/webhooks" },
        APP_SUBSCRIPTIONS_UPDATE: { deliveryMethod: DeliveryMethod.Http, callbackUrl: "/webhooks" },
        SHOP_UPDATE: { deliveryMethod: DeliveryMethod.Http, callbackUrl: "/webhooks" },
        
        // Products
        PRODUCTS_CREATE: { deliveryMethod: DeliveryMethod.Http, callbackUrl: "/webhooks" },
        PRODUCTS_UPDATE: { deliveryMethod: DeliveryMethod.Http, callbackUrl: "/webhooks" },
        PRODUCTS_DELETE: { deliveryMethod: DeliveryMethod.Http, callbackUrl: "/webhooks" },
        
        // Collections
        COLLECTIONS_CREATE: { deliveryMethod: DeliveryMethod.Http, callbackUrl: "/webhooks" },
        COLLECTIONS_UPDATE: { deliveryMethod: DeliveryMethod.Http, callbackUrl: "/webhooks" },
        COLLECTIONS_DELETE: { deliveryMethod: DeliveryMethod.Http, callbackUrl: "/webhooks" },
        
        // Orders
        ORDERS_CREATE: { deliveryMethod: DeliveryMethod.Http, callbackUrl: "/webhooks" },
        ORDERS_UPDATED: { deliveryMethod: DeliveryMethod.Http, callbackUrl: "/webhooks" },
        ORDERS_DELETE: { deliveryMethod: DeliveryMethod.Http, callbackUrl: "/webhooks" },
        
        // Customers
        CUSTOMERS_CREATE: { deliveryMethod: DeliveryMethod.Http, callbackUrl: "/webhooks" },
        CUSTOMERS_UPDATE: { deliveryMethod: DeliveryMethod.Http, callbackUrl: "/webhooks" },
        CUSTOMERS_DELETE: { deliveryMethod: DeliveryMethod.Http, callbackUrl: "/webhooks" },
	},
	hooks: {
		afterAuth: async ({ session, admin }) => {
			shopify.registerWebhooks({ session });
			try {

				// Get shop information from Shopify
				const shopQuery = `
					query {
						shop {
							name
							email
							primaryDomain {
								url
							}
						}
					}
				`;

				let shopName = session.shop.replace(".myshopify.com", "");
				let shopEmail = null;

				try {
					const response = await admin.graphql(shopQuery, { tries: 2 });
					const data = await response.json() as any;
					if (data?.data?.shop) {
						shopName = data.data.shop.name || shopName;
						shopEmail = data.data.shop.email || null;
					}
				} catch (shopError) {
					console.warn("Failed to fetch shop details from Shopify:", shopError);
				}

				const existingShop = await prisma.shop.findUnique({
					where: { shop: session.shop },
				});

				const shopData = {
					shop: session.shop,
					storeName: shopName,
					shopifyEmail: shopEmail,
				};

				if (!existingShop) {
					await prisma.shop.create({ data: shopData });
				} else {
					await prisma.shop.update({ where: { shop: session.shop }, data: shopData });
				}

				const existingConfig = await prisma.storeConfig.findUnique({
					where: { shop: session.shop },
				});

				if (!existingConfig) {
					// Create default StoreConfig for new installations
					await prisma.storeConfig.create({
						data: {
							shop: session.shop,
							storeName: shopName,
						},
					});
					console.log(`StoreConfig initialized for shop: ${session.shop} (${shopName})`);
				}

				const metafields = await getMetaFields(admin, NAMESPACE);

				if (!metafields || metafields.length == 0) {
					const appInstallation = await getAppInstallation(admin);
					if (appInstallation && appInstallation.id) {
						// Default settings to save
						const defaultSettings:IAppSettings = {
							labels: {
								en: {
									placeholder: 'Search...',
									recent_label: 'Recent',
									collections_label: 'Collections',
									products_label: 'Products',
									articles_label: 'Articles',
									pages_label: 'Pages',
									no_recent: 'No Recent Searches',
									show_more_label: 'Show more results for <b>%s</b>',
									products: [],
									enable_sale_tag: true,
									sale_tag: 'Sale',
									sale_tag_color: 'hsla(175, 49%, 51%, 1)',
									enable_outofstock_tag: true,
									outofstock_tag: 'Out Of Stock',
									outofstock_tag_color: 'hsla(0,0,0,1)',
									results_found_label: '<b>%s</b> results found',
									results_not_started_label: 'Type anything to start a new search',
									results_searching_label: 'Searching...',
									rtl: false,
									ai_chat_welcome_message: "Ask me anything about our products, policies, or for recommendations.",
									ai_chat_placeholder: "Ask me anything...",
									ai_chat_bot_icon: "✨",
									ai_chat_user_icon: "👤",
									ai_chat_mode: "both",
									ai_chat_default: "ai"
								}
							},
							settings: {
								selector: '.header__search',
								overlay_selector: true,
								features: 'query,collection,product,article,page',
								dark_mode: '',
								modifier_key: '$mod+KeyF'
							}
						};

						// Create metafields with defaults
						await createMetaFields(admin, NAMESPACE, appInstallation.id, defaultSettings);
						console.log(`Default search settings initialized for shop: ${session.shop}`);
					}
				}
			} catch (error) {
				console.error("Failed to initialize default settings on app install:", error);
				// Don't throw - continue with app install even if this fails
			}
		},
	},
	logger: {
		level: isProduction ? LogSeverity.Debug : LogSeverity.Debug,
		httpRequests: true,
	},
	future: {
		unstable_newEmbeddedAuthStrategy: true,
		expiringOfflineAccessTokens: true, // This is the magic flag!
	},
	...(process.env.SHOP_CUSTOM_DOMAIN ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] } : {}),
});

export default shopify;
export const apiVersion = ApiVersion.April26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
