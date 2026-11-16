import { createHandler } from "./handler.ts";

Deno.serve(createHandler(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_ANON_KEY")!,
  Deno.env.get("REVFLOW_LIVE_TOKEN_KEY")!,
));
