import type { MetadataRoute } from "next";
import { clientEnv } from "@/lib/env";
export default function sitemap():MetadataRoute.Sitemap { return ["/","/privacidade","/termos","/cookies","/dados-google","/contacto"].map(path=>({url:`${clientEnv.appUrl}${path}`})); }
