/// <reference types="vite/client" />
declare module "*.css";

export interface ISetting {
	selector: string;
	features: string;
	modifier_key: string;
	overlay_selector: boolean;
	dark_mode: string;
}

export interface ILabelsSetting {
	placeholder: string;
	recent_label: string;
	pages_label: string;
	articles_label: string;
	collections_label: string;
	products_label: string;
	no_recent: string;
	show_more_label: string;
	enable_sale_tag: boolean;
	sale_tag: string;
	sale_tag_color: string;
	enable_outofstock_tag: boolean;
	outofstock_tag: string;
	outofstock_tag_color: string;
	products: Array<{
		id: string;
		title: string;
	}>;
	results_found_label: string;
	results_not_started_label: string;
	results_searching_label: string;
	rtl: boolean;
	ai_chat_welcome_message: string;
	ai_chat_placeholder: string;
	ai_chat_bot_icon: string;
	ai_chat_user_icon: string;
	ai_chat_mode: "both" | "ai" | "search";
	ai_chat_default: "ai" | "search";
}

export interface IAppSettings {
	labels: Record<string, ILabelsSetting>;
	settings: ISetting;
}

export type SearchProduct = {
	id: string;
	shopifyId?: string;
	title: string;
	type: string;
	price: number | null;
	url: string | null;
	imageUrl: string | null;
	handle: string | null;
	vendor: string | null;
	productType: string | null;
	material: string | null;
	content: string;
};
