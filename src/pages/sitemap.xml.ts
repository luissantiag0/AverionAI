import type { APIRoute } from "astro";

export const prerender = true;

const BASE_URL = "https://averionai.es";

const routes = [
  { path: "", priority: "1.0", changefreq: "weekly", lastmod: new Date().toISOString().split("T")[0] },
  { path: "pricing", priority: "0.9", changefreq: "weekly", lastmod: "2026-05-20" },
  { path: "login", priority: "0.3", changefreq: "monthly", lastmod: "2026-05-20" },
  { path: "register", priority: "0.8", changefreq: "monthly", lastmod: "2026-05-20" },
  { path: "upgrade", priority: "0.7", changefreq: "monthly", lastmod: "2026-05-20" },
  { path: "landing/automatizacion", priority: "0.8", changefreq: "monthly", lastmod: "2026-05-20" },
  { path: "blog", priority: "0.8", changefreq: "weekly", lastmod: "2026-05-20" },
  { path: "status", priority: "0.3", changefreq: "daily", lastmod: "2026-05-20" },
  { path: "launch", priority: "0.5", changefreq: "monthly", lastmod: "2026-05-20" },
  { path: "changelog", priority: "0.5", changefreq: "weekly", lastmod: "2026-05-20" },
  { path: "referrals", priority: "0.4", changefreq: "monthly", lastmod: "2026-05-20" },
  { path: "aprende/como-automatizar-ventas-con-ia", priority: "0.7", changefreq: "monthly", lastmod: "2026-05-20" },
  { path: "aprende/que-es-crm-automatizacion-inteligente", priority: "0.7", changefreq: "monthly", lastmod: "2026-05-20" },
  { path: "aprende/ejemplo-real-sistema-ia-empresas", priority: "0.7", changefreq: "monthly", lastmod: "2026-05-20" },
  { path: "precio-automatizacion-ia-empresas", priority: "0.8", changefreq: "monthly", lastmod: "2026-05-20" },
  { path: "cuanto-cuesta-crm-ia", priority: "0.8", changefreq: "monthly", lastmod: "2026-05-20" },
  { path: "automatizacion-ventas-roi-empresas", priority: "0.8", changefreq: "monthly", lastmod: "2026-05-20" },
  { path: "automatizacion-ia-empresas", priority: "0.9", changefreq: "monthly", lastmod: "2026-05-20" },
  { path: "crm-ia-empresas", priority: "0.9", changefreq: "monthly", lastmod: "2026-05-20" },
  { path: "ia-para-empresas", priority: "0.9", changefreq: "monthly", lastmod: "2026-05-20" },
  { path: "automatizacion-procesos-empresa", priority: "0.8", changefreq: "monthly", lastmod: "2026-05-20" },
  { path: "forgot-password", priority: "0.3", changefreq: "monthly", lastmod: "2026-05-20" },
  { path: "reset-password", priority: "0.3", changefreq: "monthly", lastmod: "2026-05-20" },
  { path: "legal/privacy-policy", priority: "0.4", changefreq: "yearly", lastmod: "2026-05-01" },
  { path: "legal/terms", priority: "0.4", changefreq: "yearly", lastmod: "2026-05-01" },
  { path: "legal/cookies", priority: "0.4", changefreq: "yearly", lastmod: "2026-05-01" },
  { path: "legal/legal-notice", priority: "0.4", changefreq: "yearly", lastmod: "2026-05-01" },
];

const blogPosts = [
  { slug: "automatizacion-con-ia", date: "2026-05-01" },
  { slug: "crm-inteligente", date: "2026-04-15" },
  { slug: "ia-para-pymes", date: "2026-04-01" },
  { slug: "automatizacion-ventas-con-ia", date: "2026-05-10" },
  { slug: "crm-ia-pymes", date: "2026-05-05" },
  { slug: "sistemas-automatizacion-inteligencia-artificial", date: "2026-04-20" },
  { slug: "automatizacion-procesos-empresa-ia", date: "2026-05-15" },
  { slug: "ia-ventas-automatizadas-espana", date: "2026-05-12" },
  { slug: "software-crm-ia-automatizacion", date: "2026-05-08" },
];

export const GET: APIRoute = async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${routes
  .map(
    (r) => `  <url>
    <loc>${BASE_URL}/${r.path}</loc>
    <lastmod>${r.lastmod}</lastmod>
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority}</priority>
  </url>`
  )
  .join("\n")}
${blogPosts
  .map(
    (p) => `  <url>
    <loc>${BASE_URL}/blog/posts/${p.slug}</loc>
    <lastmod>${p.date}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`
  )
  .join("\n")}
</urlset>`;

  return new Response(xml, {
    status: 200,
    headers: { "Content-Type": "application/xml" },
  });
};
