import { json, parseBody, setCors } from "../lib/http.js";
import { listProducts } from "../lib/printify.js";
import { stripePost } from "../lib/stripe.js";

const MAX_CART_LINES = 12;
const DEFAULT_SITE_URL = "https://prettylittledarling.com";
const FLAT_US_SHIPPING_CENTS = 599;

function normalizeSiteUrl(value) {
  return String(value || DEFAULT_SITE_URL).replace(/\/$/, "");
}

function positiveInteger(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  try {
    const body = parseBody(req);
    const requestedItems = Array.isArray(body.items) ? body.items : [];

    if (!requestedItems.length) {
      return json(res, 400, { error: "Your cart is empty." });
    }
    if (requestedItems.length > MAX_CART_LINES) {
      return json(res, 400, { error: "Too many different items in one order." });
    }

    const response = await listProducts();
    const products = Array.isArray(response?.data) ? response.data : [];
    const productMap = new Map(products.map((product) => [String(product.id), product]));

    const validated = [];
    for (const item of requestedItems) {
      const productId = String(item.product_id || item.productId || "");
      const variantId = positiveInteger(item.variant_id || item.variantId);
      const quantity = positiveInteger(item.quantity);

      if (!productId || !variantId || !quantity || quantity > 20) {
        return json(res, 400, { error: "One or more cart items are invalid." });
      }

      const product = productMap.get(productId);
      if (!product || product.visible === false) {
        return json(res, 400, { error: "One of the selected products is unavailable." });
      }

      const variant = (product.variants || []).find(
        (candidate) => Number(candidate.id) === variantId && candidate.is_enabled !== false
      );

      if (!variant || variant.is_available === false) {
        return json(res, 400, {
          error: `${product.title}: that option is currently unavailable.`
        });
      }

      const unitAmount = Number(variant.price);
      if (!Number.isInteger(unitAmount) || unitAmount <= 0) {
        throw new Error("Printify returned an invalid product price.");
      }

      validated.push({
        product_id: productId,
        variant_id: variantId,
        quantity,
        unit_amount: unitAmount,
        product_title: product.title,
        variant_title: variant.title || "Standard",
        image:
          product.images?.find((image) => image.is_default)?.src ||
          product.images?.[0]?.src ||
          null
      });
    }

    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set("customer_creation", "always");
    params.set("shipping_address_collection[allowed_countries][0]", "US");
    params.set("phone_number_collection[enabled]", "true");
    params.set("allow_promotion_codes", "true");

    const siteUrl = normalizeSiteUrl(process.env.PLD_SITE_URL);
    params.set(
      "success_url",
      `${siteUrl}/order-success?session_id={CHECKOUT_SESSION_ID}`
    );
    params.set("cancel_url", `${siteUrl}/shop`);

    params.set("shipping_options[0][shipping_rate_data][type]", "fixed_amount");
    params.set(
      "shipping_options[0][shipping_rate_data][fixed_amount][amount]",
      String(FLAT_US_SHIPPING_CENTS)
    );
    params.set(
      "shipping_options[0][shipping_rate_data][fixed_amount][currency]",
      "usd"
    );
    params.set(
      "shipping_options[0][shipping_rate_data][display_name]",
      "Standard U.S. Shipping"
    );

    validated.forEach((item, index) => {
      const prefix = `line_items[${index}]`;
      params.set(`${prefix}[quantity]`, String(item.quantity));
      params.set(`${prefix}[price_data][currency]`, "usd");
      params.set(
        `${prefix}[price_data][unit_amount]`,
        String(item.unit_amount)
      );
      params.set(
        `${prefix}[price_data][product_data][name]`,
        `${item.product_title} — ${item.variant_title}`
      );
      if (item.image) {
        params.set(
          `${prefix}[price_data][product_data][images][0]`,
          item.image
        );
      }

      params.set(`metadata[item_${index}_product]`, item.product_id);
      params.set(`metadata[item_${index}_variant]`, String(item.variant_id));
      params.set(`metadata[item_${index}_quantity]`, String(item.quantity));
    });

    params.set("metadata[item_count]", String(validated.length));
    params.set("metadata[source]", "prettylittledarling.com");
    params.set("metadata[fulfillment]", "printify");

    const session = await stripePost("/checkout/sessions", params);

    return json(res, 200, {
      id: session.id,
      url: session.url
    });
  } catch (error) {
    console.error("Checkout error", error?.payload || error);
    return json(res, error.status || 500, {
      error: error.message || "Unable to start checkout."
    });
  }
}
