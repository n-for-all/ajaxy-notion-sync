export const FREE_PLAN = "Free";
export const NAMESPACE = "ajaxyNotionSync";

// Subscription Plans
export const GROWTH_PLAN = "growth";
export const MAX_PLAN = "max";

export const PLAN_CONFIG = {
	[GROWTH_PLAN]: {
		title: "Growth Plan",
		name: "Growth Plan",
		description: "Perfect for growing brands",
		price: 29,
		period: "/month",
		maxMessages: 5000,
		maxItems: 1500,
		maxOrders: 500,
		syncMethod: "daily",
		features: [
			"Up to 1,500 products/items",
			"Up to 500 orders/month",
			"Real-time Sync (via Shopify Webhooks)"
		],
		trialDays: 0,
		action: "Subscribe",
		url: "/app/upgrade/growth",
		variant: "secondary",
		class: "bg-surface",
	},
	[MAX_PLAN]: {
		title: "Max Plan",
		name: "Max Plan",
		description: "For scaling enterprises",
		price: 100,
		period: "/month",
		maxMessages: 30000,
		maxItems: 15000,
		maxOrders: 5000,
		syncMethod: "realtime",
		features: [
			"Up to 15,000 products/items",
			"Up to 5,000 orders/month",
			"Real-time Sync (via Shopify Webhooks)"
		],
		trialDays: 0,
		action: "Subscribe",
		url: "/app/upgrade/max",
		variant: "primary",
		class: "bg-surface",
	},
};

