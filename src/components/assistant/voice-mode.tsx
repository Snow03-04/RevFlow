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
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const acRef = useRef<any>(null);
  const micRaf = useRef(0);
  const speakInt = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSpokenId = useRef<string | null>(null);
  const prevBusy = useRef(busy);

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
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* noop */
    }
    setSpeaking(false);
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
  }, [busy, speaking, onSend, startMicLevel, stopMicLevel]);

  /* ---- TTS ---- */
  const stopSpeakPulse = useCallback(() => {
    if (speakInt.current) clearInterval(speakInt.current);
    speakInt.current = null;
    setSpeakLevel(0);
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (!tts || !text) return;
      try {
        const synth = window.speechSynthesis;
        synth.cancel();
        const u = new SpeechSynthesisUtterance(stripMd(text).slice(0, 600));
        u.lang = "pt-PT";
        u.rate = 1.05;
        const voices = synth.getVoices();
        const v =
          voices.find((x) => /pt[-_]?PT/i.test(x.lang)) ?? voices.find((x) => /^pt/i.test(x.lang));
        if (v) u.voice = v;
        u.onstart = () => {
          setSpeaking(true);
          stopSpeakPulse();
          speakInt.current = setInterval(() => setSpeakLevel(0.3 + Math.random() * 0.45), 110);
        };
        u.onend = () => {
          setSpeaking(false);
          stopSpeakPulse();
        };
        u.onerror = () => {
          setSpeaking(false);
          stopSpeakPulse();
        };
        synth.speak(u);
      } catch {
        /* noop */
      }
    },
    [tts, stopSpeakPulse],
  );

  // Speak the assistant reply once it finishes streaming.
  useEffect(() => {
    if (prevBusy.current && !busy) {
      const last = [...messages].reverse().find((m) => m.role === "assistant");
      if (last && last.text && last.id !== lastSpokenId.current && !last.text.startsWith("⚠️")) {
        lastSpokenId.current = last.id;
        speak(last.text);
      }
    }
    prevBusy.current = busy;
  }, [busy, messages, speak]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      stopListening();
      stopMicLevel();
      stopSpeakPulse();
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* noop */
      }
    };
  }, [stopListening, stopMicLevel, stopSpeakPulse]);

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
                ? "text-purple-300"
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
