import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { NAMESPACE } from "~/constants";
import { createMetaFields, getAppInstallation, getMetaFields } from "./components";

export const loader = async ({ request }: LoaderFunctionArgs) => {
	if (request.method == "GET") {
		const { redirect } = await authenticate.admin(request);
		return redirect("/app/settings");
	}
	return null;
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
	const { admin } = await authenticate.admin(request);
	if (params.id == "import") {
		const formData = await request.formData();

		const data: FormDataEntryValue | null = formData.get("data");
		if (!data || data.toString().trim() === "") {
			return json({
				status: "error",
				tone: "critical",
				message: "Please add a valid JSON setting string",
			});
		}
		try {
			const jsonData = JSON.parse(data.toString());
			const appInstallation = await getAppInstallation(admin);
			if (!jsonData || appInstallation.status !== 200) {
				return json({
					status: "error",
					tone: "critical",
					message: "An error occurred while importing your settings. Please try again later.",
				});
			}
			await createMetaFields(admin, NAMESPACE, appInstallation.id || "", jsonData);
			return json({
				status: "success",
				tone: "success",
				message: "Settings imported successfully. Please reload the page.",
			});
		} catch (e) {
			return json({
				status: "error",
				tone: "critical",
				message: "An error occurred while importing your settings. Please try again later.",
			});
		}
	} else if (params.id == "export") {
		const metafields = await getMetaFields(admin, NAMESPACE);

		let value = "[]";
		metafields?.forEach((field: any) => {
			switch (field.node.key) {
				case "settings":
					try {
						JSON.parse(field.node.value);
						value = field.node.value;
					} catch (e) {}
					break;
				default:
					break;
			}
		});

		const date = new Date();
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, "0"); // Add leading zero for single-digit months
		const day = String(date.getDate()).padStart(2, "0");

		try {
            console.error("exporting", {
				status: "success",
				tone: "success",
				message: "",
				content: value,
				fileName: `export-${year}-${month}-${day}.json`,
				contentType: "text/plain",
			});
			return json({
				status: "success",
				tone: "success",
				message: "",
				content: value,
				fileName: `export-${year}-${month}-${day}.json`,
				contentType: "text/plain",
			});
		} catch (e) {
			console.error("export", e);
			return json({
				status: "error",
				tone: "critical",
				message: "An error occurred while exporting your settings. Please try again later.",
			});
		}
	}

	return json({
		status: "error",
		tone: "critical",
		message: "No action configured",
	});
};
