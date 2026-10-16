import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import {
    Page,
    Layout,
    Card,
    DataTable,
    Badge,
    Text,
    AppProvider,
    EmptyState,
    Pagination,
    BlockStack,
    InlineStack
} from "@shopify/polaris";

import db from "../db.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
    const { token } = params;

    if (!token) {
        throw new Response("Unauthorized: Missing sync token", { status: 401 });
    }

    const storeConfig = await db.storeConfig.findFirst({
        where: { syncToken: token }
    });

    if (!storeConfig) {
        throw new Response("Unauthorized: Invalid sync token", { status: 403 });
    }

    // --- PAGINATION SETUP ---
    const url = new URL(request.url);
    const pageParam = url.searchParams.get("page");
    const currentPage = pageParam ? Math.max(1, parseInt(pageParam, 10)) : 1;
    const itemsPerPage = 50;
    const skipAmount = (currentPage - 1) * itemsPerPage;

    // Run both the count and the fetch in parallel for better performance
    const [logs, totalLogs] = await Promise.all([
        db.webhookStatus.findMany({
            where: { shop: storeConfig.shop },
            orderBy: { updatedAt: "desc" },
            take: itemsPerPage,
            skip: skipAmount,
        }),
        db.webhookStatus.count({
            where: { shop: storeConfig.shop }
        })
    ]);

    const totalPages = Math.ceil(totalLogs / itemsPerPage);

    return json({
        logs,
        shop: storeConfig.shop,
        currentPage,
        totalPages,
        totalLogs
    });
};

export default function WebhookLogsPage() {
    const { logs, shop, currentPage, totalPages, totalLogs } = useLoaderData<typeof loader>();
    const [searchParams, setSearchParams] = useSearchParams();

    // Handle page changes by updating the URL query parameter
    const handleNextPage = () => {
        if (currentPage < totalPages) {
            searchParams.set("page", String(currentPage + 1));
            setSearchParams(searchParams);
        }
    };

    const handlePreviousPage = () => {
        if (currentPage > 1) {
            searchParams.set("page", String(currentPage - 1));
            setSearchParams(searchParams);
        }
    };

    const rows = logs.map((log) => [
        new Date(log.updatedAt).toLocaleString(),
        <Text as="span" fontWeight="bold">{log.topic}</Text>,
        <Badge tone={log.status === "error" || log.status === "Error" ? "critical" : "success"}>
            {log.status}
        </Badge>,
        <Text as="span" tone={log.status === "error" || log.status === "Error" ? "critical" : "subdued"}>
            {log.output || "Success"}
        </Text>,
    ]);

    return (
        <AppProvider i18n={{}}>
            <Page
                title="Webhook Sync Status"
                subtitle={`Viewing latest webhook executions for ${shop}`}
            >
                <Layout>
                    <Layout.Section>
                        <Card padding="0">
                            <BlockStack gap="0">
                                {logs.length === 0 ? (
                                    <EmptyState
                                        heading="No webhooks recorded yet"
                                        image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                                    >
                                        <p>When Shopify sends a webhook, its status will appear here.</p>
                                    </EmptyState>
                                ) : (
                                    <>
                                        <DataTable
                                            columnContentTypes={["text", "text", "text", "text"]}
                                            headings={["Last Updated", "Webhook Topic", "Status", "Output / Error"]}
                                            rows={rows}
                                        />

                                        {/* Pagination Footer */}
                                        <div style={{ padding: '16px', borderTop: '1px solid #e1e3e5' }}>
                                            <InlineStack align="center" blockAlign="center" gap="400">
                                                <Text as="span" tone="subdued">
                                                    Showing {logs.length} of {totalLogs} webhooks (Page {currentPage} of {totalPages || 1})
                                                </Text>
                                                <Pagination
                                                    hasPrevious={currentPage > 1}
                                                    onPrevious={handlePreviousPage}
                                                    hasNext={currentPage < totalPages}
                                                    onNext={handleNextPage}
                                                />
                                            </InlineStack>
                                        </div>
                                    </>
                                )}
                            </BlockStack>
                        </Card>
                    </Layout.Section>
                </Layout>
            </Page>
        </AppProvider>
    );
}