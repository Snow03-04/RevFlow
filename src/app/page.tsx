import type { Metadata } from "next";
import { Landing } from "@/components/marketing/landing";
export const metadata: Metadata = { title: "RevFlow — Vê o que realmente lucras", description: "Vendas, custos e publicidade num só painel. Analisa a tua loja Shopify, Meta e Google Ads com o RevFlow. Planos desde 6,95 € por mês." };
export default function HomePage() { return <Landing/>; }
