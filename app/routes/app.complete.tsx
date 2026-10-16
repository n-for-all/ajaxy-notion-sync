import { redirect as remixRedirect } from "@remix-run/node";
import { isAppStore } from "~/app-mode";
import { type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { GROWTH_PLAN, MAX_PLAN, PLAN_CONFIG } from "~/constants";
import * as Sentry from "@sentry/remix";
import { checkTrialDays, createTrialSubscription } from "~/db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
	// plans only exist for the App Store version (self-hosted custom apps have no Shopify billing)
	if (!isAppStore()) throw remixRedirect("/app");
	const { session, billing, redirect } = await authenticate.admin(request);

	const url = new URL(request.url);

	try {
		const planParam = (url.searchParams.get("plan") as string).toLowerCase();
		const validPlans = [GROWTH_PLAN, MAX_PLAN];
		
		// Validate plan exists
		if (!validPlans.includes(planParam)) {
			return redirect("/app/pricing?message=Invalid plan");
		}

		const plan = planParam as typeof GROWTH_PLAN | typeof MAX_PLAN;
		let trialTotal = await checkTrialDays(session);

		//if we don't have a trial subscription, create one
		if (trialTotal === -1) {
			const { hasActivePayment, appSubscriptions } = await billing.check({
				plans: validPlans,
				isTest: !!(process.env.TEST_PAYMENT == "yes"),
			});

			if (hasActivePayment && appSubscriptions.length > 0) {
				const subscription = appSubscriptions[0];

				let chargeId = url.searchParams.get("charge_id") as string;
				await createTrialSubscription(session, plan, subscription.id, chargeId || "", PLAN_CONFIG[plan].trialDays);

				return redirect(`/app`);
			} else {
				return redirect(`/app/pricing`);
			}
		} else {
			// Redirect back to pricing since we already have a trial subscription
			return redirect("/app");
		}
	} catch (e: any) {
		Sentry.captureException(e);
		return redirect("/app/pricing?message=" + encodeURIComponent(e ? e.message : "An error occurred while processing your request."));
	}
};
