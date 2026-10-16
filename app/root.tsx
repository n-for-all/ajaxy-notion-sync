import { captureRemixErrorBoundaryError, withSentry } from "@sentry/remix";
import { Links, Meta, Outlet, Scripts, ScrollRestoration, isRouteErrorResponse, useRouteError } from "@remix-run/react";
import "./style.css";

//@ts-ignore
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { LinksFunction } from "@remix-run/node";

// 2. Export the links function to make Remix inject it into the <Links /> head tag
export const links: LinksFunction = () => [
  { rel: "stylesheet", href: polarisStyles },
  { rel: "icon", href: "/favicon.png", type: "image/png" },
];
// import "./tailwind.css";
export function ErrorBoundary() {
	const error = useRouteError();
	captureRemixErrorBoundaryError(error);
	return (
		<div
			style={{
				padding: "20px",
				backgroundColor: "#ff000021",
				maxWidth: "600px",
				margin: "10px auto",
				borderRadius: "5px",
				border: "1px solid #f8abab",
				color: "#7a0c0c",
				overflow: "auto",
			}}
		>
			{isRouteErrorResponse(error) ? (
				<>
					<h1 style={{ marginBottom: "10px", marginTop: 0 }}>
						{error.status} {error.statusText}
					</h1>
					<p>{error.data}</p>
				</>
			) : error instanceof Error ? (
				<>
					<h1>Error</h1>
					<p>{error.message}</p>
					<p>The stack trace is:</p>
					<pre style={{ maxWidth: "100%", overflow: "auto" }}>{error.stack}</pre>
				</>
			) : (
				<h1>An unknown error has occurred in loading the page, please reload it</h1>
			)}
			<div style={{ fontSize: "0.9rem" }}>
				We encountered an issue. We apologize for the inconvenience and are working to resolve it. In the meantime, you can contact us at{" "}
				<a
					style={{
						background: "#f5c0bc",
						padding: "0 4px",
						border: "1px solid #ff00003b",
						textDecoration: "none",
						borderRadius: "3px",
						color: "#6d2a2a",
					}}
					href="https://github.com/n-for-all/ajaxy-notion-sync/issues"
				>
					open an issue on GitHub
				</a>{" "}
				if you have any questions
			</div>
		</div>
	);
}

function App() { 
	return (
		<html suppressHydrationWarning={true}>
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width,initial-scale=1" />
				<link rel="preconnect" href="https://cdn.shopify.com/" />
				<link rel="stylesheet" href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css" />
				<Meta />
				<Links />
			</head>
			<body>
				<Outlet />
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	);
}

export default withSentry(App);
