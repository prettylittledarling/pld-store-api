import { json, parseBody, setCors } from "../lib/http.js";
import { listProducts } from "../lib/printify.js";
import { stripePost } from "../lib/stripe.js";
import stockCatalog from "../data/inventory.json" with {type:"json"};
import {verifyReservation} from "../lib/stock-reservation.js";

const MAX_CART_LINES = 12;
const DEFAULT_SITE_URL = "https://pld-store-api.vercel.app";
const FLAT_US_SHIPPING_CENTS = 599;
const DISPLAY_NAMES = {
  "6aad359ef04cab633704997c": "Darling Tee",
  "6aad7df9258e597d3c096968": "Cherub Kindle Case",
  "6aa1cd65e1edeec9d80b6a7d": "Darling Sweatpants",
  "6aa1cceb2e99cde0f10a768f": "Reading Cherub Tote",
  "6aa19491a0b408082b0084ae": "Feral Tee"
};

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

    const stockItems = requestedItems.filter(item => item.sku);
    const reservation = stockItems.length ? verifyReservation(body.reservationToken, requestedItems) : null;
    const response = requestedItems.some(item => !item.sku) ? await listProducts() : {data:[]};
    const products = Array.isArray(response?.data) ? response.data : [];
    const productMap = new Map(products.map((product) => [String(product.id), product]));

    const validated = [];
    for (const item of requestedItems) {
      if (item.sku) {
        const product=stockCatalog.find(product => product.sku===item.sku);
        const reserved=reservation.items.find(line => line.sku===item.sku);
        const quantity=positiveInteger(item.quantity);
        if (!product || !quantity || quantity>product.quantity || quantity!==reserved?.quantity) return json(res,400,{error:"An inventory item is unavailable."});
        validated.push({sku:product.sku,quantity,unit_amount:product.price,product_title:product.name,variant_title:"",image:null});
        continue;
      }
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
        product_title: DISPLAY_NAMES[productId] || product.title,
        variant_title: variant.title || "Standard",
        image:
          product.images?.find((image) => image.is_default)?.src ||
          product.images?.[0]?.src ||
          null
      });
    }

    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set("shipping_address_collection[allowed_countries][0]", "US");
    params.set("phone_number_collection[enabled]", "true");
    params.set("allow_promotion_codes", "true");
    params.set("integration_identifier","pretty_little_darling_qmptxrsa");
    if (reservation) {
      params.set("expires_at",String(reservation.expiresAt));
      params.set("metadata[stock_reservation]",reservation.id);
    }

    const requestHost = req.headers.host ? `https://${req.headers.host}` : DEFAULT_SITE_URL;
    const siteUrl = normalizeSiteUrl(process.env.PLD_CHECKOUT_SITE_URL || requestHost);
    params.set(
      "success_url",
      body.storefront === "main" ? "https://prettylittledarling.com/order-success?session_id={CHECKOUT_SESSION_ID}" : `${siteUrl}/order-success.html?session_id={CHECKOUT_SESSION_ID}`
    );
    params.set("cancel_url", body.storefront === "main" ? "https://prettylittledarling.com/cart" : `${siteUrl}/`);

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
        item.variant_title ? `${item.product_title}: ${item.variant_title}` : item.product_title
      );
      if (item.image) {
        params.set(
          `${prefix}[price_data][product_data][images][0]`,
          item.image
        );
      }

    });
    const podItems=validated.filter(item=>item.product_id);
    podItems.forEach((item,index)=>{
      params.set(`metadata[item_${index}_product]`,item.product_id);
      params.set(`metadata[item_${index}_variant]`,String(item.variant_id));
      params.set(`metadata[item_${index}_quantity]`,String(item.quantity));
    });

    const shippingIndex = validated.length;
    params.set(`line_items[${shippingIndex}][quantity]`, "1");
    params.set(`line_items[${shippingIndex}][price_data][currency]`, "usd");
    params.set(
      `line_items[${shippingIndex}][price_data][unit_amount]`,
      String(FLAT_US_SHIPPING_CENTS)
    );
    params.set(
      `line_items[${shippingIndex}][price_data][product_data][name]`,
      "Flat U.S. Shipping"
    );

    params.set("metadata[item_count]", String(podItems.length));
    params.set("metadata[source]", "prettylittledarling.com");
    params.set("metadata[fulfillment]", podItems.length ? "printify" : "merchant");

    const session = await stripePost("/checkout/sessions", params, reservation ? {"Idempotency-Key":`pld-stock-${reservation.id}`} : {});

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
