import type { CreatePageParameters } from "@notionhq/client/build/src/api-endpoints";
import { NOTION_SCHEMAS } from "./utils";

export type ProductProperty = keyof typeof NOTION_SCHEMAS.Products | "title" | "Collections";
export type VariantProperty = keyof typeof NOTION_SCHEMAS.Variants | "title" | "Product";
export type CollectionProperty = keyof typeof NOTION_SCHEMAS.Collections | "title";
export type OrderProperty = keyof typeof NOTION_SCHEMAS.Orders | "title" | "Products" | "Variants" | "Customer";
export type CustomerProperty = keyof typeof NOTION_SCHEMAS.Customers | "title" | "Orders";

export type NotionPropertyValue = Extract<CreatePageParameters["properties"], Record<string, any>>[string];
export type NotionProperties = CreatePageParameters["properties"];

export type ProductProps = Record<ProductProperty, NotionPropertyValue | null>;
export type VariantProps = Record<VariantProperty, NotionPropertyValue | null>;
export type CollectionProps = Record<CollectionProperty, NotionPropertyValue | null>;
export type OrderProps = Record<OrderProperty, NotionPropertyValue | null>;
export type CustomerProps = Record<CustomerProperty, NotionPropertyValue | null>;

export type SyncEntity = "products" | "collections" | "customers" | "orders";
