import { useEffect } from "react";

const SESSION_KEY = "ajaxy-review-requested";

/**
 * Opens Shopify's native "Leave a review" popup (App Bridge reviews API) after a successful moment,
 * e.g. when the merchant opens the app with everything set up.
 *
 * Shopify decides if the popup is shown: never in the first 24 hours after install, at most once every
 * 60 days and 3 times a year, and never once the merchant has reviewed. We only make sure to ask at most
 * once per browser session, a few seconds after the page loads so it doesn't interrupt.
 */
export function useReviewRequest(enabled: boolean, delayMs: number = 4000) {
	useEffect(() => {
		if (!enabled) return;
		try {
			if (window.sessionStorage.getItem(SESSION_KEY)) return;
		} catch (e) {}

		const timer = window.setTimeout(async () => {
			try {
				window.sessionStorage.setItem(SESSION_KEY, "1");
			} catch (e) {}
			try {
				//@ts-ignore App Bridge global
				await window.shopify?.reviews?.request();
			} catch (e) {}
		}, delayMs);

		return () => window.clearTimeout(timer);
	}, [enabled, delayMs]);
}
