import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useActionData, useNavigation, Form } from "@remix-run/react";
import {
    Page,
    Layout,
    Card,
    BlockStack,
    Text,
    Button,
    Select,
    TextField,
    Box,
    Banner,
    Grid
} from "@shopify/polaris";
import { useState, useEffect } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { Client } from "@notionhq/client";
import { 
    prepareNotionProduct, 
    prepareNotionVariant, 
    prepareNotionCustomer, 
    prepareNotionOrder,
    getNotionIdByShopifyId,
    syncItem,
    getNotionCollectionsMap,
    cleanGid
} from "../services/sync/utils";

export type DebugActionData = {
    result?: any;
    shopifyData?: any;
    preparedData?: any;
    liveShopifyData?: any;
    pushRes?: any;
    searchedId?: string;
    searchedEntity?: string;
    error?: string;
    allCollectionsMap?: Record<string, string> | null;
};

export async function loader({ request }: LoaderFunctionArgs) {
    await authenticate.admin(request);
    return json({}); 
}

export async function action({ request }: ActionFunctionArgs) {
    const { session, admin } = await authenticate.admin(request);
    if (!session || !session.shop) {
        return json<DebugActionData>({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const entity = formData.get("entity") as string;
    let shopifyId = formData.get("shopifyId") as string;
    const intent = formData.get("intent") as string;

    if (!entity || !shopifyId) {
        return json<DebugActionData>({ error: "Entity and Shopify ID are required." }, { status: 400 });
    }

    // Clean up gid if the user pastes a full ID but the DB uses numbers or vice versa.
    // In this app, shopifyId is usually the full gid, but let's query exactly what's passed.
    shopifyId = shopifyId.trim();

    try {
        const config = await prisma.storeConfig.findUnique({ where: { shop: session.shop } });
        if (!config?.notionAccessToken) {
            return json<DebugActionData>({ error: "Notion is not connected." }, { status: 400 });
        }

        let dbId: string | null | undefined = null;
        switch (entity) {
            case "Products": dbId = config.notionProductsDbId; break;
            case "Variants": dbId = config.notionVariantsDbId; break;
            case "Collections": dbId = config.notionCollectionsDbId; break;
            case "Customers": dbId = config.notionCustomersDbId; break;
            case "Orders": dbId = config.notionOrdersDbId; break;
        }

        if (!dbId) {
            return json<DebugActionData>({ error: `No Notion database found for ${entity}. Please complete initial setup.` }, { status: 400 });
        }

        const notion = new Client({ auth: config.notionAccessToken });
        
        // Query the Notion Database for this ID
        const queryRes = await notion.dataSources.query({
            data_source_id: dbId,
            filter: { property: "ID", rich_text: { equals: shopifyId } }
        });

        const allCollectionsMap = config.notionCollectionsDbId ? await getNotionCollectionsMap(notion, config.notionCollectionsDbId) : null;

        // Query local Shopify DB
        let shopifyData: any = null;
        switch (entity) {
            case "Products": shopifyData = await prisma.product.findUnique({ where: { shop_shopifyId: { shop: session.shop, shopifyId } }, include: { images: true, variants: true } }); break;
            case "Variants": shopifyData = await prisma.variant.findFirst({ where: { shopifyVariantId: shopifyId } }); break;
            case "Collections": shopifyData = await prisma.collection.findUnique({ where: { shop_shopifyId: { shop: session.shop, shopifyId } } }); break;
            case "Customers": shopifyData = await prisma.customer.findUnique({ where: { shop_shopifyId: { shop: session.shop, shopifyId } } }); break;
            case "Orders": shopifyData = await prisma.order.findUnique({ where: { shop_shopifyId: { shop: session.shop, shopifyId } } }); break;
        }

        let liveShopifyData: any = null;
        if (admin && shopifyId.startsWith("gid://")) {
            try {
                const response = await admin.graphql(
                    `#graphql
                    query getNode($id: ID!) {
                        node(id: $id) { 
                            id
                            ... on Product { title handle vendor productType tags status createdAt updatedAt publishedAt hasOnlyDefaultVariant seo { title description } totalInventory tracksInventory options { name values } collections(first: 20) { edges { node { id title handle } } } variants(first: 10) { edges { node { id title price sku inventoryItem { measurement { weight { value unit } } } } } } media(first: 10) { edges { node { preview { image { id url } } } } } }
                            ... on ProductVariant { title price sku barcode inventoryItem { measurement { weight { value unit } } } createdAt updatedAt }
                            ... on Collection { title handle updatedAt }
                            ... on Customer { firstName lastName email phone tags createdAt updatedAt }
                            ... on Order { name email phone tags createdAt updatedAt }
                        }
                    }`,
                    { variables: { id: shopifyId } }
                );
                const respJson = await response.json();
                liveShopifyData = respJson.data?.node || respJson;
            } catch (e: any) {
                liveShopifyData = { error: "Failed to fetch live data from Shopify", details: e.message };
            }
        }

        let preparedData: any = null;
        if (shopifyData || liveShopifyData) {
            const prodData = shopifyData || liveShopifyData;
            switch (entity) {
                case "Products":
                    const cMap: Record<string, string> = {};
                    if (liveShopifyData?.collections?.edges?.length > 0) {
                        for (const edge of liveShopifyData.collections.edges) {
                            if (!edge.node.id) continue;
                            if (allCollectionsMap && allCollectionsMap[edge.node.id]) {
                                cMap[edge.node.id] = allCollectionsMap[edge.node.id];
                            }
                        }
                    } else if (shopifyData?.collections) {
                        for (const col of shopifyData.collections) {
                            if (allCollectionsMap && allCollectionsMap[col.id]) {
                                cMap[col.id] = allCollectionsMap[col.id];
                            }
                        }
                    }
                    preparedData = prepareNotionProduct({
                        shop: session.shop,
                        product: prodData,
                        collectionNotionMap: cMap
                    });
                    break;
                case "Variants":
                    const parentProduct = await prisma.product.findUnique({ where: { id: prodData.productId } });
                    const pNotionId = parentProduct ? await getNotionIdByShopifyId(notion, config.notionProductsDbId!, cleanGid(parentProduct.shopifyId)) : null;
                    preparedData = prepareNotionVariant({
                        variant: prodData,
                        notionProductId: pNotionId
                    });
                    break;
                case "Customers":
                    preparedData = await prepareNotionCustomer({
                        shop: session.shop,
                        customer: prodData,
                        ordersDbId: config.notionOrdersDbId
                    });
                    break;
                case "Orders":
                    preparedData = await prepareNotionOrder({
                        order: prodData,
                        productsDbId: config.notionProductsDbId,
                        variantsDbId: config.notionVariantsDbId,
                        customersDbId: config.notionCustomersDbId,
                        notionClient: notion
                    });
                    break;
            }
        } 

        if (intent === "push" && preparedData) {
            try {
                const existingId = queryRes.results && queryRes.results.length > 0 ? queryRes.results[0].id : undefined;
                const pushRes = await syncItem(notion, dbId, shopifyId, preparedData, existingId);
                return json<DebugActionData>({ result: queryRes.results.length > 0 ? queryRes.results[0] : null, shopifyData, preparedData, liveShopifyData, pushRes, searchedId: shopifyId, searchedEntity: entity, allCollectionsMap });
            } catch (e: any) {
                return json<DebugActionData>({ result: queryRes.results.length > 0 ? queryRes.results[0] : null, shopifyData, preparedData, liveShopifyData, error: "Failed to push: " + e.message, searchedId: shopifyId, searchedEntity: entity, allCollectionsMap }, { status: 500 });
            }
        }

        if (queryRes.results && queryRes.results.length > 0) {
            return json<DebugActionData>({ result: queryRes.results[0], shopifyData, preparedData, liveShopifyData, searchedId: shopifyId, searchedEntity: entity, allCollectionsMap });
        } else {
            return json<DebugActionData>({ result: null, shopifyData, preparedData, liveShopifyData, error: `Could not find an item with ID "${shopifyId}" in the ${entity} Notion database.`, searchedId: shopifyId, searchedEntity: entity, allCollectionsMap }, { status: 404 });
        }
    } catch (error: any) {
        return json<DebugActionData>({ error: error.message || "An error occurred fetching from Notion", searchedId: shopifyId, searchedEntity: entity }, { status: 500 });
    }
}

const syntaxHighlight = (json: string) => {
    if (!json) return "";
    json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
        let cls = 'color: #008000;'; // number (green)
        if (/^"/.test(match)) {
            if (/:$/.test(match)) {
                cls = 'color: #d73a49;'; // key (red)
            } else {
                cls = 'color: #032f62;'; // string (blue)
            }
        } else if (/true|false/.test(match)) {
            cls = 'color: #005cc5;'; // boolean (blue)
        } else if (/null/.test(match)) {
            cls = 'color: #d73a49;'; // null (red)
        }
        return '<span style="' + cls + '">' + match + '</span>';
    });
};

const JsonViewer = ({ data }: { data: any }) => (
    <Box background="bg-surface-secondary" padding="400" borderRadius="200" overflowX="scroll" minHeight="400px">
        <pre 
            style={{ margin: 0, fontSize: "11px", lineHeight: "1.4", fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-all" }}
            dangerouslySetInnerHTML={{ __html: syntaxHighlight(JSON.stringify(data, null, 2)) }}
        />
    </Box>
);

export default function DebugPage() {
    const actionData = useActionData<typeof action>();
    const navigation = useNavigation();
    
    const [entity, setEntity] = useState("Products");
    const [shopifyId, setShopifyId] = useState("");

    useEffect(() => {
        const savedEntity = sessionStorage.getItem("debugEntity");
        const savedId = sessionStorage.getItem("debugShopifyId");
        if (savedEntity) setEntity(savedEntity);
        if (savedId) setShopifyId(savedId);
    }, []);

    useEffect(() => {
        sessionStorage.setItem("debugEntity", entity);
        sessionStorage.setItem("debugShopifyId", shopifyId);
    }, [entity, shopifyId]);

    useEffect(() => {
        if (actionData?.searchedEntity) {
            setEntity(actionData.searchedEntity);
            sessionStorage.setItem("debugEntity", actionData.searchedEntity);
        }
        if (actionData?.searchedId) {
            setShopifyId(actionData.searchedId);
            sessionStorage.setItem("debugShopifyId", actionData.searchedId);
        }
    }, [actionData]);

    const isSubmitting = navigation.state === "submitting";

    const options = [
        { label: "Product", value: "Products" },
        { label: "Variant", value: "Variants" },
        { label: "Collection", value: "Collections" },
        { label: "Customer", value: "Customers" },
        { label: "Order", value: "Orders" },
    ];

    return (
        <Page title="Notion Debugger">
            <Layout>
                <Layout.Section>
                    <Card>
                        <BlockStack gap="400">
                            <Text as="p" variant="bodyMd">
                                Use this tool to inspect the raw JSON data returned from Notion for a specific entity. 
                                This is useful for verifying tags, relations, and exact field values.
                            </Text>

                            <Form method="post">
                                <BlockStack gap="400">
                                    <Select
                                        label="Entity Type"
                                        name="entity"
                                        options={options}
                                        value={entity}
                                        onChange={setEntity}
                                    />
                                    
                                    <TextField
                                        label="Shopify ID"
                                        name="shopifyId"
                                        value={shopifyId}
                                        onChange={setShopifyId}
                                        autoComplete="off"
                                        placeholder="e.g. gid://shopify/Product/123456789"
                                        helpText="Enter the exact Shopify ID as it appears in Notion's 'ID' property."
                                    />
                                    
                                    <Button submit variant="primary" loading={isSubmitting}>
                                        Fetch from Notion
                                    </Button>
                                </BlockStack>
                            </Form>
                        </BlockStack>
                    </Card>
                </Layout.Section>

                {actionData && (
                    <Layout.Section>
                        {actionData.error ? (
                            <Banner tone="critical">
                                <p>{actionData.error}</p>
                            </Banner>
                        ) : ( 
                            <Grid>
                                <Grid.Cell columnSpan={{xs: 6, sm: 6, md: 6, lg: 6, xl: 6}}>
                                    <Card>
                                        <BlockStack gap="400">
                                            <Text as="h2" variant="headingMd">Notion Collections Map</Text>
                                            <JsonViewer data={actionData.allCollectionsMap || { notice: "No collections map available" }} />
                                        </BlockStack> 
                                    </Card>
                                </Grid.Cell>
                                <Grid.Cell columnSpan={{xs: 6, sm: 6, md: 6, lg: 6, xl: 6}}>
                                    <Card>
                                        <BlockStack gap="400">
                                            <Text as="h2" variant="headingMd">Prepared Properties</Text>
                                            <Form method="post">
                                                <input type="hidden" name="entity" value={entity} />
                                                <input type="hidden" name="shopifyId" value={shopifyId} />
                                                <input type="hidden" name="intent" value="push" />
                                                <Button submit variant="primary" loading={isSubmitting && navigation.formData?.get("intent") === "push"}>
                                                    Push to Notion
                                                </Button>
                                            </Form>
                                            <JsonViewer data={actionData.preparedData} />
                                            { actionData.pushRes && (
                                                <BlockStack gap="400">
                                                    <Text as="h3" variant="headingSm">Push Response</Text>
                                                    <JsonViewer data={actionData.pushRes} />
                                                </BlockStack>
                                            )}
                                        </BlockStack>
                                    </Card>
                                </Grid.Cell>
                                <Grid.Cell columnSpan={{xs: 6, sm: 6, md: 6, lg: 6, xl: 6}}>
                                    <Card>
                                        <BlockStack gap="400">
                                            <Text as="h2" variant="headingMd">Shopify Data (Live API)</Text>
                                            <JsonViewer data={actionData.liveShopifyData || { notice: "No live data available" }} />
                                        </BlockStack>
                                    </Card>
                                </Grid.Cell>
                                <Grid.Cell columnSpan={{xs: 6, sm: 6, md: 6, lg: 6, xl: 6}}>
                                    <Card>
                                        <BlockStack gap="400">
                                            <Text as="h2" variant="headingMd">Shopify Data (Local DB)</Text>
                                            <JsonViewer data={actionData.shopifyData} />
                                        </BlockStack>
                                    </Card>
                                </Grid.Cell>
                                <Grid.Cell columnSpan={{xs: 6, sm: 6, md: 6, lg: 6, xl: 6}}>
                                    <Card>
                                        <BlockStack gap="400">
                                            <Text as="h2" variant="headingMd">Notion API Response</Text>
                                            <JsonViewer data={actionData.result} />
                                        </BlockStack>
                                    </Card>
                                </Grid.Cell>
                            </Grid>
                        )}
                    </Layout.Section>
                )}
            </Layout>
        </Page>
    );
}
