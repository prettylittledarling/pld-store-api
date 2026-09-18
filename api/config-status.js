import { json, setCors } from "../lib/http.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });

  return json(res, 200, {
    stripe_secret_configured: Boolean(process.env.STRIPE_SECRET_KEY),
    stripe_webhook_secret_configured: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    printify_token_configured: Boolean(
      process.env.PRINTIFY_API_TOKEN ||
      process.env.PRINTIFY_TOKEN ||
      process.env.PRINTIFY_ACCESS_TOKEN
    ),
    printify_shop_id_configured: Boolean(
      process.env.PRINTIFY_SHOP_ID ||
      process.env.PRINTIFY_STORE_ID
    ),
    site_url: process.env.PLD_SITE_URL || "https://prettylittledarling.com"
  });
}
