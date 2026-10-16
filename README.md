<p align="center">
  <a href="https://github.com/n-for-all/ajaxy-notion-sync">
    <img alt="Notion Sync for Shopify" src="public/logo.png" width="120" />
  </a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License: MIT"></a>
  <a href="https://github.com/n-for-all/ajaxy-notion-sync/stargazers"><img src="https://img.shields.io/github/stars/n-for-all/ajaxy-notion-sync.svg" alt="GitHub stars"></a>
  <img src="https://img.shields.io/badge/Shopify-app-7AB55C?logo=shopify&logoColor=white" alt="Shopify app">
  <img src="https://img.shields.io/badge/Notion-integration-000000?logo=notion&logoColor=white" alt="Notion integration">
</p>

<div align="center">
  <h2>Sync your Shopify store with Notion, both ways</h2>
  Products, collections, variants, customers and orders in Notion databases, kept up to date automatically.<br />
  Edit in Notion and Shopify is updated. Fulfill, cancel or resend orders from Notion.<br /><br />
  Built with Remix, Polaris, Prisma and the Notion API.
</div>

<p align="center">
  <br />
  <a href="#setup"><strong>Get started »</strong></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/n-for-all/ajaxy-notion-sync/issues">Report a bug</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/n-for-all/ajaxy-notion-sync/issues">Request a feature</a>
  <br />
</p>

<!-- Add a screenshot of the app at docs/screenshot.png and uncomment:
<p align="center">
  <img src="docs/screenshot.png" width="100%" alt="Notion Sync for Shopify" />
</p>
-->

> **Self-hosted.** This app isn't listed on the Shopify App Store. You run it on your own server and install it on your store as a custom app. Your store's data goes straight to your own Notion workspace.

## Features

-   **Shopify → Notion:** products, collections, variants, customers and orders synced to Notion databases
-   **Live updates:** new and changed items in Shopify reach Notion automatically, through Shopify webhooks
-   **Notion → Shopify:** edit order tags and notes, products, variants and customers in Notion
-   **Order buttons in Notion:** fulfill, cancel or resend an order confirmation from the order's page
-   **Sync dashboard** with progress per entity, and a **log** of every webhook and its result
-   **Secret links** for Notion automations, with one-click key regeneration
-   **Privacy built in:** customer deletion requests remove the customer from the database and from Notion
-   **App Store mode:** turn on Shopify billing, plans and review prompts with one setting
-   Works with **PM2** and any Node.js host

## Road Map

-   [ ] Docker image and Compose file
-   [ ] Connect Notion with an internal integration token (no OAuth setup)
-   [ ] Opt-in switch for syncing customer emails and phone numbers
-   [ ] Encrypt the stored Notion access token
-   [ ] Choose which properties sync for each database

Pull requests are welcome! <3

## Requirements

-   Node.js 20 or later
-   PostgreSQL 14 or later
-   A server reachable over **HTTPS** (Shopify and Notion need to call it)
-   [Shopify CLI](https://shopify.dev/docs/apps/tools/cli) on your computer
-   A Shopify store, and a Notion workspace where you can create integrations

## Setup

### 1. Get the code

```bash
git clone https://github.com/n-for-all/ajaxy-notion-sync.git
cd ajaxy-notion-sync
npm install
cp .env.example .env
```

### 2. Create the database

Create an empty PostgreSQL database and put its connection string in `.env`:

```
DATABASE_URL=postgresql://user:password@localhost:5432/notion_sync
```

### 3. Create the Shopify app

1. In the [Shopify Dev Dashboard](https://dev.shopify.com/), create a new app.
2. Copy the app's **Client ID** and **Client secret** into `.env` as `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET`.
3. In `shopify.app.toml`, replace `YOUR_SHOPIFY_CLIENT_ID` with the Client ID and every `YOUR_APP_DOMAIN` with your server's domain.
4. Set `SHOPIFY_APP_URL` in `.env` to the same address, for example `https://notion-sync.example.com`.
5. Push the configuration (URLs and scopes) to Shopify:
    ```bash
    npm run deploy
    ```
6. In the Dev Dashboard, choose **Custom distribution** and enter your store's `.myshopify.com` domain. You'll get an install link for that store.

### 4. Create the Notion integration

1. Go to [Notion integrations](https://www.notion.so/profile/integrations) and create a new integration of type **Public**. It's needed for the "Connect Notion" button, which uses OAuth.
2. Set the **redirect URI** to `https://YOUR_APP_DOMAIN/api/notion/callback`.
3. Give it permission to read, update and insert content.
4. Copy the **OAuth client ID** and **client secret** into `.env`:
    ```
    NOTION_CLIENT_ID=...
    NOTION_CLIENT_SECRET=...
    NOTION_REDIRECT_URI=https://YOUR_APP_DOMAIN/api/notion/callback
    ```

### 5. Build and run

```bash
npm run setup    # generates the database client and creates the tables
npm run build
npm start        # listens on PORT (default 3000)
```

Put the app behind your web server (for example Nginx) so it's reachable over HTTPS at `SHOPIFY_APP_URL`.

**PM2:**

```bash
pm2 start npm --name notion-sync -- start
pm2 save
```

### 6. Install and connect

1. Open the install link from step 3 and install the app on your store.
2. In the app, click **Connect Notion**, sign in and choose the page where the app should create its databases.
3. Open **Notion Sync** and run the first sync.

### 7. Turn on Notion → Shopify updates (optional)

On the **Notion Sync** page, the app shows:

-   **Webhook links** for orders, products, variants and customers. In each Notion database, add an automation with the action **Send webhook**, paste the matching link, and include all properties.
-   **Button formulas** for Fulfill, Cancel and Resend. Add them as formula properties in your Orders database.

**Keep these links private.** They contain a secret key: anyone who has them can update products and cancel or fulfill orders. If they've been shared with someone you don't trust, click **Generate a new secret key** on the Notion Sync page, then update the links in Notion.

## Development

```bash
npm install
shopify app dev
```

`shopify app dev` (Shopify CLI) creates a tunnel, updates the app URLs and installs the app on your development store.

## Configuration

All settings are environment variables, documented in [`.env.example`](.env.example).

| Variable | Required | Description |
|---|---|---|
| `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` | Yes | From your Shopify app |
| `SHOPIFY_APP_URL` | Yes | Public HTTPS address of the server |
| `SCOPES` | Yes | Shopify access scopes (keep the default) |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`, `NOTION_REDIRECT_URI` | Yes | From your Notion integration |
| `APP_DISTRIBUTION` | No | `single_merchant` (default) or `app_store`, see below |
| `PORT` | No | Port to listen on (default 3000) |
| `FEEDBACK_EMAIL_TO`, `FEEDBACK_EMAIL_FROM` | No | Where the in-app "Contact us" form is sent (uses `sendmail`) |
| `SENTRY_DSN`, `VITE_SENTRY_DSN`, `SENTRY_*` | No | Error reporting with Sentry |

### Self-hosted vs. App Store mode

-   **`single_merchant` (default):** for a custom app on your own store. Shopify doesn't allow billing for custom apps, so there are no plans and no limits, and the Pricing page is hidden.
-   **`app_store`:** for a public app submitted to the Shopify App Store. Plans are charged with Shopify billing, plan limits apply, and merchants are asked for a review once they're set up. The plans are defined in `app/constants.tsx`. If you take this route, note that Shopify may treat an app whose main purpose is sending data to another platform as a "connector app", which needs written consent from that platform.

## Updating

```bash
git pull
npm install
npm run setup
npm run build
pm2 restart notion-sync
```

## Data and privacy

-   Store data is kept in your PostgreSQL database and in your Notion workspace.
-   When a customer asks your store to delete their data, the app deletes them from the database and from Notion, and removes their details from their orders.
-   When Shopify sends the shop deletion request after the app is uninstalled, all of the store's data is deleted from the database.

## Troubleshooting

-   **The app doesn't load in the Shopify admin:** check that `SHOPIFY_APP_URL` and `application_url` in `shopify.app.toml` match your HTTPS address, and run `npm run deploy` again after changing them.
-   **"Connect Notion" fails:** the redirect URI must be exactly the same in the Notion integration and in `NOTION_REDIRECT_URI`.
-   **Changes in Shopify don't reach Notion:** open **Webhook Logs** in the app. Every webhook and its result is listed there.
-   **Notion edits don't reach Shopify:** check the automation in Notion uses the current webhook link (after generating a new secret key, all links change) and sends all properties.

## Contributing

Issues and pull requests are welcome: [github.com/n-for-all/ajaxy-notion-sync/issues](https://github.com/n-for-all/ajaxy-notion-sync/issues).

## License

[MIT](LICENSE)

---

<div align="center">
  <h3>Need help setting it up, or a custom app for your store?</h3>
  We build Shopify apps, Notion integrations and custom e-commerce solutions.<br />
  We can install and host Notion Sync for you, or build exactly what your business needs.<br /><br />
  <a href="https://ajaxy.org"><strong>ajaxy.org</strong></a>
  &nbsp;·&nbsp;
  <a href="https://nextmark.ae"><strong>nextmark.ae</strong></a>
  <br /><br />
  <sub>Made by <a href="https://ajaxy.org">Ajaxy</a> and <a href="https://nextmark.ae">NextMark</a></sub>
</div>
