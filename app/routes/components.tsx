import type { ShopifyGlobal } from "@shopify/app-bridge-react";
import { isAppStore } from "~/app-mode";
import {
	ActionList,
	AutoSelection,
	Banner,
	type BannerTone,
	Button,
	ButtonGroup,
	ColorPicker,
	Combobox,
	type ComplexAction,
	type DisableableAction,
	Divider,
	FormLayout,
	InlineStack,
	Listbox,
	type LoadableAction,
	MediaCard,
	Popover,
	Tag,
	Text,
	TextField,
	VideoThumbnail,
} from "@shopify/polaris";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import * as Sentry from "@sentry/remix";

// import { setAbstractFetchFunc } from "@shopify/shopify-api/runtime";
import { useFetcher } from "@remix-run/react";
import { GROWTH_PLAN, MAX_PLAN, NAMESPACE } from "~/constants";
import { type BillingContext } from "node_modules/@shopify/shopify-app-remix/dist/ts/server/authenticate/admin/billing/types";
import { type AppConfigArg } from "node_modules/@shopify/shopify-app-remix/dist/ts/server/config-types";
import { AdminApiContext } from "@shopify/shopify-app-remix/server";

declare let window: Window & {
	shopify: ShopifyGlobal;
};

export const SelectedTags = ({ tags, onChange }: { tags: Array<{ id: string; title: string }> | []; onChange: (tags: Array<{ id: string; title: string }> | []) => void }) => {
	const selectItems = () => {
		window.shopify
			.resourcePicker({
				type: "product",
				multiple: true,
				action: "select", // customized action verb, either 'select' or 'add',
			})
			.then((selected) => {
				if (selected && selected.length > 0) {
					let newTags: Array<{ id: string; title: string }> | [] = [...tags, ...selected.map(({ id, title }) => ({ id, title }))];

					let uniqueTags = Object.values(newTags).filter((item, index, self) => index === self.findIndex((t) => t.id === item.id));

					onChange(uniqueTags);
				}
			})
			.catch((error) => { });
	};

	const removeTag = useCallback(
		(index: number) => () => {
			onChange(tags.filter((previousTag, nindex) => index !== nindex));
		},
		[tags, onChange],
	);

	const tagMarkup = tags.map(({ id, title }, index) => (
		<Tag key={index} onRemove={removeTag(index)}>
			{title}
		</Tag>
	));

	return (
		<>
			<Button variant="plain" onClick={selectItems}>
				Select products
			</Button>
			<InlineStack gap="200" wrap={true}>
				{tagMarkup}
			</InlineStack>
		</>
	);
};

export const ColorPickerField = ({ color, onChange }: { color: string; onChange: (color: string) => void }) => {
	const [popoverActive, setPopoverActive] = useState(false);

	const togglePopoverActive = useCallback(() => setPopoverActive((popoverActive) => !popoverActive), []);

	const activator = (
		<Button
			onClick={togglePopoverActive}
			icon={
				<span
					style={{
						background: color,
						height: "14px",
						width: "14px",
						borderRadius: "50%",
						display: "block",
						marginRight: "3px",
					}}
				>
					&nbsp;
				</span>
			}
		>
			Select Color
		</Button>
	);

	const hslaToColor = (hsla: string) => {
		if (!hsla) {
			return {
				hue: 100,
				brightness: 100,
				saturation: 100,
				alpha: 1,
			};
		}

		const colorValues = hsla.slice(5, -1).split(", ");

		// Extract the individual values
		const hue = parseFloat((colorValues[0] || 100).toString());
		const saturation = parseFloat((colorValues[1] || 100).toString());
		const brightness = parseFloat((colorValues[2] || 100).toString());
		const alpha = parseFloat((colorValues[3] || 1).toString());

		return {
			hue: hue || 100,
			brightness: brightness || 100,
			saturation: saturation || 100,
			alpha: alpha || 1,
		};
	};

	return (
		<Popover active={popoverActive} activator={activator} autofocusTarget="first-node" onClose={togglePopoverActive}>
			<ColorPicker
				color={hslaToColor(color)}
				onChange={(color) => {
					onChange(`hsla(${color.hue},${color.saturation * 100}%,${color.brightness * 100}%,${color.alpha})`);
				}}
				allowAlpha
			/>
			;
		</Popover>
	);
};

export const MultiselectCombobox = ({
	label,
	value,
	options,
	onChange,
}: {
	label?: string;
	value: Array<string>;
	options: Array<{ label: string; value: string }>;
	onChange: (value: Array<string>) => void;
}) => {
	const [suggestion, setSuggestion] = useState("");
	const [search, setSearch] = useState("");

	const handleActiveOptionChange = useCallback(
		(activeOption: string) => {
			const activeOptionIsAction = activeOption === search;

			if (!activeOptionIsAction && !value.includes(activeOption)) {
				setSuggestion(activeOption);
			} else {
				setSuggestion("");
			}
		},
		[search, value],
	);
	const updateSelection = useCallback(
		(selected: string) => {
			const nextSelectedTags = new Set([...value]);

			if (nextSelectedTags.has(selected)) {
				nextSelectedTags.delete(selected);
			} else {
				nextSelectedTags.add(selected);
			}

			onChange([...nextSelectedTags]);
			setSuggestion("");
		},
		[value, onChange],
	);

	const removeTag = useCallback(
		(tag: string) => () => {
			updateSelection(tag);
		},
		[updateSelection],
	);

	const formatOptionText = useCallback(
		(option: string) => {
			const trimValue = search.trim().toLocaleLowerCase();
			const matchIndex = option.toLocaleLowerCase().indexOf(trimValue);

			if (!search || matchIndex === -1) return option;

			const start = option.slice(0, matchIndex);
			const highlight = option.slice(matchIndex, matchIndex + trimValue.length);
			const end = option.slice(matchIndex + trimValue.length, option.length);

			return (
				<p>
					{start}
					<Text fontWeight="bold" as="span">
						{highlight}
					</Text>
					{end}
				</p>
			);
		},
		[search],
	);

	const verticalContentMarkup =
		value.length > 0 ? (
			<InlineStack gap="100" wrap={true}>
				{options.map((option, index) => {
					return value.includes(option.value) ? (
						<Tag key={`option-${index}`} onRemove={removeTag(option.value)}>
							{option.label}
						</Tag>
					) : null;
				})}
			</InlineStack>
		) : null;

	const optionMarkup =
		options.length > 0
			? options.map((option) => {
				return (
					<Listbox.Option key={option.value} value={option.value} selected={value.includes(option.value)} accessibilityLabel={option.label}>
						<Listbox.TextOption selected={value.includes(option.value)}>{formatOptionText(option.label)}</Listbox.TextOption>
					</Listbox.Option>
				);
			})
			: null;

	const listboxMarkup = optionMarkup ? (
		<Listbox autoSelection={AutoSelection.None} onSelect={updateSelection} onActiveOptionChange={handleActiveOptionChange}>
			{optionMarkup}
		</Listbox>
	) : null;

	return (
		<Combobox
			allowMultiple
			activator={
				<Combobox.TextField
					autoComplete="off"
					label={label || "Select an option"}
					labelHidden
					value={""}
					suggestion={suggestion}
					placeholder={label || "Select an option"}
					verticalContent={verticalContentMarkup}
					onChange={setSearch}
				/>
			}
		>
			{listboxMarkup}
		</Combobox>
	);
};

export const getMetaFieldsDefinition = (namespace: string, appInstallationId: string, data: { [x: string]: any } = {}) => {
	return [
		{
			namespace: namespace,
			key: "settings",
			value: JSON.stringify(data || {}),
			type: "json",
			ownerId: appInstallationId,
		},
	];
};

export const checkIfBlockEnabled = async (
	admin: AdminApiContext,
	name: string,
	key: string = "config/settings_data.json",
): Promise<
	| {
		activeTheme: {
			id: string;
			name: string;
		};
		active: boolean;
	}
	| Error
> => {
	try {
		const responseQuery = await admin.graphql(
			`#graphql
            query {
                themes(first:1, roles: [MAIN]) {
                    edges {
                        node {
                            name
                            id
                            role
                            files(filenames: ["${key}"]) {
                                edges {
                                    node {
                                        body {
                                        ... on OnlineStoreThemeFileBodyText {
                                                content
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }`,
			{ tries: 3 },
		);

		let response = await responseQuery.json();
		if (response.data!.errors) {
			return new Error((response.data!.errors || []).map((e: any) => e.message || "").join(", ") || "");
		}

		let activeTheme = {
			id: response.data!.themes!.edges[0].node.id,
			name: response.data!.themes!.edges[0].node.name,
		};

		let themeConfig = response.data!.themes!.edges[0].node.files.edges[0].node.body.content;

		let theme = JSON.parse(themeConfig.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/|#.*)/g, (m: any, g: any) => (g ? "" : m)));


		const found =
			theme.current.blocks &&
			(Object.values(theme.current.blocks) as { type: string; disabled: boolean; settings: any }[]).some((block) => {
				const regexp = new RegExp("^shopify://apps/(" + name + ")/*");
				if (regexp.test(block.type)) {
					return !block.disabled;
				}
				return false;
			});
		return {
			activeTheme: activeTheme,
			active: found,
		};
	} catch (err: any) {
		Sentry.captureException(err);
		return new Error(err.message || "");
	}
};

export const errorHandler = async (admin: AdminApiContext, error: any, name: string) => {
	try {
		const shop = await getShop(admin);
		if (shop) {
			Sentry.captureMessage(`Error in ${shop.name} (${shop.primaryDomain.url}) (${shop.email}): ${error.message}`);
		}
	} catch (err) {
		Sentry.captureException(err);
	}
	Sentry.captureException(error);
};

export const getCurrentApp = async (
	admin: AdminApiContext,
): Promise<{
	id: string;
	launchUrl: string;
	activeSubscriptions: {
		id: string;
		name: string;
		currentPeriodEnd: string;
		createdAt: string;
		trialDays: number;
		status: string;
		test: boolean;
	}[];
} | null> => {
	try {
		const appInstallationMetaFieldResponse = await admin.graphql(
			`#graphql
            query {
                currentAppInstallation {
                    id
                    launchUrl
                    activeSubscriptions {
                        id
                        name 
                        currentPeriodEnd
                        createdAt
                        trialDays
                        status
                        test
                    }
                }
            }`,
			{ tries: 3 },
		);

		let response = await appInstallationMetaFieldResponse.json();
		if (response.data!.errors) {
			return null;
		}
		return response.data!.currentAppInstallation!;
	} catch (err) {
		Sentry.captureException(err);
	}
	return null;
};

export const getMetaFields = async (
	admin: AdminApiContext,
	namespace: string,
): Promise<
	| Array<
		{
			node: {
				namespace: string;
				key: string;
				value: string;
			};
		}
	>
	| null
> => {
	try {
		const appInstallationMetaFieldResponse = await admin.graphql(
			`#graphql
            query {
                currentAppInstallation {
                    id
                    launchUrl
                    metafields(first: 10, namespace: "${namespace}") {
                        edges {
                            node{
                                namespace
                                key
                                value
                            }
                        }
                    }
                }
            }`,
			{ tries: 3 },
		);

		let response = await appInstallationMetaFieldResponse.json();
		if (response.data!.errors) {
			Sentry.captureException(response.data!.errors);
			return null;
		}

		return response.data!.currentAppInstallation!.metafields!.edges;
	} catch (err) {
		Sentry.captureException(err);
	}
	return null;
};

export const getShop = async (
	admin: AdminApiContext,
): Promise<{
	id: string;
	name: string;
	email: string;
	primaryDomain: {
		host: string;
		url: string;
	};
	plan: {
		partnerDevelopment: boolean;
	};
} | null> => {
	try {
		const shopResponse = await admin.graphql(
			`#graphql
            query {
                shop {
                    id
                    name
                    email
                    primaryDomain{
                        host
                        url
                    }
                    plan {
                        partnerDevelopment
                    }
                }
            }`,
			{ tries: 3 },
		);

		const response = await shopResponse.json();
		if (response.data!.errors) {
			Sentry.captureException(response.data!.errors);
			return null;
		}
		const shop = response.data!.shop;
		return shop;
	} catch (err) {
		Sentry.captureException(err);
	}
	return null;
};

export const getShopLocales = async (
	admin: AdminApiContext,
): Promise<
	{
		locale: string;
		name: string;
		primary: boolean;
		published: boolean;
	}[]
> => {
	try {
		const shopResponse = await admin.graphql(
			`#graphql
            query {
                shopLocales {
                    locale
                    name
                    primary
                    published
                }
            }`,
			{ tries: 3 },
		);
		const response = await shopResponse.json();
		if (response.data!.errors) {
			return [
				{
					locale: "en",
					name: "English",
					primary: true,
					published: true,
				},
			];
		}
		const shopLocales = response.data!.shopLocales;
		return shopLocales;
	} catch (err) { }
	return [
		{
			locale: "en",
			name: "English",
			primary: true,
			published: true,
		},
	];
};

export const getAppInstallation = async (
	admin: AdminApiContext,
): Promise<{
	status: number;
	message: string;
	id?: string;
	accessScopes?: any;
}> => {
	const appInstallationResponse = await admin.graphql(
		`#graphql
    query {
        currentAppInstallation {
          id
          accessScopes {
            handle
            description
          }
        }
      }`,
		{ tries: 3 },
	);
	let response = await appInstallationResponse.json();
	if (response.data!.errors) {
		return {
			status: 400,
			message: "No app installation found",
		};
	}
	if (response.data.currentAppInstallation) {
		return {
			status: 200,
			...response.data.currentAppInstallation,
		};
	} else {
		return {
			status: 400,
			message: "No app installation found",
		};
	}
};

export const createMetaFields = async (
	admin: AdminApiContext,
	namespace: string,
	appInstallationId: string,
	data: { [x: string]: any } = {},
): Promise<{
	status: number;
	message?: string;
	fields?: any[];
}> => {
	try {
		const createMetafieldResponse = await admin.graphql(
			`#graphql
            mutation CreateAppDataMetafield($metafields: [MetafieldsSetInput!]!) {
                    metafieldsSet(metafields: $metafields) {
                      metafields {
                        key
                        namespace
                        value
                        createdAt
                        updatedAt
                      }
                      userErrors {
                        field
                        message
                        code
                      }
                    }
                  }`,
			{
				variables: {
					metafields: getMetaFieldsDefinition(namespace, appInstallationId, data),
				},
				tries: 3,
			},
		);
		let createResponse = await createMetafieldResponse.json();
		console.log('Creaing metafields', createResponse.data);
		if (createResponse.data!.errors) {
			return {
				status: 400,
				message: createResponse.data!.errors[0].message,
			};
		}
		let errors = createResponse!.data!.metafieldsSet!.userErrors;
		if (errors && errors.length > 0) {
			return {
				status: 400,
				message: errors[0].message,
			};
		}
		return {
			status: 200,
			fields: createResponse!.data!.metafieldsSet!.metafields || [],
		};
	} catch (err: any) {
		return {
			status: 400,
			message: err.message,
		};
	}
};

export const clearMetafields = async (admin: AdminApiContext, namespace: string) => {
	const appInstallation = await getAppInstallation(admin);
	return await createMetaFields(admin, namespace, appInstallation.id || "", {});
};

export const MessageModal = ({
	title,
	message,
	show,
	tone,
	onClose,
	action,
}: {
	title?: string;
	message?: string;
	show?: boolean;
	tone?: BannerTone;
	onClose?: () => void;
	action?: DisableableAction & LoadableAction;
}) => {
	if (!show) return null;
	if (onClose) {
		setTimeout(() => {
			onClose();
		}, 5000);
	}
	return (
		<div style={{ position: "fixed", bottom: "2rem", left: "50%", transform: "translate(-50%, 0)", maxWidth: "400px" }}>
			<Banner
				title={title}
				action={action}
				secondaryAction={
					onClose
						? {
							content: "Close",
							onAction: onClose,
						}
						: undefined
				}
				tone={tone || "info"}
			>
				<p>{message}</p>
			</Banner>
		</div>
	);
};

export const VideoCard = ({
	title,
	thumbnailUrl,
	videoLength,
	description,
	primaryAction,
	onClick,
}: {
	title: string;
	videoLength?: number;
	thumbnailUrl: string;
	description: string;
	primaryAction: ComplexAction;
	onClick: () => void;
}) => {
	return (
		<MediaCard title={title} primaryAction={primaryAction} description={description}>
			<VideoThumbnail videoLength={videoLength} thumbnailUrl={thumbnailUrl} onClick={onClick} />
		</MediaCard>
	);
};

export const calculateTrialStatus = (currentAppInstallation: any): number => {
	if (!currentAppInstallation || !currentAppInstallation.activeSubscriptions || currentAppInstallation.activeSubscriptions.length === 0) {
		return -1;
	}

	const subscription = currentAppInstallation.activeSubscriptions[0];
	const currentPeriodEnd = new Date(subscription.currentPeriodEnd);
	const createdAt = new Date(subscription.createdAt);
	const trialDays = subscription.trialDays;

	// Calculate the remaining trial days
	const now = new Date();
	const elapsedMilliseconds = now.getTime() - createdAt.getTime();
	const elapsedDays = elapsedMilliseconds / (1000 * 60 * 60 * 24);
	let remainingTrialDays = trialDays - elapsedDays;

	// Adjust remaining trial days if past the current period end
	if (now > currentPeriodEnd) {
		remainingTrialDays = 0;
	}

	// Ensure remaining trial days is not negative
	remainingTrialDays = Math.max(0, remainingTrialDays);

	// Round remaining trial days to the nearest whole number
	remainingTrialDays = Math.round(remainingTrialDays);

	return remainingTrialDays;
};

export const FeedbackModal = ({
	title,
	show,
	onSubmit,
	onClose,
}: {
	title?: string;
	show?: boolean;
	onClose?: () => void;
	onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) => {
	const fetcher = useFetcher<{
		status: string;
		tone: BannerTone;
		message: string;
	}>();

	const [data, setData] = useState(fetcher.data);
	useEffect(() => {
		if (fetcher.state === "idle") {
			setData(fetcher.data);
		}
	}, [fetcher.state, fetcher.data]);

	const isLoading = fetcher.state !== "idle";
	const [message, setMessage] = useState("");
	if (!show) return null;
	return (
		<>
			<div
				style={{
					position: "fixed",
					top: "0%",
					left: "0%",
					height: "100%",
					width: "100%",
					backgroundColor: "rgba(0,0,0,0.8)",
					zIndex: 8,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
				}}
				onClick={(e) => onClose && onClose()}
			>
				<div style={{ width: "600px" }} onClick={(e) => e.stopPropagation()}>
					{(!data || data.status != "success") && (
						<Banner title={title} onDismiss={onClose}>
							<fetcher.Form onSubmit={onSubmit} action="/app/feedback" method="post">
								<FormLayout>
									<TextField
										value={message}
										onChange={(value) => setMessage(value)}
										label="Message"
										name="message"
										type="text"
										multiline={5}
										autoComplete={"off"}
										helpText={<small>Please be as much detailed as possible and add your email address if you require us to contact you back.</small>}
									/>
									<Divider />
									<ButtonGroup>
										<Button disabled={isLoading} variant="primary" submit loading={isLoading}>
											Send Message
										</Button>
										<Button onClick={onClose}>Cancel</Button>
									</ButtonGroup>
								</FormLayout>
							</fetcher.Form>
						</Banner>
					)}
					{data ? (
						<Banner
							tone={data.tone}
							onDismiss={() => {
								setData(undefined);
							}}
						>
							<p>{data.message}</p>
						</Banner>
					) : null}
				</div>
			</div>
		</>
	);
};

export const ImportExportSettingsModal = ({
	show,
	modal,
	onClose,
}: {
	modal?: { title: string; label: string; action: string; currentAction: string };
	show: boolean;
	onClose: () => void;
}) => {
	const [json, setJson] = useState("");
	const fetcher = useFetcher<{
		status: string;
		tone: BannerTone;
		message: string;
	}>();

	const [data, setData] = useState(fetcher.data);
	useEffect(() => {
		if (fetcher.state === "idle") {
			setData(fetcher.data);
		}
	}, [fetcher.state, fetcher.data]);

	const isLoading = fetcher.state !== "idle";
	return (
		<>
			{show && modal && (
				<div
					style={{
						position: "fixed",
						top: "0%",
						left: "0%",
						height: "100%",
						width: "100%",
						backgroundColor: "rgba(0,0,0,0.8)",
						zIndex: 8,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
					}}
					onClick={onClose}
				>
					<div style={{ width: "600px" }} onClick={(e) => e.stopPropagation()}>
						{(!data || data.status != "success") && (
							<Banner title={modal.title} onDismiss={onClose}>
								<fetcher.Form action="/app/actions/import" method="post">
									<FormLayout>
										{modal.currentAction === "import" && (
											<>
												<TextField
													value={json}
													onChange={(value) => setJson(value)}
													label="JSON Data"
													name="data"
													type="text"
													multiline={5}
													autoComplete={"off"}
													helpText={<small>Please add the json data to import the settings.</small>}
												/>
												<Divider />
											</>
										)}
										<ButtonGroup>
											<Button disabled={isLoading} variant="primary" submit loading={isLoading}>
												{modal.label}
											</Button>
											<Button onClick={onClose}>Cancel</Button>
										</ButtonGroup>
									</FormLayout>
								</fetcher.Form>
							</Banner>
						)}
						{data ? (
							<Banner
								tone={data.tone}
								onDismiss={() => {
									setData(undefined);
								}}
							>
								<p>{data.message}</p>
							</Banner>
						) : null}
					</div>
				</div>
			)}
		</>
	);
};
export const ImportExportSettingsPopover = ({
	onToggleModal,
}: {
	onToggleModal: ({ title, label, action, currentAction }: { title: string; label: string; action: string; currentAction: string }) => void;
}) => {
	const [active, setActive] = useState(true);

	const toggleActive = useCallback(() => setActive((active) => !active), []);
	const handleImportedAction = useCallback(() => {
		onToggleModal({
			title: "Import Settings",
			label: "Import",
			action: "/app/actions/import",
			currentAction: "import",
		});
		setActive(false);
	}, []);

	const fetcher = useFetcher<{
		status: string;
		content?: string;
		fileName?: string;
		tone: BannerTone;
		message: string;
	}>();

	const download = (content: string, fileName: string) => {
		try {
			const blob = new Blob([content], { type: "application/json" }),
				urlForDownload = URL.createObjectURL(blob),
				linkElement = document.createElement("a"); // create hyperlink HTML element

			linkElement.href = urlForDownload;
			linkElement.download = fileName;
			linkElement.click();
			linkElement.remove();

			URL.revokeObjectURL(urlForDownload); // free memory}
		} catch (e) {
			console.log(e);
		}
	};

	const [data, setData] = useState(fetcher.data);
	useEffect(() => {
		if (fetcher.state === "idle") {
			setData(fetcher.data);
		}
	}, [fetcher.state, fetcher.data]);

	useEffect(() => {
		if (data?.status === "success" && data.content) {
			download(data.content, data.fileName || "settings.json");
		}
	}, [data]);
	const handleExportedAction = useCallback(() => {
		fetcher.submit(
			{},
			{
				method: "post",
				encType: "application/json",
				action: "/app/actions/export",
			},
		);
		setActive(false);
	}, []);

	const activator = (
		<Button onClick={toggleActive} disclosure>
			More actions
		</Button>
	);

	return (
		<>
			<Popover active={active} activator={activator} autofocusTarget="first-node" onClose={toggleActive}>
				<ActionList
					actionRole="menuitem"
					items={[
						{
							content: "Import settings",
							onAction: handleImportedAction,
						},
						{
							content: "Export settings",
							onAction: handleExportedAction,
						},
					]}
				/>
			</Popover>
		</>
	);
};

export const checkBilling = async ({ onFailure, billing }: { onFailure: (error?: any) => Promise<Response>; billing: BillingContext<AppConfigArg> }) => {
	// self-hosted custom apps have no Shopify billing (and no plans)
	if (!isAppStore()) return null;
	const billingCheck = await billing.require({
		plans: [GROWTH_PLAN, MAX_PLAN] as any,
		isTest: !!(process.env.TEST_PAYMENT == "yes"),
		onFailure,
	});

	return billingCheck;
};

export const deleteAppMetaFields = async (admin: AdminApiContext, keys: string[], namespace: string = NAMESPACE): Promise<boolean | Error> => {
	try {
		const installation = await getAppInstallation(admin);
		const deleteMetaFieldsResponse = await admin.graphql(
			`#graphql
            mutation DeleteAppDataMetafield($metafields: [MetafieldIdentifierInput!]!) {
                metafieldsDelete(metafields: $metafields) {
                    deletedMetafields {
                        key
                    }
                    userErrors {
                        field
                        message
                    }
                }
            }`,
			{
				variables: {
					metafields: keys.map((key) => ({ key, namespace, ownerId: installation.id })),
				},
				tries: 3,
			},
		);
		let deleteResponse = await deleteMetaFieldsResponse.json();
		if (deleteResponse.data!.errors) {
			return new Error(deleteResponse.data!.errors.map((e: any) => e.message || "").join(", "));
		}
		let errors = deleteResponse!.data!.metafieldsDelete!.userErrors;
		if (errors && errors.length > 0) {
			return new Error(errors.map((e: any) => e.message || "").join(", "));
		}

		return true;
	} catch (err: any) {
		return new Error(err.message);
	}
};
