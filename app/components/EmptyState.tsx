import { Box, BlockStack, Text } from "@shopify/polaris";

interface EmptyStateProps {
  emoji?: string | React.ReactElement;
  heading: string;
  description?: string;
}

export function EmptyState({ emoji = "🔍", heading, description }: EmptyStateProps) {
  return (
    <Box padding="1000" background="bg-surface-secondary" borderRadius="200">
      <BlockStack gap="200" align="center">
        <Text as="p" alignment="center" variant="headingMd">
          {emoji}
        </Text>
        <Text as="p" alignment="center" variant="headingMd" fontWeight="semibold">
          {heading}
        </Text>
        {description && (
          <Text as="p" alignment="center" variant="bodySm" tone="subdued">
            {description}
          </Text>
        )}
      </BlockStack>
    </Box>
  );
}