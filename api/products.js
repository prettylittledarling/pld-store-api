import { json, setCors } from "../lib/http.js";
import { getPrintifyShopId, listProducts } from "../lib/printify.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });

  try {
    const response = await listProducts();
    const rawProducts = Array.isArray(response?.data)
      ? response.data
      : Array.isArray(response)
        ? response
        : [];

    const products = rawProducts.map((product) => {
      const enabledVariants = (product.variants || []).filter(
        (variant) => variant.is_enabled !== false
      );

      const variants = enabledVariants.map((variant) => ({
        id: variant.id,
        title: variant.title,
        sku: variant.sku || null,
        price: variant.price,
        cost: variant.cost ?? null,
        is_available: variant.is_available !== false
      }));

      const image =
        product.images?.find((img) => img.is_default)?.src ||
        product.images?.[0]?.src ||
        null;

      return {
        id: product.id,
        title: product.title,
        description: product.description || "",
        visible: product.visible !== false,
        blueprint_id: product.blueprint_id,
        print_provider_id: product.print_provider_id,
        variants,
        image
      };
    });

    return json(res, 200, {
      shop_id: getPrintifyShopId(),
      count: products.length,
      current_page: response?.current_page || 1,
      last_page: response?.last_page || 1,
      total: response?.total || products.length,
      products
    });
  } catch (error) {
    console.error("Printify products error", error?.payload || error);
    return json(res, error.status || 500, { error: error.message });
  }
}
