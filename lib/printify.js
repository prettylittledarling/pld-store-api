const PRINTIFY_BASE = "https://api.printify.com/v1";

export function getPrintifyShopId() {
  return String(
    process.env.PRINTIFY_SHOP_ID ||
    process.env.PRINTIFY_STORE_ID ||
    "28877859"
  );
}

function getPrintifyToken() {
  const token =
    process.env.PRINTIFY_API_TOKEN ||
    process.env.PRINTIFY_TOKEN ||
    process.env.PRINTIFY_ACCESS_TOKEN;

  if (!token) {
    throw new Error("Printify API token is not configured.");
  }
  return token;
}

async function printifyRequest(path, options = {}) {
  const response = await fetch(`${PRINTIFY_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${getPrintifyToken()}`,
      "Content-Type": "application/json;charset=utf-8",
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
      payload?.message ||
      payload?.error ||
      `Printify request failed with status ${response.status}`
    );
    err.status = response.status;
    err.payload = payload;
    throw err;
  }

  return payload;
}

export function listShops() {
  return printifyRequest("/shops.json");
}

export function listProducts() {
  const shopId = getPrintifyShopId();
  return printifyRequest(`/shops/${shopId}/products.json?limit=100`);
}

export function createOrder(order) {
  const shopId = getPrintifyShopId();
  return printifyRequest(`/shops/${shopId}/orders.json`, {
    method: "POST",
    body: JSON.stringify(order)
  });
}

export function sendOrderToProduction(orderId) {
  const shopId = getPrintifyShopId();
  return printifyRequest(
    `/shops/${shopId}/orders/${encodeURIComponent(orderId)}/send_to_production.json`,
    { method: "POST", body: "{}" }
  );
}
