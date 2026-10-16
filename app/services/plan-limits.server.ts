import { PLAN_CONFIG } from "~/constants";
import { isAppStore, UNLIMITED } from "~/app-mode";
import prisma from "../db.server";

export interface PlanLimits {
  maxMessages: number;
  maxItems: number;
  maxOrders: number;
  syncMethod: "daily" | "realtime";
}

/**
 * Get plan limits for a shop
 */
export async function getPlanLimits(shop: string): Promise<PlanLimits> {
  // self-hosted custom app: no plans, no limits
  if (!isAppStore()) {
    return { maxMessages: UNLIMITED, maxItems: UNLIMITED, maxOrders: UNLIMITED, syncMethod: "realtime" };
  }
  try {
    const subscription = await prisma.subscription.findUnique({
      where: { shop },
      select: {
        maxMessages: true,
        maxItems: true,
        maxOrders: true,
        syncMethod: true,
      }
    });

    if (!subscription) {
      // Default to a free tier if no subscription found
      return {
        maxMessages: 100,
        maxItems: 10,
        maxOrders: 10,
        syncMethod: "daily"
      };
    }

    return {
      maxMessages: subscription.maxMessages,
      maxItems: subscription.maxItems,
      maxOrders: subscription.maxOrders,
      syncMethod: subscription.syncMethod as "daily" | "realtime",
    };
  } catch (error) {
    console.error("Error getting plan limits:", error);
    // Return growth plan defaults on error
    return {
      maxMessages: 5000,
      maxItems: 1500,
      maxOrders: 500,
      syncMethod: "daily"
    };
  }
}

/**
 * Check if shop has exceeded message limit for the current month
 */
export async function checkMessageLimit(shop: string): Promise<{ allowed: boolean; remaining: number; limit: number }> {
  try {
    const subscription = await prisma.subscription.findUnique({
      where: { shop }
    });

    if (!subscription) {
      // Do not allow if no subscription
      return { allowed: false, remaining: 0, limit: 0 };
    }

    const now = new Date();
    const shouldRefill = now >= subscription.nextRefillDate;
    const limit = subscription.maxMessages;
    
    const remaining = shouldRefill ? limit : subscription.messagesRemaining;
    const allowed = remaining > 0;

    return {
      allowed,
      remaining,
      limit,
    };
  } catch (error) {
    console.error("Error checking message limit:", error);
    // Allow on error to avoid blocking customers
    return {
      allowed: true,
      remaining: 2000,
      limit: 2000,
    };
  }
}

/**
 * Check if shop can index more items
 */
export async function checkItemLimit(shop: string, itemsToAdd: number): Promise<{ allowed: boolean; indexed: number; limit: number }> {
  try {
    const limits = await getPlanLimits(shop);

    const indexedCount = await prisma.product.count({
      where: { shop }
    }) + await prisma.collection.count({
      where: { shop }
    });

    const canAdd = indexedCount + itemsToAdd <= limits.maxItems;

    return {
      allowed: canAdd,
      indexed: indexedCount,
      limit: limits.maxItems,
    };
  } catch (error) {
    console.error("Error checking item limit:", error);
    // Allow on error
    return {
      allowed: true,
      indexed: 0,
      limit: 1000,
    };
  }
}

/**
 * Enforce rate limiting based on plan
 */
export async function enforceRateLimits(shop: string): Promise<{ allowed: boolean; reason?: string }> {
  const messageCheck = await checkMessageLimit(shop);
  if (!messageCheck.allowed) {
    return {
      allowed: false,
      reason: `Monthly message limit of ${messageCheck.limit} reached`
    };
  }

  return { allowed: true };
}
