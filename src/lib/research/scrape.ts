import "server-only";

export interface ProductMeta {
  image: string | null;
  title: string | null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#0?38;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'");
}

/**
 * Fetch a product page and pull its main photo + title from the Open Graph /
 * standard meta tags (works for Shopify, Amazon, AliExpress, WooCommerce, …).
 * Best-effort: returns nulls on any failure.
 */
export async function fetchProductMeta(url: string): Promise<ProductMeta> {
  try {
    const target = url.startsWith("http") ? url : `https://${url}`;
    const res = await fetch(target, {
      cache: "no-store",
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; RevFlowBot/1.0; +https://revflowapp.netlify.app)",
        accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return { image: null, title: null };
    const html = (await res.text()).slice(0, 600_000);

    const meta = (prop: string): string | null => {
      const a = html.match(
        new RegExp(
          `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`,
          "i",
        ),
      );
      if (a) return a[1];
      const b = html.match(
        new RegExp(
          `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`,
          "i",
        ),
      );
      return b ? b[1] : null;
    };

    let image =
      meta("og:image:secure_url") ??
      meta("og:image") ??
      meta("og:image:url") ??
      meta("twitter:image") ??
      meta("twitter:image:src");
    if (!image) {
      const link = html.match(
        /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i,
      );
      image = link?.[1] ?? null;
    }
    if (image) {
      image = decodeEntities(image.trim());
      if (image.startsWith("//")) image = "https:" + image;
      else if (image.startsWith("/")) {
        try {
          image = new URL(image, target).href;
        } catch {
          /* keep as-is */
        }
      }
    }

    let title = meta("og:title") ?? meta("twitter:title");
    if (!title) {
      // JSON-LD Product name (common on Shopify/Woo/AliExpress).
      const ld = html.match(/"name"\s*:\s*"([^"]{3,140})"/i);
      title = ld?.[1] ?? null;
    }
    if (!title) {
      const h = html.match(/<h1[^>]*>\s*([^<]{3,140})\s*<\/h1>/i);
      title = h?.[1]?.trim() ?? null;
    }
    if (!title) {
      const t = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      title = t?.[1]?.trim() ?? null;
    }
    if (title) title = decodeEntities(title).replace(/\s+/g, " ").trim().slice(0, 140);

    return { image: image || null, title: title || null };
  } catch {
    return { image: null, title: null };
  }
}
