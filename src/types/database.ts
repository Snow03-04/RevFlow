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
        };
        Update: Partial<Database["public"]["Tables"]["daily_metrics"]["Insert"]>;
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
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: {
          id?: string;
          user_id: string;
          shopify_product_id: string;
          cost?: number;
        };
        Update: Partial<Database["public"]["Tables"]["product_costs"]["Insert"]>;
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
