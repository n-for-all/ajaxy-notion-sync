import type { HeadersFunction, LinksFunction, LoaderFunctionArgs } from "@remix-run/node";
import { isAppStore } from "~/app-mode";
import { json } from "@remix-run/node";
import { Link as RemixLink, Outlet, useLoaderData, useNavigate, useNavigation, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import type { RemixLinkProps } from "@remix-run/react/dist/components";
import React from "react";

import { authenticate } from "../shopify.server";
import { Spinner } from "@shopify/polaris";

export const loader = async ({ request }: LoaderFunctionArgs) => {
	await authenticate.admin(request);

	return json({ apiKey: process.env.SHOPIFY_API_KEY || "", appStore: isAppStore() });
};

type LinkProps = Omit<RemixLinkProps, "onClick" | "to"> & {
	to: string;
};

export function Link({ children, to, ...rest }: LinkProps) {
	const navigate = useNavigate();

	const handleNavigation = React.useCallback(
		(to: string) => {
			history.pushState({}, "", to);
			navigate(to);
		},
		[navigate],
	);

	return (
		<RemixLink
			to={to}
			{...rest}
			onClick={(e) => {
				e.preventDefault();
				handleNavigation(to);
			}}
		>
			{children}
		</RemixLink>
	);
}

export default function App() {
	const { apiKey, appStore } = useLoaderData<typeof loader>();
	const navigation = useNavigation();
	return (
		<AppProvider isEmbeddedApp apiKey={apiKey}>
			<NavMenu>
				<Link to="/app" rel="home">
					Home
				</Link>
				<Link to="/app">
					Welcome
				</Link>
				<Link to="/app/sync">Notion Sync</Link>
				<Link to="/app/webhooks">Webhook Logs</Link>
				{appStore && <Link to="/app/pricing">Pricing</Link>}
				{/* <Link to="/app/debug">Debugger</Link> */}
			</NavMenu>
			{navigation.state !== "idle" ? (
				<div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "10vw" }}>
					<Spinner accessibilityLabel="Loading..." size="large" />
				</div>
			) : (
				<>
					<Outlet />
				</>
			)}
		</AppProvider>
	);
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
	return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
	return boundary.headers(headersArgs);
};
