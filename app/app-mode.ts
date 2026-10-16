/**
 * How the app is distributed, set with the APP_DISTRIBUTION environment variable:
 *
 * - "app_store": a public app listed on the Shopify App Store. Plans are charged with Shopify billing,
 *   plan limits apply and merchants are asked for a review.
 * - anything else (default, "single_merchant"): a self-hosted custom app installed on your own store.
 *   Shopify doesn't allow billing for custom apps, so there are no plans and no limits.
 *
 * Server only: reads process.env.
 */
export const isAppStore = (): boolean => typeof process !== "undefined" && process.env.APP_DISTRIBUTION === "app_store";

// used as the limit when there are no plans
export const UNLIMITED = 1_000_000_000;
