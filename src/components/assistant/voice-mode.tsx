"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, X, MessageSquare, Volume2, VolumeX } from "lucide-react";
import { Orb, type OrbState } from "@/components/assistant/orb";
import { cn } from "@/lib/utils";

interface VMsg {
  id: string;
  role: "user" | "assistant";
  text: string;
}

function getSR(): any {
  if (typeof window === "undefined") return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

function stripMd(s: string): string {
  return s
    .replace(/\*\*/g, "")
    .replace(/[#>`_]/g, "")
    .replace(/^[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

const JARVIS_GREETING = "Hello sir. How can I help you?";

/** A British English male voice (JARVIS-style) — for the English greeting. */
function pickEnVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis?.getVoices?.() ?? [];
  if (!voices.length) return undefined;
  const by = (re: RegExp) => voices.find((v) => re.test(v.name));
  return (
    by(/jarvis/i) ||
    by(/Daniel|Arthur|George|Oliver|Brian|Ryan|Thomas/) ||
    by(/UK English Male|British.*Male|Male.*UK/i) ||
    voices.find((v) => /en-GB/i.test(v.lang) && /male/i.test(v.name)) ||
    voices.find((v) => /en-GB/i.test(v.lang)) ||
    voices.find((v) => /en[-_]/i.test(v.lang)) ||
    voices[0]
  );
}

/** A Portuguese voice (prefer pt-PT) — so replies don't get an English accent. */
function pickPtVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis?.getVoices?.() ?? [];
  if (!voices.length) return undefined;
  return (
    voices.find((v) => /pt[-_]?PT/i.test(v.lang) && /male|Duarte|Ricardo|Joaquim|Fernanda/i.test(v.name)) ||
    voices.find((v) => /pt[-_]?PT/i.test(v.lang)) ||
    voices.find((v) => /Portugu[eê]s.*Portugal|Portugal/i.test(v.name)) ||
    voices.find((v) => /pt[-_]?BR/i.test(v.lang)) || // Brazilian fallback (still PT phonetics)
    voices.find((v) => /^pt/i.test(v.lang))
  );
}

function pickVoice(prefer: "en" | "pt"): SpeechSynthesisVoice | undefined {
  return prefer === "pt" ? pickPtVoice() ?? pickEnVoice() : pickEnVoice();
}

export function VoiceMode({
  messages,
  busy,
  onSend,
  onClose,
  onChat,
}: {
  messages: VMsg[];
  busy: boolean;
  onSend: (text: string) => void;
  onClose: () => void;
  onChat: () => void;
}) {
  const [supported] = useState(() => !!getSR());
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interim, setInterim] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [speakLevel, setSpeakLevel] = useState(0);
  const [tts, setTts] = useState(true);
  const [intro, setIntro] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const acRef = useRef<any>(null);
  const micRaf = useRef(0);
  const speakInt = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSpokenId = useRef<string | null>(null);
  const prevBusy = useRef(busy);

  // Web Audio playback for Gemini TTS.
  const playAcRef = useRef<AudioContext | null>(null);
  const srcRef = useRef<AudioBufferSourceNode | null>(null);
  const speakRaf = useRef(0);
  const speakGen = useRef(0); // bumps to invalidate stale/superseded speech

  const lastReply = [...messages].reverse().find((m) => m.role === "assistant")?.text ?? "";

  /* ---- mic amplitude ---- */
  const stopMicLevel = useCallback(() => {
    cancelAnimationFrame(micRaf.current);
    setMicLevel(0);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    acRef.current?.close?.().catch(() => {});
    acRef.current = null;
  }, []);

  const startMicLevel = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ac = new AC();
      acRef.current = ac;
      const src = ac.createMediaStreamSource(stream);
      const an = ac.createAnalyser();
      an.fftSize = 256;
      src.connect(an);
      const data = new Uint8Array(an.frequencyBinCount);
      const loop = () => {
        an.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) {
          const x = (v - 128) / 128;
          sum += x * x;
        }
        setMicLevel(Math.min(1, Math.sqrt(sum / data.length) * 3.2));
        micRaf.current = requestAnimationFrame(loop);
      };
      loop();
    } catch {
      /* amplitude is a nice-to-have */
    }
  }, []);

  /* ---- text-to-speech (Gemini, one voice) ---- */
  const stopPulse = useCallback(() => {
    if (speakInt.current) clearInterval(speakInt.current);
    speakInt.current = null;
  }, []);

  // Stop any ongoing speech (Gemini audio + browser fallback) immediately.
  const stopSpeaking = useCallback(() => {
    speakGen.current += 1; // invalidate any in-flight request
    try {
      srcRef.current?.stop();
    } catch {
      /* noop */
    }
    srcRef.current = null;
    cancelAnimationFrame(speakRaf.current);
    stopPulse();
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* noop */
    }
    setSpeakLevel(0);
    setSpeaking(false);
  }, [stopPulse]);

  // Browser speech-synthesis fallback (only used if Gemini TTS fails).
  const browserSpeak = useCallback(
    (text: string, prefer: "en" | "pt") => {
      try {
        const synth = window.speechSynthesis;
        synth.cancel();
        const u = new SpeechSynthesisUtterance(text.slice(0, 600));
        const v = pickVoice(prefer);
        if (v) u.voice = v;
        u.lang = v?.lang || (prefer === "pt" ? "pt-PT" : "en-GB");
        if (prefer === "en") {
          u.rate = 0.92;
          u.pitch = 0.82;
        } else {
          u.rate = 1.0;
          u.pitch = 0.95;
        }
        u.onstart = () => {
          setSpeaking(true);
          stopPulse();
          speakInt.current = setInterval(
            () => setSpeakLevel(0.3 + Math.random() * 0.45),
            110,
          );
        };
        u.onend = () => {
          setSpeaking(false);
          stopPulse();
          setSpeakLevel(0);
        };
        u.onerror = () => {
          setSpeaking(false);
          stopPulse();
          setSpeakLevel(0);
        };
        synth.speak(u);
      } catch {
        setSpeaking(false);
      }
    },
    [stopPulse],
  );

  // Primary path: synthesize with Gemini TTS (one consistent male voice for
  // both the English greeting and the Portuguese replies) and play it through
  // Web Audio so the orb pulses to the real voice.
  const speak = useCallback(
    async (raw: string, prefer: "en" | "pt" = "pt") => {
      const text = stripMd(raw);
      if (!tts || !text) return;
      const gen = ++speakGen.current;

      // Stop whatever is currently playing.
      try {
        srcRef.current?.stop();
      } catch {
        /* noop */
      }
      srcRef.current = null;
      cancelAnimationFrame(speakRaf.current);
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* noop */
      }
      setSpeaking(true);

      try {
        const res = await fetch("/api/assistant/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: text.slice(0, 1200), lang: prefer }),
        });
        if (speakGen.current !== gen) return; // superseded
        if (!res.ok) throw new Error(`tts ${res.status}`);
        const bytes = await res.arrayBuffer();
        if (speakGen.current !== gen) return;

        const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
        let ac = playAcRef.current;
        if (!ac || ac.state === "closed") {
          ac = new AC();
          playAcRef.current = ac;
        }
        if (ac!.state === "suspended") await ac!.resume();
        const audio = await ac!.decodeAudioData(bytes);
        if (speakGen.current !== gen) return;

        const src = ac!.createBufferSource();
        src.buffer = audio;
        const an = ac!.createAnalyser();
        an.fftSize = 256;
        src.connect(an);
        an.connect(ac!.destination);
        srcRef.current = src;

        const data = new Uint8Array(an.frequencyBinCount);
        const loop = () => {
          an.getByteTimeDomainData(data);
          let sum = 0;
          for (const v of data) {
            const x = (v - 128) / 128;
            sum += x * x;
          }
          setSpeakLevel(Math.min(1, Math.sqrt(sum / data.length) * 3.4));
          speakRaf.current = requestAnimationFrame(loop);
        };
        src.onended = () => {
          if (speakGen.current !== gen) return;
          cancelAnimationFrame(speakRaf.current);
          setSpeakLevel(0);
          setSpeaking(false);
          srcRef.current = null;
        };
        src.start();
        loop();
      } catch {
        if (speakGen.current !== gen) return;
        browserSpeak(text, prefer); // graceful fallback
      }
    },
    [tts, browserSpeak],
  );

  /* ---- speech recognition ---- */
  const stopListening = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      /* noop */
    }
  }, []);

  const startListening = useCallback(() => {
    const SR = getSR();
    if (!SR || busy || speaking) return;
    stopSpeaking();
    const rec = new SR();
    rec.lang = "pt-PT";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let finalText = "";
    rec.onresult = (e: any) => {
      let str = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else str += r[0].transcript;
      }
      setInterim((finalText + str).trim());
    };
    rec.onerror = (ev: any) => {
      setListening(false);
      stopMicLevel();
      if (ev?.error === "not-allowed" || ev?.error === "service-not-allowed")
        setError("Sem acesso ao microfone. Permite o microfone no browser.");
    };
    rec.onend = () => {
      setListening(false);
      stopMicLevel();
      const text = finalText.trim();
      setInterim("");
      if (text) onSend(text);
    };
    recRef.current = rec;
    setError(null);
    setListening(true);
    startMicLevel();
    try {
      rec.start();
    } catch {
      setListening(false);
    }
  }, [busy, speaking, onSend, startMicLevel, stopMicLevel, stopSpeaking]);

  // Speak the assistant reply once it finishes streaming.
  useEffect(() => {
    if (prevBusy.current && !busy) {
      const last = [...messages].reverse().find((m) => m.role === "assistant");
      if (last && last.text && last.id !== lastSpokenId.current && !last.text.startsWith("⚠️")) {
        lastSpokenId.current = last.id;
        speak(last.text, "pt");
      }
    }
    prevBusy.current = busy;
  }, [busy, messages, speak]);

  // Greet like JARVIS once, when voice mode opens.
  const greeted = useRef(false);
  useEffect(() => {
    setIntro(JARVIS_GREETING);
    const t = setTimeout(() => {
      if (greeted.current) return;
      greeted.current = true;
      void speak(JARVIS_GREETING, "en");
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stop talking immediately when the user mutes the voice.
  useEffect(() => {
    if (!tts) stopSpeaking();
  }, [tts, stopSpeaking]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      stopListening();
      stopMicLevel();
      stopSpeaking();
      playAcRef.current?.close?.().catch(() => {});
      playAcRef.current = null;
    };
  }, [stopListening, stopMicLevel, stopSpeaking]);

  const orbState: OrbState = listening
    ? "listening"
    : busy
      ? "thinking"
      : speaking
        ? "speaking"
        : "idle";
  const orbLevel = listening ? micLevel : speaking ? speakLevel : 0;

  const status = listening
    ? "A ouvir…"
    : busy
      ? "A analisar os teus dados…"
      : speaking
        ? "A responder…"
        : "Toca no microfone e fala";

  return (
    <div
      className="fixed inset-0 z-[110] flex flex-col items-center bg-[#070b1d]"
      style={{
        backgroundImage:
          "radial-gradient(circle at 50% 32%, #18244f 0%, #0c1436 52%, #070b1d 100%)",
      }}
    >
      {/* Top bar */}
      <div className="flex w-full items-center justify-between px-5 py-4">
        <p className="text-xs font-medium uppercase tracking-[0.3em] text-sky-200/70">
          RevFlow Intelligence
        </p>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setTts((v) => !v)}
            title={tts ? "Voz ligada" : "Voz desligada"}
            className="rounded-lg p-2 text-sky-200/70 hover:bg-white/5 hover:text-white"
          >
            {tts ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>
          <button
            onClick={onChat}
            title="Modo chat"
            className="rounded-lg p-2 text-sky-200/70 hover:bg-white/5 hover:text-white"
          >
            <MessageSquare className="h-4 w-4" />
          </button>
          <button
            onClick={onClose}
            title="Fechar"
            className="rounded-lg p-2 text-sky-200/70 hover:bg-white/5 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Orb */}
      <div className="relative mt-2 flex flex-col items-center">
        <div className="h-[min(46vh,420px)] w-[min(46vh,420px)]">
          <Orb state={orbState} level={orbLevel} className="h-full w-full" />
        </div>
        <p
          className={cn(
            "mt-1 text-sm transition-colors",
            listening
              ? "text-cyan-300"
              : busy
                ? "text-primary"
                : speaking
                  ? "text-sky-300"
                  : "text-sky-200/60",
          )}
        >
          {status}
        </p>
      </div>

      {/* Transcript / reply */}
      <div className="mt-4 w-full max-w-xl flex-1 overflow-y-auto px-6 pb-4 text-center scrollbar-thin">
        {interim && (
          <p className="mb-3 text-base text-white/90">“{interim}”</p>
        )}
        {!interim && lastReply && (
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-sky-100/85">
            {stripMd(lastReply)}
          </p>
        )}
        {!interim && !lastReply && intro && (
          <p className="text-lg font-light text-sky-100/80">{intro}</p>
        )}
        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
        {!supported && (
          <p className="mt-3 text-sm text-amber-300">
            O teu browser não suporta reconhecimento de voz. Usa o Chrome/Edge, ou o modo chat.
          </p>
        )}
      </div>

      {/* Mic button */}
      <div className="mb-10 flex flex-col items-center gap-3">
        <button
          onClick={() => (listening ? stopListening() : startListening())}
          disabled={!supported || busy || speaking}
          className={cn(
            "relative flex h-20 w-20 items-center justify-center rounded-full transition-all disabled:opacity-40",
            listening
              ? "bg-cyan-500 text-white"
              : "bg-white/10 text-sky-100 hover:bg-white/15",
          )}
        >
          {listening && (
            <span
              className="absolute inset-0 rounded-full bg-cyan-400/40"
              style={{ transform: `scale(${1 + micLevel * 0.8})`, transition: "transform 80ms" }}
            />
          )}
          <span className="absolute inset-0 rounded-full ring-1 ring-white/20" />
          {listening ? <MicOff className="relative h-7 w-7" /> : <Mic className="relative h-7 w-7" />}
        </button>
        <p className="text-[11px] text-sky-200/50">
          {listening ? "Toca para parar" : "Toca para falar"} · ⌘K para chat
        </p>
      </div>
    </div>
  );
}
