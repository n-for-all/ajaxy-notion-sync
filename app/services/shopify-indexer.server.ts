import { AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "../db.server";
import {
    buildSearchableContent,
    extractSummary,
    extractVariantAttributes,
    processImages,
    calculatePriceRange,
    stripHtml,
} from "./content-analyzer.server";
import { Prisma } from "@prisma/client";

export interface ProductData {
    id: string;
    title: string;
    handle: string;
    vendor?: string;
    productType?: string;
    description?: string;
    descriptionHtml?: string;
    status: string;
    createdAt?: string;
    publishedAt?: string;
    hasOnlyDefaultVariant?: boolean;
    seo?: {
        title?: string;
        description?: string;
    };
    totalInventory?: number;
    tracksInventory?: boolean;
    compareAtPriceRange?: {
        maxVariantCompareAtPrice?: {
            amount?: string;
        };
    };
    media?: {
        edges: Array<{
            node: {
                preview?: {
                    image?: {
                        id: string;
                        url: string;
                        altText?: string;
                    };
                };
            };
        }>;
    };
    variants?: {
        edges: Array<{
            node: {
                id: string;
                title: string;
                price: string;
                compareAtPrice?: string;
                sku?: string;
                barcode?: string;
                taxable?: boolean;
                inventoryQuantity?: number;
                inventoryItem?: {
                    measurement?: {
                        weight?: {
                            value?: number;
                            unit?: string;
                        };
                    };
                };
                selectedOptions?: Array<{
                    name: string;
                    value: string;
                }>;
            };
        }>;
    };
    tags?: string[];
    collections?: {
        edges: Array<{
            node: {
                id: string; // The Shopify Collection ID
            };
        }>;
    };
}

interface GraphQLResponse<T = unknown> {
    data?: T;
    errors?: Array<{ message: string }>;
}

interface ProductsResponse {
    products?: {
        edges: Array<{
            node: ProductData;
            cursor: string;
        }>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
}

interface CollectionsResponse {
    collections?: {
        nodes: Array<{
            id: string
            title: string
            handle: string
            description?: string
            updatedAt?: string
            image?: { src: string; altText?: string }
        }>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
}

export async function countShopifyProducts(admin: AdminApiContext): Promise<number> {
    try {
        const query = `
      query {
        products(first: 1) {
          totalCount
        }
      }
    `;

        let response;
        try {
            response = await admin.graphql(query, { tries: 3 });
        } catch (graphqlError) {
            const errorMsg = graphqlError instanceof Error ? graphqlError.message : String(graphqlError);
            throw new Error(`Count GraphQL request failed: ${errorMsg}`);
        }

        const data = (await response.json()) as GraphQLResponse<{ products?: { totalCount: number } }>;

        if (data.errors) {
            throw new Error(`Count GraphQL Error: ${JSON.stringify(data.errors)}`);
        }

        const totalCount = data.data?.products?.totalCount || 0;
        return totalCount;
    } catch (error) {
        console.error("Error counting products:", error);
        throw error;
    }
}

async function processAndSaveProduct(shop: string, product: ProductData) {
    const variantData = product.variants?.edges?.map((e) => e.node) || [];
    const imageData = (product.media?.edges?.map((e) => e.node.preview?.image).filter(Boolean) as any[]) || [];
    const { minPrice, maxPrice } = calculatePriceRange(variantData);
    const variantAttrs = extractVariantAttributes(variantData);

    const productLevelCompareAt = product.compareAtPriceRange?.maxVariantCompareAtPrice?.amount
        ? parseFloat(product.compareAtPriceRange.maxVariantCompareAtPrice.amount)
        : null;
    const variantCompareAt = variantData
        .map((v) => v.compareAtPrice ? parseFloat(v.compareAtPrice) : 0)
        .filter((p) => p > 0);
    const compareAtPrice = productLevelCompareAt && productLevelCompareAt > 0
        ? productLevelCompareAt
        : variantCompareAt.length > 0 ? Math.max(...variantCompareAt) : null;

    const content = buildSearchableContent(
        product.title,
        product.description,
        product.descriptionHtml,
        (Array.isArray(product.tags) ? product.tags : [product.tags || ""]).filter(Boolean),
        variantAttrs
    );

    const summary = extractSummary(product.descriptionHtml || product.description || "", 300);

    const processedImages = imageData.map((img, index) => ({
        shopifyImageId: img.id || `image-${index}`,
        url: img.url || "",
        altText: img.altText || "",
        position: index,
    })).filter((img) => img.url);

    const processedVariants = variantData.map((variant) => {
        const optionsJson = variant.selectedOptions?.reduce((acc, opt) => {
            acc[opt.name] = opt.value;
            return acc;
        }, {} as Record<string, string>) || null;

        return {
            shopifyVariantId: variant.id || "",
            title: variant.title || "",
            price: parseFloat(variant.price) || 0,
            compareAtPrice: variant.compareAtPrice ? parseFloat(variant.compareAtPrice) : null,
            sku: variant.sku || null,
            barcode: variant.barcode || null,
            taxable: variant.taxable !== false,
            inventory: variant.inventoryQuantity || 0,
            weight: variant.inventoryItem?.measurement?.weight?.value || null,
            weightUnit: variant.inventoryItem?.measurement?.weight?.unit || null,
            options: optionsJson ? optionsJson : Prisma.JsonNull,
        };
    }).filter((v) => v.shopifyVariantId);

    const defaultSku = variantData.length > 0 ? variantData[0].sku : null;
    const defaultWeight = processedVariants.length > 0 ? processedVariants[0].weight : null;

    const collectionIds = (product.collections?.edges || []).map(e => e.node.id);
    const existingCollections = await prisma.collection.findMany({
        where: { shop, shopifyId: { in: collectionIds } },
        select: { id: true }
    });

    const collectionConnects = existingCollections.map(c => ({ id: c.id }));

    const productData = {
        title: product.title,
        description: summary,
        body: stripHtml(product.descriptionHtml),
        tags: (Array.isArray(product.tags) ? product.tags : [product.tags || ""]).filter(Boolean),
        handle: product.handle,
        url: `/products/${product.handle}`,
        price: minPrice,
        compareAtPrice,
        minPrice,
        maxPrice,
        sku: defaultSku,
        weight: defaultWeight,
        vendor: product.vendor || null,
        productType: product.productType || null,
        publishedAt: product.publishedAt ? new Date(product.publishedAt) : null,
        hasOnlyDefaultVariant: product.hasOnlyDefaultVariant || false,
        seoTitle: product.seo?.title || null,
        seoDescription: product.seo?.description || null,
        totalInventory: product.totalInventory || 0,
        tracksInventory: product.tracksInventory || false,
        content,
    };

    await prisma.product.upsert({
        where: { shop_shopifyId: { shop, shopifyId: product.id } },
        update: {
            ...productData,
            images: {
                deleteMany: {},
                create: processedImages,
            },
            variants: {
                deleteMany: {},
                create: processedVariants,
            },
            collections: {
                set: collectionConnects,
            }
        },
        create: {
            ...productData,
            shop,
            shopifyId: product.id,
            images: {
                create: processedImages,
            },
            variants: {
                create: processedVariants,
            },
            collections: {
                connect: collectionConnects,
            }
        },
    });
}

export async function indexSingleShopifyProduct(admin: AdminApiContext, shop: string, productId: string) {
    try {
        const formattedId = productId.includes("gid://") ? productId : `gid://shopify/Product/${productId}`;
        const query = `
      query GetProduct($id: ID!) {
        product(id: $id) {
          id
          title
          handle
          vendor
          productType
          description
          descriptionHtml
          status
          createdAt
          publishedAt
          hasOnlyDefaultVariant
          seo { title description }
          totalInventory
          tracksInventory
          compareAtPriceRange {
            maxVariantCompareAtPrice {
              amount
            }
          }
          media(first: 10) {
            edges {
              node {
                preview {
                  image {
                    id
                    url
                    altText
                  }
                }
              }
            }
          }
          variants(first: 100) {
            edges {
              node {
                id
                title
                price
                compareAtPrice
                sku
                barcode
                taxable
                inventoryQuantity
                inventoryItem {
                  measurement {
                    weight {
                      value
                      unit
                    }
                  }
                }
                selectedOptions {
                  name
                  value
                }
              }
            }
          }
          tags
          collections(first: 100) {
            edges {
              node {
                id
              }
            }
          }
        }
      }
    `;

        const response = await admin.graphql(query, {
            variables: { id: formattedId },
            tries: 3,
        });

        const data = (await response.json()) as GraphQLResponse<{ product: ProductData | null }>;

        if (data.errors) {
            throw new Error(`Single Product GraphQL Error: ${JSON.stringify(data.errors)}`);
        }

        const product = data.data?.product;
        if (!product || product.status !== "ACTIVE") {
            await prisma.product.deleteMany({
                where: { shop, shopifyId: formattedId }
            });
            return { success: true, action: "deleted" };
        }

        await processAndSaveProduct(shop, product);
        return { success: true, action: "upserted", shopifyId: product.id };
    } catch (error) {
        console.error("Error syncing single product:", error);
        throw error;
    }
}

export async function indexShopifyProducts(admin: AdminApiContext, shop: string, limit: number, onProgress?: (count: number) => Promise<void>) {
    try {
        // Wipe local products and variants before reindexing to avoid orphans
        await prisma.variant.deleteMany({ where: { product: { shop } } });
        await prisma.product.deleteMany({ where: { shop } });

        const query = `
      query GetProducts($first: Int!, $after: String) {
        products(first: $first, after: $after, query: "status:active") {
          edges {
            node {
              id
              title
              handle
              vendor
              productType
              description
              descriptionHtml
              status
              createdAt
              publishedAt
              hasOnlyDefaultVariant
              seo { title description }
              totalInventory
              tracksInventory
              compareAtPriceRange {
                maxVariantCompareAtPrice {
                  amount
                }
              }
              media(first: 10) {
                edges {
                  node {
                    preview {
                      image {
                        id
                        url
                        altText
                      }
                    }
                  }
                }
              }
              variants(first: 100) {
                edges {
                  node {
                    id
                    title
                    price
                    compareAtPrice
                    sku
                    barcode
                    taxable
                    inventoryQuantity
                    inventoryItem {
                      measurement {
                        weight {
                          value
                          unit
                        }
                      }
                    }
                    selectedOptions {
                      name
                      value
                    }
                  }
                }
              }
              tags
              collections(first: 100) {
                edges {
                  node {
                    id
                  }
                }
              }
            }
            cursor
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

        let products: ProductData[] = [];
        let hasNextPage = true;
        let cursor: string | null = null;

        while (hasNextPage && products.length < limit) {
            try {
                const fetchLimit = Math.min(50, limit - products.length);
                let response;
                try {
                    response = await admin.graphql(query, {
                        variables: {
                            first: fetchLimit,
                            after: cursor,
                        },
                        tries: 3,
                    });
                } catch (graphqlError) {
                    const errorMsg = graphqlError instanceof Error ? graphqlError.message : String(graphqlError);
                    throw new Error(`Products GraphQL request failed: ${errorMsg}`);
                }

                const data = (await response.json()) as GraphQLResponse<ProductsResponse>;

                if (data.errors) {
                    throw new Error(`Products GraphQL Error: ${JSON.stringify(data.errors)}`);
                }

                const productsData = data.data?.products;
                if (!productsData || !productsData.edges || productsData.edges.length === 0) {
                    break;
                }

                const nodes = productsData.edges.map((edge) => edge.node).filter((node) => node.status === "ACTIVE");
                
                // Save products immediately so the UI database count updates in real-time
                for (const node of nodes) {
                    await processAndSaveProduct(shop, node);
                }

                products = products.concat(nodes);

                if (onProgress) {
                    await onProgress(products.length);
                }

                hasNextPage = productsData.pageInfo?.hasNextPage || false;
                cursor = productsData.pageInfo?.endCursor || null;
            } catch (batchError) {
                throw new Error(
                    `Failed to fetch products: ${batchError instanceof Error ? batchError.message : String(batchError)}`
                );
            }
        }

        await prisma.indexStatus.update({
            where: { shop },
            data: { lastProductsIndexedAt: new Date() }
        });

        return { success: true, count: products.length, type: "products" };
    } catch (error) {
        throw error;
    }
}

export async function indexShopifyCollections(admin: AdminApiContext, shop: string, limit: number, onProgress?: (count: number) => Promise<void>) {
    try {
        const query = `
      query GetCollections($first: Int!, $after: String) {
        collections(first: $first, after: $after, query: "published_status:published") {
          nodes {
            id
            title
            handle
            description
            updatedAt
            image {
              src
              altText
            }
            products(first: 250) {
              edges {
                node {
                  id
                }
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

        const collections: Array<{
            id: string;
            title: string;
            handle: string;
            description?: string;
            updatedAt?: string;
            image?: { src: string; altText?: string },
            products?: {
                edges: {
                    node: {
                        id: string;
                    }
                }[]
            }
        }> = [];
        let hasNextPage = true;
        let cursor: string | null = null;

        while (hasNextPage && collections.length < limit) {
            try {
                const fetchLimit = Math.min(100, limit - collections.length);
                let response;
                try {
                    response = await admin.graphql(query, {
                        variables: {
                            first: fetchLimit,
                            after: cursor,
                        },
                        tries: 3,
                    });
                } catch (graphqlError) {
                    const errorMsg = graphqlError instanceof Error ? graphqlError.message : String(graphqlError);
                    throw new Error(`Collections GraphQL request failed: ${errorMsg}`);
                }

                const data = (await response.json()) as GraphQLResponse<CollectionsResponse>;

                if (data.errors) {
                    throw new Error(`Collections GraphQL Error: ${JSON.stringify(data.errors)}`);
                }

                const collectionsData = data.data?.collections;
                if (!collectionsData || !collectionsData.nodes || collectionsData.nodes.length === 0) {
                    break;
                }

                collections.push(...collectionsData.nodes);

                if (onProgress) {
                    await onProgress(collections.length);
                }

                hasNextPage = collectionsData.pageInfo?.hasNextPage || false;
                cursor = collectionsData.pageInfo?.endCursor || null;
            } catch (batchError) {
                throw new Error(
                    `Failed to fetch collections: ${batchError instanceof Error ? batchError.message : String(batchError)}`
                );
            }
        }

        for (const collection of collections) {
            const summary = extractSummary(collection.description || "", 300);

            const productIds = (collection.products?.edges || []).map((e: any) => e.node.id);
            const existingProducts = await prisma.product.findMany({
                where: { shop, shopifyId: { in: productIds } },
                select: { id: true }
            });
            const productConnects = existingProducts.map(p => ({ id: p.id }));

            const existingCollection = await prisma.collection.findUnique({
                where: {
                    shop_shopifyId: {
                        shop,
                        shopifyId: collection.id,
                    },
                },
            });

            if (existingCollection) {
                await prisma.collection.update({
                    where: { id: existingCollection.id },
                    data: {
                        title: collection.title,
                        description: summary,
                        handle: collection.handle,
                        publishedAt: collection.updatedAt ? new Date(collection.updatedAt) : null,
                        body: stripHtml(collection.description || ""),
                        url: `/collections/${collection.handle}`,
                        updatedAt: new Date(),
                        products: { set: productConnects }
                    },
                });
            } else {
                await prisma.collection.create({
                    data: {
                        shop,
                        shopifyId: collection.id,
                        title: collection.title,
                        url: `/collections/${collection.handle}`,
                        description: summary,
                        body: stripHtml(collection.description || ""),
                        handle: collection.handle,
                        publishedAt: collection.updatedAt ? new Date(collection.updatedAt) : null,
                        products: { connect: productConnects }
                    },
                });
            }
        }

        await prisma.indexStatus.update({
            where: { shop },
            data: { lastCollectionsIndexedAt: new Date() }
        });

        return { success: true, count: collections.length, type: "collections" };
    } catch (error) {
        throw error;
    }
}

export async function indexSingleShopifyCollection(admin: AdminApiContext, shop: string, collectionId: string) {
    try {
        const formattedId = collectionId.includes("gid://") ? collectionId : `gid://shopify/Collection/${collectionId}`;
        const query = `
      query GetCollection($id: ID!) {
        collection(id: $id) {
            id
            title
            handle
            description
            updatedAt
            image {
              src
              altText
            }
            products(first: 250) {
              edges {
                node {
                  id
                }
              }
            }
        }
      }
    `;

        const response = await admin.graphql(query, {
            variables: { id: formattedId },
            tries: 3,
        });

        const data = (await response.json()) as GraphQLResponse<{ collection: any }>;

        if (data.errors) {
            throw new Error(`Single Collection GraphQL Error: ${JSON.stringify(data.errors)}`);
        }

        const collection = data.data?.collection;
        if (!collection) {
            await prisma.collection.deleteMany({
                where: { shop, shopifyId: formattedId }
            });
            return { success: true, action: "deleted" };
        }

        const summary = extractSummary(collection.description || "", 300);

        const productIds = (collection.products?.edges || []).map((e: any) => e.node.id);
        const existingProducts = await prisma.product.findMany({
            where: { shop, shopifyId: { in: productIds } },
            select: { id: true }
        });
        const productConnects = existingProducts.map(p => ({ id: p.id }));

        const existingCollection = await prisma.collection.findUnique({
            where: {
                shop_shopifyId: {
                    shop,
                    shopifyId: collection.id,
                },
            },
        });

        if (existingCollection) {
            await prisma.collection.update({
                where: { id: existingCollection.id },
                data: {
                    title: collection.title,
                    description: summary,
                    handle: collection.handle,
                    publishedAt: collection.updatedAt ? new Date(collection.updatedAt) : null,
                    body: stripHtml(collection.description || ""),
                    url: `/collections/${collection.handle}`,
                    updatedAt: new Date(),
                    products: { set: productConnects }
                },
            });
        } else {
            await prisma.collection.create({
                data: {
                    shop,
                    shopifyId: collection.id,
                    title: collection.title,
                    url: `/collections/${collection.handle}`,
                    description: summary,
                    body: stripHtml(collection.description || ""),
                    handle: collection.handle,
                    publishedAt: collection.updatedAt ? new Date(collection.updatedAt) : null,
                    products: { connect: productConnects }
                },
            });
        }

        return { success: true, action: "upserted", shopifyId: collection.id };
    } catch (error) {
        console.error("Error syncing single collection:", error);
        throw error;
    }
}

export async function indexShopifyCustomers(admin: AdminApiContext, shop: string, limit: number, onProgress?: (count: number) => Promise<void>) {
    try {
        const query = `
      query GetCustomers($first: Int!, $after: String) {
        customers(first: $first, after: $after) {
          nodes {
            id
            firstName
            lastName
            email
            phone
            tags
            numberOfOrders
            amountSpent {
              amount
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

        let customers: any[] = [];
        let hasNextPage = true;
        let cursor: string | null = null;

        while (hasNextPage && customers.length < limit) {
            try {
                const fetchLimit = Math.min(100, limit - customers.length);
                const response = await admin.graphql(query, {
                    variables: { first: fetchLimit, after: cursor },
                    tries: 3,
                });

                const data = (await response.json()) as GraphQLResponse<any>;
                if (data.errors) throw new Error(`Customers GraphQL Error: ${JSON.stringify(data.errors)}`);

                const nodes = data.data?.customers?.nodes;
                if (!nodes || nodes.length === 0) break;

                customers.push(...nodes);

                if (onProgress) await onProgress(customers.length);

                hasNextPage = data.data?.customers?.pageInfo?.hasNextPage || false;
                cursor = data.data?.customers?.pageInfo?.endCursor || null;
            } catch (batchError) {
                console.error('Failed to fetch customers 2', batchError);
                throw new Error(`Failed to fetch customers 2: ${batchError}`);
            }
        }

        for (const customer of customers) {
            await prisma.customer.upsert({
                where: { shop_shopifyId: { shop, shopifyId: customer.id } },
                update: {
                    firstName: customer.firstName,
                    lastName: customer.lastName,
                    email: customer.email,
                    phone: customer.phone,
                    tags: Array.isArray(customer.tags) ? customer.tags : [],
                    ordersCount: customer.numberOfOrders ? parseInt(String(customer.numberOfOrders)) : 0,
                    totalSpent: customer.amountSpent?.amount ? parseFloat(customer.amountSpent.amount) : 0,
                },
                create: {
                    shop,
                    shopifyId: customer.id,
                    firstName: customer.firstName,
                    lastName: customer.lastName,
                    email: customer.email,
                    phone: customer.phone,
                    tags: Array.isArray(customer.tags) ? customer.tags : [],
                    ordersCount: customer.numberOfOrders ? parseInt(String(customer.numberOfOrders)) : 0,
                    totalSpent: customer.amountSpent?.amount ? parseFloat(customer.amountSpent.amount) : 0,
                }
            });
        }

        await prisma.indexStatus.update({
            where: { shop },
            data: { lastCustomersIndexedAt: new Date() }
        });

        return { success: true, count: customers.length, type: "customers" };
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        await prisma.indexStatus.update({ where: { shop }, data: { errorMessage: `Customers Error: ${msg}` } });
        throw error;
    }
}

export async function indexShopifyOrders(admin: AdminApiContext, shop: string, limit: number, onProgress?: (count: number) => Promise<void>) {
    try {
        const query = `
      query GetOrders($first: Int!, $after: String) {
        orders(first: $first, after: $after) {
          nodes {
            id
            name
            totalPriceSet {
              shopMoney {
                amount
              }
            } 
            displayFinancialStatus
            displayFulfillmentStatus
            customer {
              id
              displayName
            }
            returnStatus
            cancelledAt
            closed
            note
            tags
            lineItems(first: 50) {
              edges {
                node {
                  product {
                    id
                  }
                  variant { 
                    id 
                  }
                }
              }
            }
            discountApplications(first: 5) {
              edges {
                node {
                  allocationMethod
                  value {
                    ... on PricingPercentageValue {
                      percentage
                    }
                    ... on MoneyV2 {
                      amount
                      currencyCode
                    }
                  }
                  ... on DiscountCodeApplication {
                    code
                  }
                }
              }
            }
            refunds(first: 5) {
              id
              createdAt
              note
              totalRefundedSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
            }
            fulfillments {
              trackingInfo {
                company
                number
                url
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

        let orders: any[] = [];
        let hasNextPage = true;
        let cursor: string | null = null;

        while (hasNextPage && orders.length < limit) {
            try {
                const fetchLimit = Math.min(100, limit - orders.length);
                const response = await admin.graphql(query, {
                    variables: { first: fetchLimit, after: cursor },
                    tries: 3,
                });

                const data = (await response.json()) as GraphQLResponse<any>;
                if (data.errors) throw new Error(`Orders GraphQL Error: ${JSON.stringify(data.errors)}`);

                const nodes = data.data?.orders?.nodes;
                if (!nodes || nodes.length === 0) break;

                orders.push(...nodes);

                if (onProgress) await onProgress(orders.length);

                hasNextPage = data.data?.orders?.pageInfo?.hasNextPage || false;
                cursor = data.data?.orders?.pageInfo?.endCursor || null;
            } catch (batchError) {
                console.error(batchError);
                throw new Error(`Failed to fetch orders: ${batchError}`);
            }
        }

        for (const order of orders) {
            const productIds = order.lineItems?.edges
                ?.map((e: any) => e.node?.product?.id)
                .filter(Boolean) || [];
            const variantIds = order.lineItems?.edges
                ?.map((e: any) => e.node?.variant?.id)
                .filter(Boolean) || [];

            const discountCodes: string[] = [];
            const discountValues: string[] = [];
            order.discountApplications?.edges?.forEach((e: any) => {
                if (e.node?.code) discountCodes.push(e.node.code);
                if (e.node?.value?.percentage) discountValues.push(`${e.node.value.percentage}%`);
                else if (e.node?.value?.amount) discountValues.push(`${e.node.value.amount} ${e.node.value.currencyCode || ''}`.trim());
            });

            let totalRefunded = 0;
            const refundNotes: string[] = [];
            order.refunds?.forEach((r: any) => {
                if (r.totalRefundedSet?.shopMoney?.amount) totalRefunded += parseFloat(r.totalRefundedSet.shopMoney.amount);
                if (r.note) refundNotes.push(r.note);
            });

            const trackingCompanies: string[] = [];
            const trackingNumbers: string[] = [];
            const trackingUrls: string[] = [];

            order.fulfillments?.forEach((f: any) => {
                f.trackingInfo?.forEach((t: any) => {
                    if (t.company) trackingCompanies.push(t.company);
                    if (t.number) trackingNumbers.push(t.number);
                    if (t.url) trackingUrls.push(t.url);
                });
            });

            const upsertOrder = async () => {
                await prisma.order.upsert({
                where: { shop_shopifyId: { shop, shopifyId: order.id } },
                update: {
                    name: order.name,
                    totalPrice: order.totalPriceSet?.shopMoney?.amount ? parseFloat(order.totalPriceSet.shopMoney.amount) : 0,
                    financialStatus: order.displayFinancialStatus,
                    fulfillmentStatus: order.displayFulfillmentStatus,
                    customerName: order.customer?.displayName,
                    ...(order.customer?.id ? { customer: { connect: { shop_shopifyId: { shop, shopifyId: order.customer.id } } } } : {}),
                    productIds: productIds,
                    variantIds: variantIds,
                    discountCodes: discountCodes,
                    discountValues: discountValues,
                    totalRefunded: totalRefunded,
                    refundNotes: refundNotes,
                    returnStatus: order.returnStatus || null,
                    cancelledAt: order.cancelledAt ? new Date(order.cancelledAt) : null,
                    closed: order.closed || false,
                    note: order.note || null,
                    tags: order.tags || [],
                    trackingCompanies,
                    trackingNumbers,
                    trackingUrls,
                },
                create: {
                    shop,
                    shopifyId: order.id,
                    name: order.name,
                    totalPrice: order.totalPriceSet?.shopMoney?.amount ? parseFloat(order.totalPriceSet.shopMoney.amount) : 0,
                    financialStatus: order.displayFinancialStatus,
                    fulfillmentStatus: order.displayFulfillmentStatus,
                    customerName: order.customer?.displayName,
                    ...(order.customer?.id ? { customer: { connect: { shop_shopifyId: { shop, shopifyId: order.customer.id } } } } : {}),
                    productIds: productIds,
                    variantIds: variantIds,
                    discountCodes: discountCodes,
                    discountValues: discountValues,
                    totalRefunded: totalRefunded,
                    refundNotes: refundNotes,
                    returnStatus: order.returnStatus || null,
                    cancelledAt: order.cancelledAt ? new Date(order.cancelledAt) : null,
                    closed: order.closed || false,
                    note: order.note || null,
                    tags: order.tags || [],
                    trackingCompanies,
                    trackingNumbers,
                    trackingUrls,
                }
            });
            };

            try {
                await upsertOrder();
            } catch (err: any) {
                if ((err.code === "P2025" || err.message?.includes("Order_customerId_fkey")) && order.customer?.id) {
                    await indexSingleShopifyCustomer(admin, shop, order.customer.id);
                    await upsertOrder();
                } else {
                    throw err;
                }
            }
        }

        await prisma.indexStatus.update({
            where: { shop },
            data: { lastOrdersIndexedAt: new Date() }
        });

        return { success: true, count: orders.length, type: "orders" };
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        await prisma.indexStatus.update({ where: { shop }, data: { errorMessage: `Orders Error: ${msg}` } });
        throw error;
    }
}

export async function indexAllShopifyData(admin: AdminApiContext, shop: string, limits: { maxItems: number, maxOrders: number }) {
    try {
        await prisma.indexStatus.upsert({
            where: { shop },
            update: { status: "indexing", errorMessage: null },
            create: { shop, status: "indexing" },
        });

        const updateProductProgress = async (count: number) => {
            await prisma.indexStatus.update({
                where: { shop },
                data: { productsCount: count },
            });
        };

        const updateCollectionProgress = async (count: number) => {
            await prisma.indexStatus.update({
                where: { shop },
                data: { collectionsCount: count },
            });
        };

        const updateCustomerProgress = async (count: number) => {
            await prisma.indexStatus.update({
                where: { shop },
                data: { customersCount: count },
            });
        };

        const updateOrderProgress = async (count: number) => {
            await prisma.indexStatus.update({
                where: { shop },
                data: { ordersCount: count },
            });
        };

        const initialResults = await Promise.allSettled([
            indexShopifyCollections(admin, shop, limits.maxItems, updateCollectionProgress),
            indexShopifyOrders(admin, shop, limits.maxOrders, updateOrderProgress)
        ]);

        const customerResult = await Promise.allSettled([
            indexShopifyCustomers(admin, shop, limits.maxItems, updateCustomerProgress)
        ]);

        const productResult = await Promise.allSettled([
            indexShopifyProducts(admin, shop, limits.maxItems, updateProductProgress),
        ]);

        const results = [...initialResults, ...customerResult, ...productResult];

        const counts: { products: number; collections: number; customers: number; orders: number } = { products: 0, collections: 0, customers: 0, orders: 0 };
        const errors: string[] = [];

        results.forEach((result) => {
            if (result.status === "fulfilled") {
                const key = result.value.type as keyof typeof counts;
                if (key in counts) {
                    counts[key] = result.value.count;
                }
            } else {
                errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
            }
        });

        await prisma.indexStatus.update({
            where: { shop },
            data: {
                status: errors.length > 0 ? "error" : "idle",
                lastIndexedAt: new Date(),
                productsCount: counts.products,
                collectionsCount: counts.collections,
                customersCount: counts.customers,
                ordersCount: counts.orders,
                totalProducts: counts.products,
                totalCollections: counts.collections,
                totalCustomers: counts.customers,
                totalOrders: counts.orders,
                errorMessage: errors.length > 0 ? errors.join("; ") : null,
            },
        });

        return {
            success: errors.length === 0,
            message: errors.length > 0 ? `Completed with errors: ${errors.join("; ")}` : "All data indexed successfully",
            counts,
        };
    } catch (error) {
        await prisma.indexStatus.update({
            where: { shop },
            data: {
                status: "error",
                errorMessage: error instanceof Error ? error.message : "Unknown error",
            },
        });
        throw error;
    }
}

export async function indexSingleShopifyCustomer(admin: AdminApiContext, shop: string, customerId: string) {
    try {
        const formattedId = customerId.includes("gid://") ? customerId : `gid://shopify/Customer/${customerId}`;
        const query = `
      query GetCustomer($id: ID!) {
        customer(id: $id) {
          id
          firstName
          lastName
          email
          phone
          tags
          numberOfOrders
          amountSpent {
            amount
          }
        }
      }
    `;

        const response = await admin.graphql(query, {
            variables: { id: formattedId },
            tries: 3,
        });

        const data = (await response.json()) as GraphQLResponse<any>;
        if (data.errors) throw new Error(`Customer GraphQL Error: ${JSON.stringify(data.errors)}`);

        const customer = data.data?.customer;
        if (!customer) return { success: false, error: "Customer not found" };

        await prisma.customer.upsert({
            where: { shop_shopifyId: { shop, shopifyId: customer.id } },
            update: {
                firstName: customer.firstName,
                lastName: customer.lastName,
                email: customer.email,
                phone: customer.phone,
                tags: Array.isArray(customer.tags) ? customer.tags : [],
                ordersCount: customer.numberOfOrders ? parseInt(String(customer.numberOfOrders)) : 0,
                totalSpent: customer.amountSpent?.amount ? parseFloat(customer.amountSpent.amount) : 0,
            },
            create: {
                shop,
                shopifyId: customer.id,
                firstName: customer.firstName,
                lastName: customer.lastName,
                email: customer.email,
                phone: customer.phone,
                tags: Array.isArray(customer.tags) ? customer.tags : [],
                ordersCount: customer.numberOfOrders ? parseInt(String(customer.numberOfOrders)) : 0,
                totalSpent: customer.amountSpent?.amount ? parseFloat(customer.amountSpent.amount) : 0,
            }
        });

        return { success: true };
    } catch (error) {
        console.error("Failed to index single customer:", error);
        throw error;
    }
}

export async function indexSingleShopifyOrder(admin: AdminApiContext, shop: string, orderId: string) {
    try {
        const formattedId = orderId.includes("gid://") ? orderId : `gid://shopify/Order/${orderId}`;
        const query = `
      query GetOrder($id: ID!) {
        order(id: $id) {
          id
          name
          totalPriceSet {
            shopMoney {
              amount
            }
          } 
          displayFinancialStatus
          displayFulfillmentStatus
          customer {
            id
            displayName
          }
          returnStatus
          cancelledAt
          closed
          note
          tags
          lineItems(first: 50) {
            edges {
              node {
                product {
                  id
                }
              }
            }
          }
          discountApplications(first: 5) {
            edges {
              node {
                allocationMethod
                value {
                  ... on PricingPercentageValue {
                    percentage
                  }
                  ... on MoneyV2 {
                    amount
                    currencyCode
                  }
                }
                ... on DiscountCodeApplication {
                  code
                }
              }
            }
          }
          refunds(first: 5) {
            id
            createdAt
            note
            totalRefundedSet {
              shopMoney {
                amount
                currencyCode
              }
            }
          }
          fulfillments(first: 10) {
            trackingInfo {
              company
              number
              url
            }
          }
        }
      }
    `;

        const response = await admin.graphql(query, {
            variables: { id: formattedId },
            tries: 3,
        });

        const data = (await response.json()) as GraphQLResponse<any>;
        if (data.errors) throw new Error(`Order GraphQL Error: ${JSON.stringify(data.errors)}`);

        const order = data.data?.order;
        if (!order) return { success: false, error: "Order not found" };

        const productIds = order.lineItems?.edges
            ?.map((e: any) => e.node?.product?.id)
            .filter(Boolean) || [];

        const discountCodes: string[] = [];
        const discountValues: string[] = [];
        order.discountApplications?.edges?.forEach((e: any) => {
            if (e.node?.code) discountCodes.push(e.node.code);
            if (e.node?.value?.percentage) discountValues.push(`${e.node.value.percentage}%`);
            else if (e.node?.value?.amount) discountValues.push(`${e.node.value.amount} ${e.node.value.currencyCode || ''}`.trim());
        });

        let totalRefunded = 0;
        const refundNotes: string[] = [];
        order.refunds?.forEach((r: any) => {
            if (r.totalRefundedSet?.shopMoney?.amount) totalRefunded += parseFloat(r.totalRefundedSet.shopMoney.amount);
            if (r.note) refundNotes.push(r.note);
        });

        const trackingCompanies: string[] = [];
        const trackingNumbers: string[] = [];
        const trackingUrls: string[] = [];

        order.fulfillments?.forEach((f: any) => {
            f.trackingInfo?.forEach((t: any) => {
                if (t.company) trackingCompanies.push(t.company);
                if (t.number) trackingNumbers.push(t.number);
                if (t.url) trackingUrls.push(t.url);
            });
        });

        const upsertOrder = async () => {
            await prisma.order.upsert({
            where: { shop_shopifyId: { shop, shopifyId: order.id } },
            update: {
                name: order.name,
                totalPrice: order.totalPriceSet?.shopMoney?.amount ? parseFloat(order.totalPriceSet.shopMoney.amount) : 0,
                financialStatus: order.displayFinancialStatus,
                fulfillmentStatus: order.displayFulfillmentStatus,
                customerName: order.customer?.displayName,
                ...(order.customer?.id ? { customer: { connect: { shop_shopifyId: { shop, shopifyId: order.customer.id } } } } : {}),
                productIds: productIds,
                discountCodes: discountCodes,
                discountValues: discountValues,
                totalRefunded: totalRefunded,
                refundNotes: refundNotes,
                trackingCompanies: trackingCompanies,
                trackingNumbers: trackingNumbers,
                trackingUrls: trackingUrls,
                tags: Array.isArray(order.tags) ? order.tags : [],
                cancelledAt: order.cancelledAt,
                closed: order.closed,
                returnStatus: order.returnStatus,
                note: order.note,
            },
            create: {
                shop,
                shopifyId: order.id,
                name: order.name,
                totalPrice: order.totalPriceSet?.shopMoney?.amount ? parseFloat(order.totalPriceSet.shopMoney.amount) : 0,
                financialStatus: order.displayFinancialStatus,
                fulfillmentStatus: order.displayFulfillmentStatus,
                customerName: order.customer?.displayName,
                ...(order.customer?.id ? { customer: { connect: { shop_shopifyId: { shop, shopifyId: order.customer.id } } } } : {}),
                productIds: productIds,
                discountCodes: discountCodes,
                discountValues: discountValues,
                totalRefunded: totalRefunded,
                refundNotes: refundNotes,
                trackingCompanies: trackingCompanies,
                trackingNumbers: trackingNumbers,
                trackingUrls: trackingUrls,
                tags: Array.isArray(order.tags) ? order.tags : [],
                cancelledAt: order.cancelledAt,
                closed: order.closed,
                returnStatus: order.returnStatus,
                note: order.note,
            }
        });
        };

        try {
            await upsertOrder();
        } catch (err: any) {
            if ((err.code === "P2025" || err.message?.includes("Order_customerId_fkey")) && order.customer?.id) {
                await indexSingleShopifyCustomer(admin, shop, order.customer.id);
                await upsertOrder();
            } else {
                throw err;
            }
        }

        return { success: true };
    } catch (error) {
        console.error("Failed to index single order:", error);
        throw error;
    }
}