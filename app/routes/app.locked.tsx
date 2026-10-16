import {
	BlockStack,
	Button,
	Card,
	Grid,
	InlineStack,
	Page,
	Text,
} from "@shopify/polaris";

export default function LockedPage() {
	return (
		<Page>
			<BlockStack gap="500">
				<InlineStack>
					<Card background="bg-surface-caution">
						<BlockStack gap="200">
							<Text as="h3" variant="headingLg">
								You don't have an active subscription plan to
								unlock the app settings
							</Text>
							<BlockStack gap="100">
								<Grid columns={{ xl: 3 }}>
									<Grid.Cell
										column={{ xl: "1" }}
										columnSpan={{ xl: 2 }}
									>
										<p>
											To experience all the app have to
											offer, a subscription plan is
											required. Kindly visit our pricing
											page to find the one that best suits
											your needs.
										</p>
									</Grid.Cell>
									<InlineStack
										align="end"
										blockAlign="center"
									>
										<Button
											variant="primary"
											url="/app/pricing"
										>
											Continue to pricing page
										</Button>
									</InlineStack>
								</Grid>
							</BlockStack>
						</BlockStack>
					</Card>
				</InlineStack>
			</BlockStack>
		</Page>
	);
}
