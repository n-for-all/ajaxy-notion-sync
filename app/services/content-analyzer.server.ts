/**
 * Content analyzer service for extracting and cleaning content from HTML
 */

/**
 * Strip HTML tags and extract clean text
 */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, " ") // Remove HTML tags
    .replace(/&nbsp;/g, " ") // Replace non-breaking spaces
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();
}

/**
 * Extract first N characters as summary/description
 */
export function extractSummary(text: string, maxLength: number = 300): string {
  if (!text) return "";
  const cleaned = stripHtml(text);
  if (cleaned.length <= maxLength) return cleaned;

  // Try to cut at a sentence boundary
  const truncated = cleaned.substring(0, maxLength);
  const lastPeriod = truncated.lastIndexOf(".");
  const lastSpace = truncated.lastIndexOf(" ");

  if (lastPeriod > maxLength * 0.8) {
    return truncated.substring(0, lastPeriod + 1);
  } else if (lastSpace > 0) {
    return truncated.substring(0, lastSpace) + "...";
  }

  return truncated + "...";
}

/**
 * Extract key information from HTML content
 */
export function analyzeContent(html: string | null | undefined) {
  if (!html) return { text: "", summary: "", wordCount: 0, hasImages: false };

  const text = stripHtml(html);
  const summary = extractSummary(text, 300);
  const wordCount = text
    .split(/\s+/)
    .filter((word) => word.length > 0).length;

  // Check if content mentions images (simple heuristic)
  const hasImages = /image|photo|picture|visual|screenshot/i.test(text);

  return {
    text,
    summary,
    wordCount,
    hasImages,
  };
}

/**
 * Build searchable content from multiple sources
 */
export function buildSearchableContent(
  title: string,
  description: string | null | undefined,
  body: string | null | undefined,
  tags: string[] = [],
  additionalInfo: string[] = []
): string {
  const parts: string[] = [];

  // Add title with higher priority (repeated for better search relevance)
  if (title) {
    parts.push(title, title);
  }

  // Add description
  if (description) {
    parts.push(stripHtml(description));
  }

  // Add body content
  if (body) {
    const bodyText = stripHtml(body);
    // Only use first 1000 chars to keep index lean
    parts.push(bodyText.substring(0, 1000));
  }

  // Add tags
  if (tags && tags.length > 0) {
    parts.push(tags.join(" "));
  }

  // Add additional info
  if (additionalInfo && additionalInfo.length > 0) {
    parts.push(additionalInfo.join(" "));
  }

  return parts.filter(Boolean).join(" ");
}

/**
 * Extract key attributes from product variants for searchability
 */
export function extractVariantAttributes(variants: any[]): string[] {
  if (!variants || variants.length === 0) return [];

  const attributes: Set<string> = new Set();

  for (const variant of variants) {
    // Add variant title
    if (variant.title) {
      attributes.add(variant.title);
    }

    // Add SKU
    if (variant.sku) {
      attributes.add(variant.sku);
    }

    // Add barcode
    if (variant.barcode) {
      attributes.add(variant.barcode);
    }

    // Parse option names from variant title (e.g., "Red / Small" -> "Red", "Small")
    if (variant.title && variant.title.includes("/")) {
      const options = variant.title.split("/").map((o: string) => o.trim());
      options.forEach((opt: string) => {
        if (opt) attributes.add(opt);
      });
    }
  }

  return Array.from(attributes);
}

/**
 * Process and normalize image data
 */
export function processImages(images: any[]) {
  if (!images || images.length === 0) return [];

  return images
    .map((img, index) => ({
      shopifyImageId: img.id || "",
      url: img.src || img.url || "",
      altText: img.altText || img.alt_text || img.title || "",
      position: index,
    }))
    .filter((img) => img.url); // Only include images with URLs
}

/**
 * Process and normalize variant data
 */
export function processVariants(variants: any[]) {
  if (!variants || variants.length === 0) return [];

  return variants
    .map((v) => ({
      shopifyVariantId: v.id || "",
      title: v.title || "",
      price: parseFloat(v.price) || 0,
      compareAtPrice: v.compareAtPrice ? parseFloat(v.compareAtPrice) : null,
      sku: v.sku || null,
      barcode: v.barcode || null,
      weight: null,
      weightUnit: "lb",
      taxable: v.taxable !== false,
      inventory: 0,
      options: {},
    }))
    .filter((v) => v.shopifyVariantId);
}

/**
 * Calculate price range from variants
 */
export function calculatePriceRange(variants: any[]) {
  if (!variants || variants.length === 0) {
    return { minPrice: 0, maxPrice: 0 };
  }

  const prices = variants
    .map((v) => parseFloat(v.price) || 0)
    .filter((p) => p > 0);

  if (prices.length === 0) {
    return { minPrice: 0, maxPrice: 0 };
  }

  return {
    minPrice: Math.min(...prices),
    maxPrice: Math.max(...prices),
  };
}
