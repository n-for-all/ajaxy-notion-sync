import { redirect as remixRedirect } from "@remix-run/node";
import { isAppStore } from "~/app-mode";
import { type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { GROWTH_PLAN, MAX_PLAN } from "~/constants";
import * as Sentry from "@sentry/remix";
import prisma from "~/db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
	// plans only exist for the App Store version (self-hosted custom apps have no Shopify billing)
	if (!isAppStore()) throw remixRedirect("/app");
	const { billing, redirect, session } = await authenticate.admin(request);
	try {
		const billingCheck = await billing.check({
			plans: [GROWTH_PLAN, MAX_PLAN],
			isTest: !!(process.env.TEST_PAYMENT == "yes"),
		});
		
		if (billingCheck.appSubscriptions && billingCheck.appSubscriptions.length > 0) {
			const subscription = billingCheck.appSubscriptions[0];
			await billing.cancel({
				subscriptionId: subscription.id,
				isTest: !!(process.env.TEST_PAYMENT == "yes"),
				prorate: true,
			});
		}

		// Delete local subscription row so they can't bypass rate limits
		if (session?.shop) {
			await prisma.subscription.deleteMany({
				where: { shop: session.shop },
			});
		}

		// App logic
		return redirect("/app/pricing");
	} catch (e) {
		if (e instanceof Response) {
			return e;
		}

		Sentry.captureException(e);
		return redirect("/app/pricing");
	}
};
