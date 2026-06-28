import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Single prebuilt voice used for BOTH the English greeting and the Portuguese
// replies, so it's always "the same guy" — a deep, informative male voice.
const VOICE = "Charon";
const TTS_MODEL = "gemini-2.5-flash-preview-tts";

/** Wrap a directive around the text so the model speaks it with the right
 * accent/tone. The instruction before the colon is interpreted as style, not
 * spoken. Kept in English (best instruction-following) but asks for a Portugal
 * accent for replies — which is exactly what we want. */
function styled(text: string, lang: string): string {
  if (lang === "en") {
    return `Say warmly and calmly, like a refined personal assistant: ${text}`;
  }
  return `Read this aloud in calm, refined European Portuguese with a Portugal accent: ${text}`;
}

/** Parse the sample rate out of a mime like "audio/L16;rate=24000". */
function rateFromMime(mime: string | undefined): number {
  const m = /rate=(\d+)/.exec(mime ?? "");
  return m ? Number(m[1]) : 24000;
}

/** Wrap raw signed 16-bit mono PCM in a minimal WAV header so the browser can
 * decode it with AudioContext.decodeAudioData. */
function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const channels = 1;
  const bits = 16;
  const blockAlign = (channels * bits) / 8;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bits, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { text?: string; lang?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const text = (body.text ?? "").trim().slice(0, 1200);
  const lang = body.lang === "en" ? "en" : "pt";
  if (!text) {
    return NextResponse.json({ error: "No text" }, { status: 400 });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent?key=${serverEnv.geminiApiKey}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: styled(text, lang) }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } },
          },
        },
      }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `TTS request failed: ${msg}` }, { status: 502 });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return NextResponse.json(
      { error: `Gemini TTS ${res.status}`, detail: detail.slice(0, 300) },
      { status: 502 },
    );
  }

  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[];
  };
  const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  const b64 = part?.inlineData?.data;
  if (!b64) {
    return NextResponse.json({ error: "No audio returned" }, { status: 502 });
  }

  const pcm = Buffer.from(b64, "base64");
  const wav = pcmToWav(pcm, rateFromMime(part?.inlineData?.mimeType));

  return new Response(new Uint8Array(wav), {
    headers: {
      "Content-Type": "audio/wav",
      "Cache-Control": "no-store",
    },
  });
}
