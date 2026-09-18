const STRIPE_BASE = "https://api.stripe.com/v1";

function getStripeSecret() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("Stripe secret key is not configured.");
  }
  return key;
}

async function stripeRequest(path, options = {}) {
  const response = await fetch(`${STRIPE_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${getStripeSecret()}`,
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const err = new Error(
      payload?.error?.message ||
      `Stripe request failed with status ${response.status}`
    );
    err.status = response.status;
    err.payload = payload;
    throw err;
  }

  return payload;
}

export function stripeGet(path) {
  return stripeRequest(path, { method: "GET" });
}

export function stripePost(path, params) {
  const body = params instanceof URLSearchParams
    ? params
    : new URLSearchParams(params || {});

  return stripeRequest(path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
}

export function retrieveCheckoutSession(sessionId) {
  return stripeGet(`/checkout/sessions/${encodeURIComponent(sessionId)}`);
}

export function markCheckoutSessionFulfilled(sessionId, orderId, productionStatus) {
  const params = new URLSearchParams();
  params.set("metadata[printify_order_id]", String(orderId));
  params.set("metadata[printify_status]", String(productionStatus || "created"));
  return stripePost(
    `/checkout/sessions/${encodeURIComponent(sessionId)}`,
    params
  );
}
