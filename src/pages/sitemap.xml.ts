import type { APIRoute } from "astro";

export const prerender = true;

const BASE_URL = "https://averionai.es";

const routes = [
  { path: "", priority: "1.0", changefreq: "weekly" },
  { path: "pricing", priority: "0.9", changefreq: "weekly" },
  { path: "login", priority: "0.3", changefreq: "monthly" },
  { path: "register", priority: "0.8", changefreq: "monthly" },
  { path: "upgrade", priority: "0.7", changefreq: "monthly" },
  { path: "landing/automatizacion", priority: "0.8", changefreq: "monthly" },
  { path: "blog", priority: "0.8", changefreq: "weekly" },
  { path: "status", priority: "0.3", changefreq: "daily" },
  { path: "launch", priority: "0.5", changefreq: "monthly" },
  { path: "changelog", priority: "0.5", changefreq: "weekly" },
  { path: "referrals", priority: "0.4", changefreq: "monthly" },
  { path: "legal/privacy-policy", priority: "0.4", changefreq: "yearly" },
  { path: "legal/terms", priority: "0.4", changefreq: "yearly" },
  { path: "legal/cookies", priority: "0.4", changefreq: "yearly" },
  { path: "legal/legal-notice", priority: "0.4", changefreq: "yearly" },
];

export const GET: APIRoute = async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${routes
  .map(
    (r) => `  <url>
    <loc>${BASE_URL}/${r.path}</loc>
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority}</priority>
  </url>`
  )
  .join("\n")}
</urlset>`;

  return new Response(xml, {
    status: 200,
    headers: { "Content-Type": "application/xml" },
  });
};
