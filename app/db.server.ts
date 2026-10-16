import { PrismaClient } from "@prisma/client";
import { type Session } from "@shopify/shopify-api";
import { GROWTH_PLAN, PLAN_CONFIG } from "./constants";

declare global {
    var prisma: PrismaClient;
}

const prisma: PrismaClient = global.prisma || new PrismaClient();

if (process.env.NODE_ENV !== "production") {
    if (!global.prisma) {
        global.prisma = new PrismaClient();
    }
} 

export const syncSubscription = async (
    session: Session,
    name: string,
    subscriptionId: string,
    chargeId: string,
    trialDays: number = 0,
) => {
    const sessionParams = session.toObject();

    // a shop has a single subscription row (shop is unique)
    const existing = await prisma.subscription.findUnique({
        where: { shop: session.shop }
    });

    let plan = PLAN_CONFIG[name as keyof typeof PLAN_CONFIG];
    if (!plan) {
        plan = PLAN_CONFIG[GROWTH_PLAN];
    }
    let now = new Date();

    if (!existing) {
        await prisma.subscription.create({
            data: {
                name: name,
                trialDays: trialDays,
                subscriptionId: subscriptionId,
                chargeId: chargeId,
                createdAt: new Date(),
                installed: true,
                shop: session.shop,
                maxItems: plan.maxItems,
                maxOrders: plan.maxOrders || 500,
                maxMessages: plan.maxMessages,
                price: plan.price,
                syncMethod: plan.syncMethod,
                plan: name,
                messagesRemaining: plan.maxMessages,
                nextRefillDate: new Date(now.getFullYear(), now.getMonth() + 1, now.getDate()),
                firstName:
                    sessionParams.onlineAccessInfo?.associated_user
                        ?.first_name || null,
                lastName:
                    sessionParams.onlineAccessInfo?.associated_user?.last_name ||
                    null,
                email:
                    sessionParams.onlineAccessInfo?.associated_user?.email ||
                    null,
                accountOwner:
                    sessionParams.onlineAccessInfo?.associated_user
                        ?.account_owner || false,
                locale:
                    sessionParams.onlineAccessInfo?.associated_user?.locale ||
                    null,
                collaborator:
                    sessionParams.onlineAccessInfo?.associated_user
                        ?.collaborator || false,
                emailVerified:
                    sessionParams.onlineAccessInfo?.associated_user
                        ?.email_verified || false,
            },
        });
    } else if (existing.subscriptionId !== subscriptionId) {
        // the merchant changed plan: update the existing row instead of failing on the unique shop
        await prisma.subscription.update({
            where: { shop: session.shop },
            data: {
                name: name,
                plan: name,
                subscriptionId: subscriptionId,
                chargeId: chargeId || existing.chargeId,
                maxItems: plan.maxItems,
                maxOrders: plan.maxOrders || 500,
                maxMessages: plan.maxMessages,
                price: plan.price,
                syncMethod: plan.syncMethod,
            },
        });
    }
};

export const createTrialSubscription = async (
    session: Session,
    name: string = GROWTH_PLAN,
    subscriptionId: string,
    chargeId: string,
    trialDays: number = 0,
) => {
    const sessionParams = session.toObject();

    let checkTrial = await checkTrialDays(session);
    let plan = PLAN_CONFIG[name as keyof typeof PLAN_CONFIG];
    if (!plan) {
        plan = PLAN_CONFIG[GROWTH_PLAN];
    }

    let now = new Date();

    if (checkTrial == -1) {
        await prisma.subscription.create({
            data: {
                name: name,
                trialDays: trialDays,
                subscriptionId: subscriptionId,
                chargeId: chargeId,
                maxItems: plan.maxItems,
                maxOrders: plan.maxOrders || 500,
                maxMessages: plan.maxMessages,
                price: plan.price,
                syncMethod: plan.syncMethod,
                plan: name,
                messagesRemaining: plan.maxMessages,
                nextRefillDate: new Date(now.getFullYear(), now.getMonth() + 1, now.getDate()),
                createdAt: new Date(),
                installed: true,
                shop: session.shop,
                firstName:
                    sessionParams.onlineAccessInfo?.associated_user
                        .first_name || null,
                lastName:
                    sessionParams.onlineAccessInfo?.associated_user.last_name ||
                    null,
                email:
                    sessionParams.onlineAccessInfo?.associated_user.email ||
                    null,
                accountOwner:
                    sessionParams.onlineAccessInfo?.associated_user
                        .account_owner || false,
                locale:
                    sessionParams.onlineAccessInfo?.associated_user.locale ||
                    null,
                collaborator:
                    sessionParams.onlineAccessInfo?.associated_user
                        .collaborator || false,
                emailVerified:
                    sessionParams.onlineAccessInfo?.associated_user
                        .email_verified || false,
            },
        });
        return trialDays;
    } else {
        return checkTrial;
    }
};

export const checkTrialDays = async (session: Session) => {
    let subscriptions = await prisma.subscription.findMany({
        where: { shop: session.shop },
    });
    if (subscriptions && subscriptions.length > 0) {
        let total = subscriptions
            .map((sub) => {
                if (
                    sub.createdAt.getTime() +
                    1000 * 60 * 60 * 24 * sub.trialDays >
                    new Date().getTime()
                ) {
                    return (
                        (sub.createdAt.getTime() +
                            1000 * 60 * 60 * 24 * sub.trialDays -
                            new Date().getTime()) /
                        (1000 * 60 * 60 * 24)
                    );
                }
                return 0;
            })
            .reduce((a, b) => a + b, 0);

        return Math.max(0, total);
    }

    return -1;
};

export const consumeMessage = async (shop: string): Promise<boolean> => {
    const sub = await prisma.subscription.findUnique({ where: { shop } });

    if (!sub) {
        console.error(`Subscription not found for shop: ${shop}`);
        return false;
    }

    const now = new Date();

    // If we are past the stored nextRefillDate, we are in a new cycle
    const shouldRefill = now >= sub.nextRefillDate;

    // Get plan config to determine max messages
    const planConfig = PLAN_CONFIG[sub.plan as keyof typeof PLAN_CONFIG];
    if (!planConfig) {
        console.error(`Invalid plan: ${sub.plan}`);
        return false;
    }

    const planMax = planConfig.maxMessages;

    // Get current balance (reset if new cycle)
    const currentBalance = shouldRefill ? planMax : sub.messagesRemaining;

    // Check if out of messages
    if (currentBalance <= 0) {
        return false;
    }

    // Consume the message
    await prisma.subscription.update({
        where: { shop },
        data: {
            messagesRemaining: currentBalance - 1,
            ...(shouldRefill && {
                // Set next refill date to exactly 1 month from today
                nextRefillDate: new Date(now.getFullYear(), now.getMonth() + 1, now.getDate()),
            }),
        },
    });

    // Messages are available, return true
    return true;
};

export default prisma;
