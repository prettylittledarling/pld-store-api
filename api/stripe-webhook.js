import crypto from "node:crypto";
import { json } from "../lib/http.js";
import {
  createOrder,
  sendOrderToProduction
} from "../lib/printify.js";
import {
  markCheckoutSessionFulfilled,
  retrieveCheckoutSession
} from "../lib/stripe.js";

function timingSafeEqualText(a, b) {
  const left = Buffer.from(String(a || ""), "utf8");
  const right = Buffer.from(String(b || ""), "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function verifyStripeSignature(rawBody, signatureHeader, secret) {
  if (!secret) throw new Error("Stripe webhook secret is not configured.");
  if (!signatureHeader) throw new Error("Stripe-Signature header is missing.");

  const parts = String(signatureHeader)
    .split(",")
    .map((part) => part.trim());

  const timestampPart = parts.find((part) => part.startsWith("t="));
  const signatures = parts
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3));

  if (!timestampPart || !signatures.length) {
    throw new Error("Invalid Stripe signature header.");
  }

  const timestamp = Number(timestampPart.slice(2));
  if (!Number.isFinite(timestamp)) {
    throw new Error("Invalid Stripe signature timestamp.");
  }

  const toleranceSeconds = 300;
  const age = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (age > toleranceSeconds) {
    throw new Error("Stripe webhook signature is too old.");
  }

  const payload = `${timestamp}.${rawBody}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload, "utf8")
    .digest("hex");

  const valid = signatures.some((signature) =>
    timingSafeEqualText(signature, expected)
  );

  if (!valid) throw new Error("Stripe webhook signature verification failed.");
}

async function readRawBody(req) {
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length) return Buffer.concat(chunks).toString("utf8");

  if (req.body && typeof req.body === "object") {
    return JSON.stringify(req.body);
  }
  return "";
}

function parseLineItems(metadata = {}) {
  const count = Number(metadata.item_count || 0);
  if (!Number.isInteger(count) || count < 1 || count > 12) {
    throw new Error("Checkout Session is missing fulfillment line items.");
  }

  const lineItems = [];
  for (let i = 0; i < count; i += 1) {
    const productId = metadata[`item_${i}_product`];
    const variantId = Number(metadata[`item_${i}_variant`]);
    const quantity = Number(metadata[`item_${i}_quantity`]);

    if (
      !productId ||
      !Number.isInteger(variantId) ||
      !Number.isInteger(quantity) ||
      quantity < 1
    ) {
      throw new Error("Checkout Session contains invalid fulfillment metadata.");
    }

    lineItems.push({
      product_id: String(productId),
      variant_id: variantId,
      quantity
    });
  }

  return lineItems;
}

function splitName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first_name: "Customer", last_name: "" };
  if (parts.length === 1) return { first_name: parts[0], last_name: "" };
  return {
    first_name: parts[0],
    last_name: parts.slice(1).join(" ")
  };
}

function printifyAddressFromSession(session) {
  const shipping =
    session?.collected_information?.shipping_details ||
    session?.shipping_details ||
    null;

  const address = shipping?.address;
  if (!shipping || !address) {
    throw new Error("Paid Checkout Session has no shipping address.");
  }

  const name = splitName(shipping.name || session?.customer_details?.name);
  const email =
    session?.customer_details?.email ||
    session?.customer_email ||
    "";
  const phone =
    shipping.phone ||
    session?.customer_details?.phone ||
    "";

  return {
    ...name,
    email,
    phone,
    country: address.country || "US",
    region: address.state || "",
    address1: address.line1 || "",
    address2: address.line2 || "",
    city: address.city || "",
    zip: address.postal_code || ""
  };
}

async function fulfill(sessionId) {
  const session = await retrieveCheckoutSession(sessionId);

  if (
    session.payment_status !== "paid" &&
    session.payment_status !== "no_payment_required"
  ) {
    return { skipped: true, reason: "not_paid" };
  }

  if (session.metadata?.printify_order_id) {
    return {
      skipped: true,
      reason: "already_fulfilled",
      order_id: session.metadata.printify_order_id
    };
  }

  if (session.metadata?.fulfillment !== "printify") {
    return { skipped: true, reason: "not_printify" };
  }

  const lineItems = parseLineItems(session.metadata);
  const addressTo = printifyAddressFromSession(session);

  const order = await createOrder({
    external_id: session.id,
    label: `PLD ${session.id}`,
    line_items: lineItems,
    shipping_method: 1,
    send_shipping_notification: true,
    address_to: addressTo
  });

  let productionStatus = "created";
  if (process.env.PRINTIFY_AUTO_PRODUCTION !== "false") {
    await sendOrderToProduction(order.id);
    productionStatus = "sent_to_production";
  }

  await markCheckoutSessionFulfilled(
    session.id,
    order.id,
    productionStatus
  );

  return {
    skipped: false,
    order_id: order.id,
    production_status: productionStatus
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, { error: "Method not allowed" });
  }

  try {
    const rawBody = await readRawBody(req);
    verifyStripeSignature(
      rawBody,
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET
    );

    const event = JSON.parse(rawBody);

    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      const sessionId = event?.data?.object?.id;
      if (!sessionId) throw new Error("Webhook is missing Checkout Session ID.");

      const result = await fulfill(sessionId);
      console.log("Stripe fulfillment result", {
        event_id: event.id,
        session_id: sessionId,
        ...result
      });
    }

    return json(res, 200, { received: true });
  } catch (error) {
    console.error("Stripe webhook error", error?.payload || error);
    return json(res, 400, {
      error: error.message || "Webhook processing failed."
    });
  }
}
