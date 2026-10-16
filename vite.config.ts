import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig, type UserConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { sentryVitePlugin } from "@sentry/vite-plugin";

// Related: https://github.com/remix-run/remix/issues/2835#issuecomment-1144102176
// Replace the HOST env var with SHOPIFY_APP_URL so that it doesn't break the remix server. The CLI will eventually
// stop passing in HOST, so we can remove this workaround after the next major release.
if (process.env.HOST && (!process.env.SHOPIFY_APP_URL || process.env.SHOPIFY_APP_URL === process.env.HOST)) {
	process.env.SHOPIFY_APP_URL = process.env.HOST;
	delete process.env.HOST;
}

const host = new URL(process.env.SHOPIFY_APP_URL || "http://localhost").hostname;

const isProduction = process.env.NODE_ENV === "production";
console.log("isProduction", isProduction);
let hmrConfig;
if (host === "localhost") {
	hmrConfig = {
		protocol: "ws",
		host: "localhost",
		port: 64999,
		clientPort: 64999,
	};
} else {
	hmrConfig = {
		protocol: "wss",
		host: host,
		port: parseInt(process.env.FRONTEND_PORT!) || 8002,
		clientPort: 443,
	};
}

export default defineConfig({
	server: {
		port: Number(process.env.PORT || 8002),
		hmr: hmrConfig,
		fs: {
			// See https://vitejs.dev/config/server-options.html#server-fs-allow for more information
			allow: ["app", "node_modules"],
		},
		// extra hostnames allowed to reach the dev server (e.g. your tunnel), comma separated
		allowedHosts: (process.env.ALLOWED_HOSTS || "").split(",").map((h) => h.trim()).filter(Boolean),
	},
	plugins: [
		remix({
			basename: !isProduction ? "/" : "/",
			ignoredRouteFiles: ["**/.*"],
		}),
		tsconfigPaths(),
		// optional: only when Sentry is configured
		...(process.env.SENTRY_AUTH_TOKEN
			? [
		sentryVitePlugin({
			authToken: process.env.SENTRY_AUTH_TOKEN,
			org: process.env.SENTRY_ORG,
			project: process.env.SENTRY_PROJECT,
			sourcemaps: {
				disable: true, // This explicitly tells the plugin to ignore sourcemaps
			},
			release: {
				name: "ajaxy-notion-sync@1.0.0", // Add your version
			},
			telemetry: false,
		}),
				]
			: []),
	],
	base: !isProduction ? "/" : "/",
	build: {
		assetsInlineLimit: 0,
		sourcemap: false, // Source map generation must be turned on
	},
	ssr: {
		// This forces Vite to process DOMPurify correctly for Remix SSR
		noExternal: ["dompurify"],
	},
}) satisfies UserConfig;
