// Quick check that Gemini TTS works with our key/model/voice.
// Usage: node scripts/diag-tts.mjs
import { readFileSync, writeFileSync } from "node:fs";

function loadEnv() {
  const txt = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  const out = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = loadEnv();
const key = env.GEMINI_API_KEY;
if (!key) {
  console.error("No GEMINI_API_KEY in .env.local");
  process.exit(1);
}

const MODEL = "gemini-2.5-flash-preview-tts";
const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;

const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    contents: [
      {
        parts: [
          {
            text: "Read this aloud in calm, refined European Portuguese with a Portugal accent: Olá. Tudo a postos para te ajudar com o teu negócio.",
          },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: "Charon" } },
      },
    },
  }),
});

console.log("HTTP", res.status, res.statusText);
if (!res.ok) {
  console.error((await res.text()).slice(0, 800));
  process.exit(1);
}

const json = await res.json();
const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
const b64 = part?.inlineData?.data;
console.log("mimeType:", part?.inlineData?.mimeType);
console.log("audio bytes (base64 decoded):", b64 ? Buffer.from(b64, "base64").length : 0);

if (b64) {
  // Write a playable WAV so you can listen and judge the accent.
  const pcm = Buffer.from(b64, "base64");
  const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType ?? "")?.[1] ?? 24000);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  const out = new URL("../tts-sample.wav", import.meta.url);
  writeFileSync(out, Buffer.concat([h, pcm]));
  console.log("Wrote sample to tts-sample.wav — play it to hear the voice/accent.");
}
