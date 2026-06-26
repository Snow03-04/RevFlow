"use client";

import { useState } from "react";
import { Loader2, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Collects the shop domain then sends the merchant through Shopify OAuth. */
export function ConnectShopify() {
  const [shop, setShop] = useState("");
  const [loading, setLoading] = useState(false);

  function connect(e: React.FormEvent) {
    e.preventDefault();
    if (!shop.trim()) return;
    setLoading(true);
    // Full navigation: the API route redirects to Shopify's OAuth screen.
    window.location.href = `/api/shopify/connect?shop=${encodeURIComponent(
      shop.trim(),
    )}`;
  }

  return (
    <form onSubmit={connect} className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="shop">Store domain</Label>
        <Input
          id="shop"
          value={shop}
          onChange={(e) => setShop(e.target.value)}
          placeholder="your-store.myshopify.com"
          autoComplete="off"
        />
      </div>
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Store className="h-4 w-4" />
        )}
        Connect Shopify
      </Button>
    </form>
  );
}
