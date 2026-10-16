import crypto from "crypto";

const ALGORITHM = "aes-256-cbc";
const SALT = "ajaxy-notion-sync-salt";
// Ensure we always have exactly 32 bytes for the key
const ENCRYPTION_KEY = crypto.scryptSync(
	process.env.SHOPIFY_API_SECRET || "default_secret",
	SALT,
	32
);

export function encrypt(text: string): string {
	const iv = crypto.randomBytes(16);
	const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
	let encrypted = cipher.update(text, "utf8", "hex");
	encrypted += cipher.final("hex");
	return `${iv.toString("hex")}:${encrypted}`;
}

export function decrypt(text: string): string {
	const textParts = text.split(":");
	const ivHex = textParts.shift();
	if (!ivHex) {
		throw new Error("Invalid encrypted text format");
	}
	const iv = Buffer.from(ivHex, "hex");
	const encryptedText = Buffer.from(textParts.join(":"), "hex");
	const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
	let decrypted = decipher.update(encryptedText, undefined, "utf8");
	decrypted += decipher.final("utf8");
	return decrypted;
}
