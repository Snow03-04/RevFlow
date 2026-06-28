import { NextResponse, type NextRequest } from "next/server";
import { GoogleGenerativeAI, type Content, type Part } from "@google/generative-ai";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getSettings, resolveFxRate } from "@/lib/queries";
import { getUserGeminiKey } from "@/lib/assistant/keys";
import { todayYmd } from "@/lib/date";
import {
  GEMINI_FUNCTION_DECLARATIONS,
  executeAssistantTool,
  type AssistantContext,
} from "@/lib/assistant/tools";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MODEL = "gemini-2.5-flash";
const MAX_ITERATIONS = 8;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function systemPrompt(ctx: {
  currency: string;
  timezone: string;
  today: string;
  page?: string;
  period?: string;
  mode?: string;
}): string {
  const jarvis = ctx.mode === "voice";

  const persona = jarvis
    ? `You are the user's personal AI assistant (a JARVIS-style companion) built into RevFlow — a profit dashboard for a Shopify store running Meta Ads. You are calm, refined and quietly confident, like an elite advisor.`
    : `You are **RevFlow Intelligence**, the premium AI business analyst built into RevFlow — a profit dashboard for a Shopify store running Meta Ads. You speak with the calm precision of a world-class CFO/growth advisor.`;

  const style = jarvis
    ? `- Reply in **Portuguese (Portugal)** — this is read aloud by a Portuguese voice, so write natural European Portuguese.
- It is SPOKEN, so be brief and conversational: 1–3 sentences. Lead with the answer and the key number.
- You can do quick estimates and calculations out loud, but keep it to the result and the main assumption — no long workings.
- Do NOT use markdown, bullet points, asterisks, headings, abbreviations or emojis — they sound wrong when read aloud. Write numbers and currency in full, plain text.`
    : `- Reply in the user's language (default Portuguese — Portugal).
- Use short paragraphs and tight bullet lists. Bold the key number.
- For calculations, estimates and projections, show the key steps and assumptions compactly so the user can trust the result.
- End with a crisp recommendation or next step when it adds value — don't pad otherwise.`;

  return `${persona}

Be concise, direct and decisive — lead with the answer, then the supporting numbers. No fluff, no "Based on the data…".

# Grounding (critical)
- For any ACTUAL, current figure (revenue, ad spend, profit, ROAS, a product's cost, a campaign's numbers…), ALWAYS call a tool first. Never fabricate or guess the real measured numbers.
- BUT you are a business analyst, not a lookup bot. Once you have the real numbers, you SHOULD calculate, estimate, project and run "what-if" scenarios on top of them. Deriving NEW numbers by maths from real data is encouraged — that is your main value.
- Keep measured facts and derived analysis distinct. Label projections/estimates clearly ("estimativa", "assumindo…") and state the assumptions you used.
- All numbers from tools are already in the store's display currency: **${ctx.currency}**. Format money with the currency symbol and round sensibly.
- When comparing periods, state the delta and what it means.
- If a connection is in error or data looks stale, say so and offer to refresh.

# Analysis you can do (be proactive — go beyond reporting)
Pull the real inputs with tools, then do the maths. Examples:
- **Projections / forecasts** — extrapolate trends from get_daily_series ("ao ritmo atual, ~X de lucro até ao fim do mês").
- **What-if scenarios** — "se aumentares o budget 20% e o ROAS se mantiver, +X de receita e +Y de lucro".
- **Break-even & targets** — compute break-even ROAS from the margin, or "precisas de ~N unidades / X€ de vendas para Y€ de lucro".
- **Pricing & margin maths** — the profit/margin impact of changing a price or a COGS.
- **Diagnoses & recommendations** — which campaign to scale or kill, which product is losing money and why.
If you're missing an input for a calculation, make a reasonable assumption and say so — don't refuse.

# Capabilities
- Read tools: get_metrics, get_daily_series, get_top_products, get_campaigns, get_cogs_products, get_connections_status.
- Safe actions (run automatically when helpful): sync_now, refresh_ad_spend, recompute_metrics, import_roas_month.
- Sensitive action: set_product_cost — first look the product up with get_cogs_products, then PROPOSE the change. It is NOT applied until the user confirms. Tell them to confirm.

# Style
${style}
- Proactively surface risks (negative margin, ROAS below break-even, a campaign to kill) when relevant.

# Context
- Today: ${ctx.today} (timezone ${ctx.timezone}).
- The user is currently viewing: ${ctx.page ?? "the dashboard"}${ctx.period ? ` (period: ${ctx.period})` : ""}. Prefer this period if they ask "how am I doing" without specifying one.`;
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: {
    messages?: ChatMessage[];
    context?: { page?: string; period?: string; mode?: string };
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const history = (body.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content?.trim())
    .slice(-20);
  if (history.length === 0) {
    return NextResponse.json({ error: "No messages" }, { status: 400 });
  }

  const supabase = await createClient();

  // Per-user Gemini key — there is no shared/global key.
  const geminiKey = await getUserGeminiKey(supabase, user.id);
  if (!geminiKey) {
    return NextResponse.json(
      {
        error: "no_api_key",
        message:
          "Adiciona a tua chave Gemini nas Definições para usar o assistente.",
      },
      { status: 400 },
    );
  }

  const settings = await getSettings(supabase, user.id);
  const currency = settings?.currency ?? "EUR";
  const timezone = settings?.timezone ?? "UTC";
  const fxRate = await resolveFxRate(supabase, user.id, currency);

  const ctx: AssistantContext = {
    supabase,
    userId: user.id,
    currency,
    timezone,
    fxRate,
    fallbackCostPct: Number(settings?.default_product_cost_pct ?? 30),
  };

  const system = systemPrompt({
    currency,
    timezone,
    today: todayYmd(timezone),
    page: body.context?.page,
    period: body.context?.period,
    mode: body.context?.mode,
  });

  const genAI = new GoogleGenerativeAI(geminiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction: system,
    tools: [{ functionDeclarations: GEMINI_FUNCTION_DECLARATIONS }],
  });

  // Last message is the new prompt; the rest seeds the chat history.
  const geminiHistory: Content[] = history.slice(0, -1).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const lastUserText = history[history.length - 1].content;
  const chat = model.startChat({ history: geminiHistory });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      try {
        let result = await chat.sendMessageStream(lastUserText);

        for (let i = 0; i < MAX_ITERATIONS; i++) {
          for await (const chunk of result.stream) {
            let text = "";
            try {
              text = chunk.text();
            } catch {
              text = "";
            }
            if (text) send({ type: "text", text });
          }

          const resp = await result.response;
          const calls = resp.functionCalls() ?? [];
          if (calls.length === 0) break;

          const parts: Part[] = [];
          for (const call of calls) {
            const outcome = await executeAssistantTool(
              call.name,
              (call.args ?? {}) as Record<string, unknown>,
              ctx,
            );
            if (outcome.activity) send({ type: "activity", label: outcome.activity });
            if (outcome.pendingAction)
              send({ type: "pending_action", action: outcome.pendingAction });
            parts.push({
              functionResponse: {
                name: call.name,
                response: { result: outcome.result },
              },
            });
          }
          result = await chat.sendMessageStream(parts);
        }

        send({ type: "done" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        let message = "O assistente falhou.";
        if (/api[_ ]?key|API_KEY_INVALID|invalid.*key|permission|401|403/i.test(msg)) {
          message =
            "Chave Gemini inválida ou sem permissões. Confirma a GEMINI_API_KEY no .env.local (Google AI Studio → Get API key).";
        } else if (/quota|rate|429|RESOURCE_EXHAUSTED/i.test(msg)) {
          message = "Limite de pedidos do Gemini atingido. Espera um momento e tenta de novo.";
        } else if (/not found|404|model/i.test(msg)) {
          message = `Modelo indisponível (${MODEL}). Posso trocar para outro Gemini.`;
        } else {
          message = msg.slice(0, 300);
        }
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
