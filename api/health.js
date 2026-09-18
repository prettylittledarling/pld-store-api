import { json, setCors } from "../lib/http.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });

  return json(res, 200, {
    ok: true,
    service: "pld-store-api",
    message: "Pretty Little Darling backend is online"
  });
}
