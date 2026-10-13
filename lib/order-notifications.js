import { stripeGet } from "./stripe.js";

const ORDER_EMAIL_TO = "hellosundaydarling@gmail.com";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

function money(cents, currency = "usd") {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: String(currency).toUpperCase()
  }).format(Number(cents || 0) / 100);
}

export async function sendOrderNotification(session) {
  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
    return { skipped: true, reason: "not_paid" };
  }

  // Until a verified sender and API key are configured, never interrupt fulfillment.
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ORDER_EMAIL_FROM;
  if (!apiKey || !from) {
    console.warn("Order email not configured", {
      session_id: session.id,
      missing_resend_key: !apiKey,
      missing_sender: !from
    });
    return { skipped: true, reason: "email_not_configured" };
  }

  const customer = session.customer_details || {};
  const shipping = session.collected_information?.shipping_details || session.shipping_details || {};
  const addr = shipping.address || customer.address || {};
  const items = await stripeGet(`/checkout/sessions/${encodeURIComponent(session.id)}/line_items?limit=100`);
  const lines = (items.data || []).map((item) => {
    return `<li>${escapeHtml(item.description || "Item")} × ${Number(item.quantity || 1)} — ${escapeHtml(money(item.amount_total, item.currency || session.currency))}</li>`;
  }).join("");
  const address = [shipping.name || customer.name, addr.line1, addr.line2,
    [addr.city, addr.state, addr.postal_code].filter(Boolean).join(", "), addr.country]
    .filter(Boolean).map(escapeHtml).join("<br>");

  const orderType = session.metadata?.edition === "signed" ? "Signed book order" : "New store order";
  const html = `<h2>${escapeHtml(orderType)} received</h2>
    <p><strong>Amount paid:</strong> ${escapeHtml(money(session.amount_total, session.currency))}</p>
    <p><strong>Customer:</strong> ${escapeHtml(customer.name || shipping.name || "Not provided")}<br>
    <strong>Email:</strong> ${escapeHtml(customer.email || session.customer_email || "Not provided")}<br>
    <strong>Phone:</strong> ${escapeHtml(customer.phone || "Not provided")}</p>
    <p><strong>Items:</strong></p><ul>${lines}</ul>
    <p><strong>Ship to:</strong><br>${address || "See Stripe checkout for details"}</p>
    <p><strong>Stripe checkout:</strong> ${escapeHtml(session.id)}</p>
    <p>View this payment in your Stripe dashboard.</p>`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `pld-order-${session.id}`
    },
    body: JSON.stringify({
      from,
      to: [ORDER_EMAIL_TO],
      subject: `Pretty Little Darling: ${orderType} — ${money(session.amount_total, session.currency)}`,
      html
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Order notification failed (HTTP ${response.status}): ${detail.slice(0, 350)}`);
  }
  return { sent: true };
}
