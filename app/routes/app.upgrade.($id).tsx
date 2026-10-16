import { redirect as remixRedirect } from "@remix-run/node";
import { isAppStore } from "~/app-mode";
import { type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { GROWTH_PLAN, PLAN_CONFIG } from "~/constants";
import { checkBilling, getCurrentApp } from "./components";
import { checkTrialDays } from "~/db.server";
import * as Sentry from "@sentry/remix";
import type { BillingCheckResponseObject } from "@shopify/shopify-api";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
	// plans only exist for the App Store version (self-hosted custom apps have no Shopify billing)
	if (!isAppStore()) throw remixRedirect("/app");
	const { admin, billing, session, redirect } = await authenticate.admin(request);
	try {
		// Get plan from URL params or default to growth
		let plan: string = params.id || GROWTH_PLAN;
		
		// Validate plan exists
		if (!(plan in PLAN_CONFIG)) {
			return redirect("/app/pricing?message=Invalid plan");
		}

		let app: any = await getCurrentApp(admin);
		if (!app) {
			return redirect("/app/pricing?nope");
		}

		let trialTotal = await checkTrialDays(session);
        
        // Always request the new plan to allow upgrading and downgrading
        await billing.request({
            //@ts-ignore
            trialDays: Math.ceil(trialTotal === -1 ? PLAN_CONFIG[plan].trialDays : trialTotal),
            plan,
            isTest: !!(process.env.TEST_PAYMENT == "yes"),
            returnUrl: `${app.launchUrl}/app/complete?plan=${plan}&complete=1&shop=${session.shop}`,
        });
        
        return redirect("/app/pricing?message=Failed to initiate billing");
	} catch (e: any) {
		if (e instanceof Response) {
			return e;
		}

		Sentry.captureException(e);
		console.error(e);
		if (e.errorData) {
			console.error(e.errorData);
			Sentry.captureException(e.errorData);
		}
		return redirect("/app/pricing?message=" + e.message);
	}
};
