import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { getAppInstallation, getShop } from "./components";
import nodemailer from "nodemailer";
import * as Sentry from "@sentry/remix";

const createEmailTemplate = ({
	title,
	shop,
	app,
	formData,
}: {
	title: string;
	shop: {
		id: string;
		name: string;
		email: string;
		primaryDomain: {
			host: string;
			url: string;
		};
	} | null;
	app: {
		status: number;
		message: string;
		id?: string;
		accessScopes?: any;
	};
	formData: FormData;
}) => {
	const createRow = (label: string, value: string) => {
		return `<tr>
                    <td style="padding: 10px; border-bottom: 1px solid #ededed; border-right: 1px solid #ededed; width: 35%; font-weight:500; color:rgba(0,0,0,.64)">${label}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #ededed; color: #455056;"> ${value}</td>
                </tr>`;
	};

	const getFormData = () => {
		const rows = [];
		for (const pair of formData.entries()) {
			rows.push(createRow(pair[0], pair[1].toString()));
		}
		return rows.join("");
	};
	return `<!doctype html>
<html lang="en-US">
<head>
    <meta content="text/html; charset=utf-8" http-equiv="Content-Type" />
    <title>${title}</title>
    <meta name="description" content="${title}">
</head>
<body marginheight="0" topmargin="0" marginwidth="0" style="margin: 0px; background-color: #f2f3f8;" leftmargin="0">
    <table cellspacing="0" border="0" cellpadding="0" width="100%" bgcolor="#f2f3f8">
        <tr>
            <td>
                <table style="background-color: #f2f3f8; max-width:670px; margin:0 auto;" width="100%" border="0"
                    align="center" cellpadding="0" cellspacing="0">
                    <tr>
                        <td style="height:80px;">&nbsp;</td>
                    </tr>
                    <tr>
                        <td style="text-align:center;">
                          <a href="https://ajaxy.org" title="logo" target="_blank">
                            <img height="60" src="https://www.ajaxy.org/wp-content/uploads/2016/07/cropped-logo-5.png" title="logo" alt="logo">
                          </a>
                        </td>
                    </tr>
                    <tr>
                        <td style="height:20px;">&nbsp;</td>
                    </tr>
                    <tr>
                        <td>
                            <table width="95%" border="0" align="center" cellpadding="0" cellspacing="0"
                                style="max-width:670px; background:#fff; border-radius:3px;-webkit-box-shadow:0 6px 18px 0 rgba(0,0,0,.06);-moz-box-shadow:0 6px 18px 0 rgba(0,0,0,.06);box-shadow:0 6px 18px 0 rgba(0,0,0,.06);padding:0 40px;">
                                <tr>
                                    <td style="height:40px;">&nbsp;</td>
                                </tr>
                                <tr>
                                    <td style="padding:0 15px; text-align:center;">
                                        <h1 style="color:#1e1e2d; font-weight:400; margin:0;font-size:32px;font-family:'Rubik',sans-serif;">${title}</h1>
                                        <span style="display:inline-block; vertical-align:middle; margin:29px 0 26px; border-bottom:1px solid #cecece; 
                                        width:100px;"></span>
                                    </td>
                                </tr>
                                <tr>
                                    <td>
                                        <table cellpadding="0" cellspacing="0"
                                            style="width: 100%; border: 1px solid #ededed">
                                            <tbody>
                                                ${shop ? createRow("Shop Name", shop.name) : ""}
                                                ${shop && shop.primaryDomain ? createRow("Shop Url", shop.primaryDomain.url) : ""}
                                                ${shop ? createRow("Shop Email", shop.email) : ""}
                                                ${app && app.id ? createRow("App Id", app.id.toString()) : ""}
                                                ${getFormData()}
                                            </tbody>
                                        </table>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="height:40px;">&nbsp;</td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="height:20px;">&nbsp;</td>
                    </tr>
                    <tr>
                        <td style="text-align:center;">
                            <p style="font-size:14px; color:#455056bd; line-height:18px; margin:0 0 0;">&copy; <strong>www.ajaxy.org</strong></p>
                        </td>
                    </tr>
                    <tr>
                        <td style="height:20px;">&nbsp;</td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
};

class ValidationError extends Error {}

const messageLimit = 25;

export async function action({ request }: ActionFunctionArgs) {
	let output = new Promise(async (resolve, reject) => {
		const formData = await request.formData();
		const { admin } = await authenticate.admin(request);

		const message: FormDataEntryValue | null = formData.get("message");
		if (!message || message.toString().trim() == "" || message.toString().length < messageLimit) {
			reject(new ValidationError(`Message must be at least ${messageLimit} characters long`));
			return;
		}

		if (!process.env.FEEDBACK_EMAIL_TO) {
			reject(new ValidationError("Feedback isn't set up on this server. Please open an issue at https://github.com/n-for-all/ajaxy-notion-sync/issues"));
			return;
		}

		const shop = await getShop(admin);

		const app = await getAppInstallation(admin);

		let transporter = nodemailer.createTransport({
			sendmail: true,
			newline: "unix",
			path: "/usr/sbin/sendmail",
		});

		transporter.sendMail(
			{
				from: process.env.FEEDBACK_EMAIL_FROM || process.env.FEEDBACK_EMAIL_TO,
				to: process.env.FEEDBACK_EMAIL_TO,
				subject: `Support Message ${shop?.name} (${shop?.primaryDomain.url}) (${shop?.email})`,
				html: createEmailTemplate({ title: "Support & Feedback", shop, app, formData }),
			},
			(err, info) => {
				if (!err) {
					resolve(info);
				} else {
					Sentry.captureException(err);
					reject(new ValidationError("An error occurred while sending your message. Please try again later."));
				}
			},
		);
	});

	try {
		let response = await output;
		return json({ status: "success", tone: "success", message: "Thanks for reaching out! Your message has been successfully sent to our team. They will be in touch with you if needed as soon as possible.", response });
	} catch (err: any) {
		if (err instanceof ValidationError) {
			return json({ status: "error", tone: "critical", message: err.message });
		}
		Sentry.captureException(err);
		return json({ status: "error", tone: "critical", message: "An error occurred while sending your message. Please try again later." });
	}
}
