import { json, setCors } from "../lib/http.js";
import { listShops } from "../lib/printify.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });

  try {
    const shops = await listShops();
    return json(res, 200, { shops });
  } catch (error) {
    console.error("Printify shops error", error?.payload || error);
    return json(res, error.status || 500, { error: error.message });
  }
}
