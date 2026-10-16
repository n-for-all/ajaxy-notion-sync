import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { Page, Card, BlockStack, Text, DataTable, Badge, Pagination } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get("page") || "1", 10);
    const limit = 20;
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
        db.webhookStatus.findMany({
            where: { shop: session.shop },
            orderBy: { createdAt: "desc" },
            skip,
            take: limit
        }),
        db.webhookStatus.count({ where: { shop: session.shop } })
    ]);

    return json({ logs, page, totalPages: Math.ceil(total / limit) });
};

export default function WebhooksPage() {
    const { logs, page, totalPages } = useLoaderData<typeof loader>();
    const navigate = useNavigate();

    return (
        <Page title="Webhook Logs">
            <Card>
                <BlockStack gap="400">
                    <Text as="p" tone="subdued">
                        The latest incoming webhooks from Shopify.
                    </Text>
                    <DataTable
                        columnContentTypes={['text', 'text', 'text', 'text']}
                        headings={['Topic', 'Status', 'Date Received', 'Output']}
                        rows={logs.map((ws: any) => [
                            <Text as="span" fontWeight="bold">{ws.topic}</Text>,
                            <Badge tone={ws.status === "success" ? "success" : "critical"}>{ws.status}</Badge>,
                            new Date(ws.createdAt).toLocaleString(),
                            <Text as="span" tone="subdued" breakWord>{ws.output || "No output"}</Text>
                        ])}
                    />
                    <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1rem' }}>
                        <Pagination
                            hasPrevious={page > 1}
                            onPrevious={() => navigate(`?page=${page - 1}`)}
                            hasNext={page < totalPages}
                            onNext={() => navigate(`?page=${page + 1}`)}
                        />
                    </div>
                </BlockStack>
            </Card>
        </Page>
    );
}
