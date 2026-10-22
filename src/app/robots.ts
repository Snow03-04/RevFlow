import type { MetadataRoute } from "next";
import { clientEnv } from "@/lib/env";
export default function robots(): MetadataRoute.Robots { return {rules:{userAgent:"*",allow:["/","/privacidade","/termos","/cookies","/dados-google","/contacto"],disallow:["/admin","/api/","/dashboard","/subscribe","/settings"]},sitemap:`${clientEnv.appUrl}/sitemap.xml`}; }
