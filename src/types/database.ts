/**
 * Hand-maintained Supabase schema types.
 *
 * Mirrors supabase/migrations/*.sql. If you change a migration, update this
 * file too (or regenerate with `supabase gen types typescript`).
 */

type Timestamp = string;

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string | null;
          full_name: string | null;
          avatar_url: string | null;
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: {
          id: string;
          email?: string | null;
          full_name?: string | null;
          avatar_url?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
      settings: {
        Row: {
          user_id: string;
          currency: string;
          default_product_cost_pct: number;
          default_shipping_cost: number;
          payment_fee_pct: number;
          payment_fee_fixed: number;
          timezone: string;
          fx_rate: number;
          fx_rate_override: number | null;
          gemini_api_key_encrypted: string | null;
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: {
          user_id: string;
          currency?: string;
          default_product_cost_pct?: number;
          default_shipping_cost?: number;
          payment_fee_pct?: number;
          payment_fee_fixed?: number;
          timezone?: string;
          fx_rate?: number;
          fx_rate_override?: number | null;
          gemini_api_key_encrypted?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["settings"]["Insert"]>;
        Relationships: [];
      };
      shopify_connections: {
        Row: {
          id: string;
          user_id: string;
          shop_domain: string;
          access_token: string;
          scope: string | null;
          status: string;
          webhook_ids: unknown;
          connected_at: Timestamp;
          last_synced_at: Timestamp | null;
          last_sync_error: string | null;
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: {
          user_id: string;
          shop_domain: string;
          access_token: string;
          scope?: string | null;
          status?: string;
          webhook_ids?: unknown;
          last_synced_at?: Timestamp | null;
          last_sync_error?: string | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["shopify_connections"]["Insert"]
        >;
        Relationships: [];
      };
      meta_connections: {
        Row: {
          id: string;
          user_id: string;
          access_token: string;
          ad_account_id: string;
          ad_account_name: string | null;
          business_id: string | null;
          account_currency: string | null;
          token_expires_at: Timestamp | null;
          status: string;
          connected_at: Timestamp;
          last_synced_at: Timestamp | null;
          last_sync_error: string | null;
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: {
          user_id: string;
          access_token: string;
          ad_account_id: string;
          ad_account_name?: string | null;
          business_id?: string | null;
          account_currency?: string | null;
          token_expires_at?: Timestamp | null;
          status?: string;
          last_synced_at?: Timestamp | null;
          last_sync_error?: string | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["meta_connections"]["Insert"]
        >;
        Relationships: [];
      };
      products: {
        Row: {
          id: string;
          user_id: string;
          shopify_product_id: string;
          shopify_variant_id: string;
          title: string | null;
          variant_title: string | null;
          sku: string | null;
          price: number;
          cost: number | null;
          cost_source: string;
          image_url: string | null;
          currency: string | null;
          handle: string | null;
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: {
          user_id: string;
          shopify_product_id: string;
          shopify_variant_id: string;
          title?: string | null;
          variant_title?: string | null;
          sku?: string | null;
          price?: number;
          cost?: number | null;
          cost_source?: string;
          image_url?: string | null;
          currency?: string | null;
          handle?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["products"]["Insert"]>;
        Relationships: [];
      };
      orders: {
        Row: {
          id: string;
          user_id: string;
          shopify_order_id: string;
          order_number: string | null;
          processed_at: Timestamp;
          currency: string | null;
          financial_status: string | null;
          fulfillment_status: string | null;
          subtotal_price: number;
          total_price: number;
          total_discounts: number;
          total_tax: number;
          total_shipping: number;
          total_refunded: number;
          customer_id: string | null;
          customer_email: string | null;
          country: string | null;
          cancelled_at: Timestamp | null;
          test: boolean;
          landing_site: string | null;
          referring_site: string | null;
          source_name: string | null;
          raw: unknown;
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: {
          user_id: string;
          shopify_order_id: string;
          order_number?: string | null;
          processed_at: Timestamp;
          currency?: string | null;
          financial_status?: string | null;
          fulfillment_status?: string | null;
          subtotal_price?: number;
          total_price?: number;
          total_discounts?: number;
          total_tax?: number;
          total_shipping?: number;
          total_refunded?: number;
          customer_id?: string | null;
          customer_email?: string | null;
          country?: string | null;
          cancelled_at?: Timestamp | null;
          test?: boolean;
          landing_site?: string | null;
          referring_site?: string | null;
          source_name?: string | null;
          raw?: unknown;
        };
        Update: Partial<Database["public"]["Tables"]["orders"]["Insert"]>;
        Relationships: [];
      };
      order_line_items: {
        Row: {
          id: string;
          user_id: string;
          order_id: string;
          shopify_line_item_id: string;
          shopify_product_id: string | null;
          shopify_variant_id: string | null;
          title: string | null;
          sku: string | null;
          quantity: number;
          price: number;
          total_discount: number;
          unit_cost: number | null;
          created_at: Timestamp;
        };
        Insert: {
          user_id: string;
          order_id: string;
          shopify_line_item_id: string;
          shopify_product_id?: string | null;
          shopify_variant_id?: string | null;
          title?: string | null;
          sku?: string | null;
          quantity?: number;
          price?: number;
          total_discount?: number;
          unit_cost?: number | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["order_line_items"]["Insert"]
        >;
        Relationships: [];
      };
      campaigns: {
        Row: {
          id: string;
          user_id: string;
          meta_connection_id: string | null;
          campaign_id: string;
          campaign_name: string | null;
          status: string | null;
          date: string;
          spend: number;
          impressions: number;
          clicks: number;
          reach: number;
          cpm: number;
          cpc: number;
          ctr: number;
          purchases: number;
          purchase_value: number;
          atc: number;
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: {
          user_id: string;
          meta_connection_id?: string | null;
          campaign_id: string;
          campaign_name?: string | null;
          status?: string | null;
          date: string;
          spend?: number;
          impressions?: number;
          clicks?: number;
          reach?: number;
          cpm?: number;
          cpc?: number;
          ctr?: number;
          purchases?: number;
          purchase_value?: number;
          atc?: number;
        };
        Update: Partial<Database["public"]["Tables"]["campaigns"]["Insert"]>;
        Relationships: [];
      };
      google_connections: {
        Row: {
          id: string;
          user_id: string;
          access_token: string;
          customer_id: string;
          customer_name: string | null;
          account_currency: string | null;
          login_customer_id: string | null;
          token_expires_at: Timestamp | null;
          status: string;
          connected_at: Timestamp;
          last_synced_at: Timestamp | null;
          last_sync_error: string | null;
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: {
          user_id: string;
          access_token: string;
          customer_id: string;
          customer_name?: string | null;
          account_currency?: string | null;
          login_customer_id?: string | null;
          token_expires_at?: Timestamp | null;
          status?: string;
          last_synced_at?: Timestamp | null;
          last_sync_error?: string | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["google_connections"]["Insert"]
        >;
        Relationships: [];
      };
      google_campaigns: {
        Row: {
          id: string;
          user_id: string;
          google_connection_id: string | null;
          campaign_id: string;
          campaign_name: string | null;
          status: string | null;
          date: string;
          spend: number;
          impressions: number;
          clicks: number;
          reach: number;
          cpm: number;
          cpc: number;
          ctr: number;
          purchases: number;
          purchase_value: number;
          atc: number;
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: {
          user_id: string;
          google_connection_id?: string | null;
          campaign_id: string;
          campaign_name?: string | null;
          status?: string | null;
          date: string;
          spend?: number;
          impressions?: number;
          clicks?: number;
          reach?: number;
          cpm?: number;
          cpc?: number;
          ctr?: number;
          purchases?: number;
          purchase_value?: number;
          atc?: number;
        };
        Update: Partial<
          Database["public"]["Tables"]["google_campaigns"]["Insert"]
        >;
        Relationships: [];
      };
      daily_metrics: {
        Row: {
          id: string;
          user_id: string;
          date: string;
          gross_revenue: number;
          refunds: number;
          discounts: number;
          shipping_revenue: number;
          revenue: number;
          product_cost: number;
          shipping_cost: number;
          payment_fees: number;
          ad_spend: number;
          ad_spend_meta: number;
          ad_spend_google: number;
          profit: number;
          profit_margin: number;
          roas: number;
          mer: number;
          cac: number;
          orders_count: number;
          units_sold: number;
          ad_clicks: number;
          aov: number;
          conversion_rate: number;
          manual_adjustment: number;
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: {
          user_id: string;
          date: string;
          gross_revenue?: number;
          refunds?: number;
          discounts?: number;
          shipping_revenue?: number;
          revenue?: number;
          product_cost?: number;
          shipping_cost?: number;
          payment_fees?: number;
          ad_spend?: number;
          ad_spend_meta?: number;
          ad_spend_google?: number;
          profit?: number;
          profit_margin?: number;
          roas?: number;
          mer?: number;
          cac?: number;
          orders_count?: number;
          units_sold?: number;
          ad_clicks?: number;
          aov?: number;
          conversion_rate?: number;
          manual_adjustment?: number;
        };
        Update: Partial<Database["public"]["Tables"]["daily_metrics"]["Insert"]>;
        Relationships: [];
      };
      manual_entries: {
        Row: {
          id: string;
          user_id: string;
          date: string;
          kind: "profit" | "expense";
          amount: number;
          currency: string | null;
          label: string | null;
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: {
          user_id: string;
          date: string;
          kind: "profit" | "expense";
          amount?: number;
          currency?: string | null;
          label?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["manual_entries"]["Insert"]>;
        Relationships: [];
      };
      sync_logs: {
        Row: {
          id: string;
          user_id: string;
          source: string;
          job_type: string;
          status: string;
          records_processed: number;
          error: string | null;
          started_at: Timestamp;
          finished_at: Timestamp | null;
          created_at: Timestamp;
        };
        Insert: {
          user_id: string;
          source: string;
          job_type: string;
          status: string;
          records_processed?: number;
          error?: string | null;
          started_at?: Timestamp;
          finished_at?: Timestamp | null;
        };
        Update: Partial<Database["public"]["Tables"]["sync_logs"]["Insert"]>;
        Relationships: [];
      };
      pnl_settings: {
        Row: {
          user_id: string;
          currency: string;
          base_year: number;
          agency_fee_fb: number;
          agency_fee_google: number;
          transaction_fee: number;
          payment_fee_pct: number;
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: {
          user_id: string;
          currency?: string;
          base_year?: number;
          agency_fee_fb?: number;
          agency_fee_google?: number;
          transaction_fee?: number;
          payment_fee_pct?: number;
        };
        Update: Partial<Database["public"]["Tables"]["pnl_settings"]["Insert"]>;
        Relationships: [];
      };
      pnl_month_overrides: {
        Row: {
          id: string;
          user_id: string;
          year: number;
          month: number;
          agency_fee_fb: number | null;
          agency_fee_google: number | null;
          transaction_fee: number | null;
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: {
          id?: string;
          user_id: string;
          year: number;
          month: number;
          agency_fee_fb?: number | null;
          agency_fee_google?: number | null;
          transaction_fee?: number | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["pnl_month_overrides"]["Insert"]
        >;
        Relationships: [];
      };
      pnl_days: {
        Row: {
          id: string;
          user_id: string;
          year: number;
          month: number;
          day: number;
          gross_revenue: number;
          refunds: number;
          cogs: number;
          adspend_fb: number;
          adspend_google: number;
          orders: number;
          notes: string | null;
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: {
          id?: string;
          user_id: string;
          year: number;
          month: number;
          day: number;
          gross_revenue?: number;
          refunds?: number;
          cogs?: number;
          adspend_fb?: number;
          adspend_google?: number;
          orders?: number;
          notes?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["pnl_days"]["Insert"]>;
        Relationships: [];
      };
      roas_settings: {
        Row: {
          user_id: string;
          currency: string;
          roas_scale: number;
          roas_maintain: number;
          roas_watch: number;
          min_margin: number;
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: {
          user_id: string;
          currency?: string;
          roas_scale?: number;
          roas_maintain?: number;
          roas_watch?: number;
          min_margin?: number;
        };
        Update: Partial<Database["public"]["Tables"]["roas_settings"]["Insert"]>;
        Relationships: [];
      };
      product_costs: {
        Row: {
          id: string;
          user_id: string;
          shopify_product_id: string;
          cost: number;
          effective_from: string;
          currency: string | null;
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: {
          id?: string;
          user_id: string;
          shopify_product_id: string;
          cost?: number;
          effective_from?: string;
          currency?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["product_costs"]["Insert"]>;
        Relationships: [];
      };
      product_localizations: {
        Row: {
          id: string;
          user_id: string;
          shopify_product_id: string;
          lang: string;
          title: string | null;
          description: string | null;
          variants: unknown;
          source_currency: string | null;
          target_currency: string | null;
          original_price: number | null;
          converted_price: number | null;
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: {
          id?: string;
          user_id: string;
          shopify_product_id: string;
          lang: string;
          title?: string | null;
          description?: string | null;
          variants?: unknown;
          source_currency?: string | null;
          target_currency?: string | null;
          original_price?: number | null;
          converted_price?: number | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["product_localizations"]["Insert"]
        >;
        Relationships: [];
      };
      campaign_links: {
        Row: {
          id: string;
          user_id: string;
          campaign_id: string;
          product_handle: string | null;
          updated_at: Timestamp;
        };
        Insert: {
          id?: string;
          user_id: string;
          campaign_id: string;
          product_handle?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["campaign_links"]["Insert"]>;
        Relationships: [];
      };
      roas_entries: {
        Row: {
          id: string;
          user_id: string;
          year: number;
          month: number;
          day: number;
          position: number;
          campaign_name: string;
          total_spend: number;
          cpc: number;
          atc: number;
          pur: number;
          price: number;
          cog: number;
          units_sold: number;
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: {
          id?: string;
          user_id: string;
          year: number;
          month: number;
          day: number;
          position?: number;
          campaign_name?: string;
          total_spend?: number;
          cpc?: number;
          atc?: number;
          pur?: number;
          price?: number;
          cog?: number;
          units_sold?: number;
        };
        Update: Partial<Database["public"]["Tables"]["roas_entries"]["Insert"]>;
        Relationships: [];
      };
      research_products: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          url: string | null;
          brand: string | null;
          status: string;
          tags: string[];
          notes: string | null;
          favorite: boolean;
          image_url: string | null;
          created_at: Timestamp;
          updated_at: Timestamp;
          last_researched_at: Timestamp | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          name?: string;
          url?: string | null;
          brand?: string | null;
          status?: string;
          tags?: string[];
          notes?: string | null;
          favorite?: boolean;
          image_url?: string | null;
          last_researched_at?: Timestamp | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["research_products"]["Insert"]
        >;
        Relationships: [];
      };
      research_stores: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          url: string | null;
          niche: string | null;
          status: string;
          tags: string[];
          notes: string | null;
          favorite: boolean;
          image_url: string | null;
          created_at: Timestamp;
          updated_at: Timestamp;
          last_researched_at: Timestamp | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          name?: string;
          url?: string | null;
          niche?: string | null;
          status?: string;
          tags?: string[];
          notes?: string | null;
          favorite?: boolean;
          image_url?: string | null;
          last_researched_at?: Timestamp | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["research_stores"]["Insert"]
        >;
        Relationships: [];
      };
      research_ads: {
        Row: {
          id: string;
          user_id: string;
          product_id: string;
          ad_archive_id: string;
          page_name: string | null;
          page_id: string | null;
          body: string | null;
          title: string | null;
          description: string | null;
          cta: string | null;
          link_url: string | null;
          snapshot_url: string | null;
          image_urls: string[];
          video_url: string | null;
          countries: string[];
          platforms: string[];
          started_at: string | null;
          active: boolean;
          raw: unknown;
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: {
          id?: string;
          user_id: string;
          product_id: string;
          ad_archive_id: string;
          page_name?: string | null;
          page_id?: string | null;
          body?: string | null;
          title?: string | null;
          description?: string | null;
          cta?: string | null;
          link_url?: string | null;
          snapshot_url?: string | null;
          image_urls?: string[];
          video_url?: string | null;
          countries?: string[];
          platforms?: string[];
          started_at?: string | null;
          active?: boolean;
          raw?: unknown;
        };
        Update: Partial<
          Database["public"]["Tables"]["research_ads"]["Insert"]
        >;
        Relationships: [];
      };
      product_cost_tiers: {
        Row: {
          id: string;
          user_id: string;
          shopify_product_id: string;
          min_qty: number;
          total_cost: number;
          currency: string | null;
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: {
          id?: string;
          user_id: string;
          shopify_product_id: string;
          min_qty: number;
          total_cost?: number;
          currency?: string | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["product_cost_tiers"]["Insert"]
        >;
        Relationships: [];
      };
      cogs_collections: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          base_unit_cost: number;
          currency: string | null;
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          base_unit_cost?: number;
          currency?: string | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["cogs_collections"]["Insert"]
        >;
        Relationships: [];
      };
      cogs_collection_products: {
        Row: {
          id: string;
          user_id: string;
          collection_id: string;
          shopify_product_id: string;
          created_at: Timestamp;
        };
        Insert: {
          id?: string;
          user_id: string;
          collection_id: string;
          shopify_product_id: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["cogs_collection_products"]["Insert"]
        >;
        Relationships: [];
      };
      cogs_collection_tiers: {
        Row: {
          id: string;
          user_id: string;
          collection_id: string;
          min_qty: number;
          total_cost: number;
          currency: string | null;
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: {
          id?: string;
          user_id: string;
          collection_id: string;
          min_qty: number;
          total_cost?: number;
          currency?: string | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["cogs_collection_tiers"]["Insert"]
        >;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
