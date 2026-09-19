"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, X, MessageSquare, Volume2, VolumeX, ArrowUpRight, Square, RotateCcw } from "lucide-react";
import { Orb, type OrbState } from "./orb";
import { cn } from "@/lib/utils";
import styles from "./voice-mode.module.css";

interface VMsg { id: string; role: "user" | "assistant"; text: string }
export interface GreetingPlayback { audio: HTMLAudioElement; playback: Promise<void> }
interface RecognitionResult { isFinal: boolean; 0: { transcript: string } }
interface Recognition {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: ((event: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
function getSR(): (new () => Recognition) | undefined {
  if (typeof window === "undefined") return;
  const browser = window as typeof window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
}
const stripMd = (text: string) => text.replace(/\*\*/g, "").replace(/[#>`_]/g, "").replace(/^[-•]\s+/gm, "").trim();

export function VoiceMode({ messages, busy, onSend, onClose, onChat, greeting, pageName, pendingActions }: {
  messages: VMsg[]; busy: boolean; onSend: (text: string) => void; onClose: () => void; onChat: () => void;
  greeting: GreetingPlayback | null; pageName: string; pendingActions: boolean;
}) {
  const [supported] = useState(() => !!getSR());
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [greetingActive, setGreetingActive] = useState(true);
  const [greetingBlocked, setGreetingBlocked] = useState(false);
  const [interim, setInterim] = useState("");
  const [level, setLevel] = useState(0);
  const [tts, setTts] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<Recognition | null>(null);
  const micStream = useRef<MediaStream | null>(null);
  const micContext = useRef<AudioContext | null>(null);
  const playContext = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const micGeneration = useRef(0);
  const speechGeneration = useRef(0);
  const animationRef = useRef(0);
  const pulseRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevBusy = useRef(busy);
  const lastSpoken = useRef<string | null>(null);
  const initialMessageCount = useRef(messages.length);
  const initiallyBusy = useRef(busy);
  const lastReply = messages.length > initialMessageCount.current || initiallyBusy.current ? [...messages].reverse().find((m) => m.role === "assistant")?.text : null;

  const stopMeter = useCallback(() => {
    cancelAnimationFrame(animationRef.current);
    if (pulseRef.current) clearInterval(pulseRef.current);
    pulseRef.current = null;
    setLevel(0);
  }, []);

  const stopMic = useCallback(() => {
    micGeneration.current++;
    micStream.current?.getTracks().forEach((track) => track.stop());
    micStream.current = null;
    void micContext.current?.close().catch(() => {});
    micContext.current = null;
    stopMeter();
  }, [stopMeter]);

  const stopSpeech = useCallback(() => {
    speechGeneration.current++;
    requestRef.current?.abort();
    requestRef.current = null;
    try { sourceRef.current?.stop(); } catch { /* already ended */ }
    sourceRef.current = null;
    window.speechSynthesis?.cancel();
    stopMeter();
    setSpeaking(false);
  }, [stopMeter]);

  const interrupt = useCallback(() => {
    greeting?.audio.pause();
    setGreetingActive(false);
    stopSpeech();
  }, [greeting, stopSpeech]);

  const meter = useCallback((analyser: AnalyserNode) => {
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const value of data) sum += ((value - 128) / 128) ** 2;
      setLevel(Math.min(1, Math.sqrt(sum / data.length) * 3.5));
      animationRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const speak = useCallback(async (raw: string) => {
    const text = stripMd(raw).slice(0, 1200);
    if (!tts || !text || text.includes("⚠️")) return;
    interrupt();
    const generation = ++speechGeneration.current;
    const controller = new AbortController();
    requestRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 20000);
    setSpeaking(true);
    try {
      const response = await fetch("/api/assistant/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, lang: "pt" }), signal: controller.signal });
      if (!response.ok) throw new Error("Voz indisponível");
      const bytes = await response.arrayBuffer();
      if (generation !== speechGeneration.current) return;
      const context = playContext.current ?? new AudioContext();
      playContext.current = context;
      await context.resume();
      const buffer = await context.decodeAudioData(bytes);
      if (generation !== speechGeneration.current) return;
      const source = context.createBufferSource();
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      source.buffer = buffer;
      source.connect(analyser); analyser.connect(context.destination);
      sourceRef.current = source;
      source.onended = () => { if (generation === speechGeneration.current) { stopMeter(); setSpeaking(false); sourceRef.current = null; } };
      source.start(); meter(analyser);
    } catch {
      if (generation !== speechGeneration.current) return;
      if (!window.speechSynthesis) { setSpeaking(false); setError("O áudio não está disponível. Podes ler a resposta ou abrir o chat."); return; }
      const utterance = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();
      const voice = voices.find((v) => v.lang === "pt-PT" && /Duarte|male/i.test(v.name)) ?? voices.find((v) => v.lang === "pt-PT") ?? voices.find((v) => v.lang.startsWith("pt"));
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang ?? "pt-PT";
      utterance.rate = 0.98;
      utterance.onstart = () => { if (generation === speechGeneration.current) pulseRef.current = setInterval(() => setLevel(0.3 + Math.random() * 0.35), 120); };
      utterance.onend = utterance.onerror = () => { if (generation === speechGeneration.current) { stopMeter(); setSpeaking(false); } };
      window.speechSynthesis.speak(utterance);
    } finally { clearTimeout(timeout); }
  }, [tts, interrupt, stopMeter, meter]);

  const startListening = useCallback(() => {
    const SR = getSR();
    if (!SR || busy || recRef.current) return;
    interrupt(); setError(null); setInterim("");
    // Unlock reply audio during this gesture, before waiting for the AI.
    if (!playContext.current || playContext.current.state === "closed") playContext.current = new AudioContext();
    void playContext.current.resume().catch(() => {});
    const recognition = new SR();
    recognition.lang = "pt-PT";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;
    let finalText = "";
    let failed = false;
    recognition.onresult = (event) => {
      let draft = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) finalText += event.results[i][0].transcript;
        else draft += event.results[i][0].transcript;
      }
      setInterim((finalText + draft).trim());
    };
    recognition.onerror = ({ error: code }) => {
      failed = true; setListening(false); stopMic();
      if (code === "aborted") return;
      setError(code === "not-allowed" || code === "service-not-allowed" ? "Permite o acesso ao microfone para falar com o assistente." : code === "no-speech" ? "Não ouvi a pergunta. Toca no microfone e tenta outra vez." : code === "audio-capture" ? "Não encontrei um microfone disponível." : "Não consegui reconhecer a voz. Tenta novamente ou abre o chat.");
    };
    recognition.onend = () => {
      recRef.current = null; setListening(false); stopMic(); setInterim("");
      if (!failed && finalText.trim()) onSend(finalText.trim());
    };
    recRef.current = recognition;
    try {
      recognition.start(); setListening(true);
      const generation = ++micGeneration.current;
      void navigator.mediaDevices?.getUserMedia({ audio: true }).then((stream) => {
        if (generation !== micGeneration.current) { stream.getTracks().forEach((track) => track.stop()); return; }
        micStream.current = stream;
        const context = new AudioContext(); micContext.current = context;
        const analyser = context.createAnalyser(); analyser.fftSize = 256;
        context.createMediaStreamSource(stream).connect(analyser); meter(analyser);
      }).catch(() => {});
    } catch { recRef.current = null; setListening(false); stopMic(); setError("Não consegui iniciar o microfone. Tenta novamente."); }
  }, [busy, interrupt, stopMic, meter, onSend]);

  useEffect(() => {
    if (!greeting) { setGreetingActive(false); return; }
    let active = true;
    const started = () => { setGreetingActive(true); setGreetingBlocked(false); };
    const ended = () => { setGreetingActive(false); };
    greeting.audio.addEventListener("playing", started);
    greeting.audio.addEventListener("pause", ended);
    greeting.audio.addEventListener("ended", ended);
    void greeting.playback.then(() => { if (active) setGreetingActive(!greeting.audio.paused); }).catch(() => { if (active) { setGreetingActive(false); setGreetingBlocked(true); } });
    return () => { active = false; greeting.audio.removeEventListener("playing", started); greeting.audio.removeEventListener("pause", ended); greeting.audio.removeEventListener("ended", ended); };
  }, [greeting]);

  useEffect(() => {
    if (prevBusy.current && !busy) {
      const last = [...messages].reverse().find((m) => m.role === "assistant");
      if (last?.text && last.id !== lastSpoken.current) { lastSpoken.current = last.id; void speak(last.text); }
    }
    prevBusy.current = busy;
  }, [busy, messages, speak]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const closeButton = dialog?.querySelector<HTMLButtonElement>('[aria-label="Fechar assistente"]');
    closeButton?.focus();
    function trap(event: KeyboardEvent) {
      if (event.key !== "Tab" || !dialog) return;
      const buttons = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]')];
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    dialog?.addEventListener("keydown", trap);
    return () => dialog?.removeEventListener("keydown", trap);
  }, []);

  useEffect(() => () => {
    // Abort instead of stop: closing must never submit a partial utterance.
    const recognition = recRef.current;
    if (recognition) { recognition.onend = null; recognition.onresult = null; recognition.onerror = null; try { recognition.abort(); } catch { /* already stopped */ } }
    recRef.current = null;
    stopMic(); stopSpeech();
    void playContext.current?.close().catch(() => {});
    playContext.current = null;
  }, [stopMic, stopSpeech]);

  const orbState: OrbState = listening ? "listening" : busy ? "thinking" : speaking || greetingActive ? "speaking" : "idle";
  const status = listening ? "A ouvir" : busy ? "A analisar" : greetingActive ? "Hello sir" : speaking ? "A responder" : "À tua disposição";
  const muted = () => { if (tts) interrupt(); setTts((value) => !value); };

  return <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="voice-title" className={styles.shell} data-state={orbState}>
    <div className={styles.grid} aria-hidden="true" /><div className={styles.horizon} aria-hidden="true" />
    <header className={styles.header}>
      <div className="flex items-center gap-3"><span className={styles.brandMark} aria-hidden="true"><span /></span><div><h2 id="voice-title" className="text-sm font-semibold tracking-wide text-white">RevFlow <span className="font-normal text-cyan-200/60">Intelligence</span></h2><p className="mt-1 text-[9px] uppercase tracking-[0.24em] text-cyan-100/40">Assistente de voz</p></div></div>
      <div className="flex items-center gap-1 sm:gap-2">
        <button onClick={muted} aria-label={tts ? "Desligar voz" : "Ligar voz"} title={tts ? "Desligar voz" : "Ligar voz"} className={styles.iconButton}>{tts ? <Volume2 size={17} /> : <VolumeX size={17} />}</button>
        <button onClick={onChat} aria-label="Abrir chat" title="Abrir chat" className={styles.iconButton}><MessageSquare size={17} /></button>
        <span className="mx-1 h-4 w-px bg-cyan-100/10" />
        <button onClick={onClose} aria-label="Fechar assistente" title="Fechar" className={styles.iconButton}><X size={20} /></button>
      </div>
    </header>
    <main className={styles.main}>
      <div className={styles.context}><span>Contexto atual</span><strong>{pageName}</strong></div>
      <div className={styles.orbStage} aria-hidden="true">
        <div className={styles.orbitOuter} /><div className={styles.orbitInner} /><div className={styles.crosshair} />
        <div className={styles.orb}><Orb state={orbState} level={greetingActive ? 0.4 : level} className="h-full w-full" /></div>
        <span className={styles.orbitLabel}>REVFLOW</span>
      </div>
      <div className={styles.status}><span className={styles.statusDot} /><span role="status">{status}</span><span className={styles.statusLine} /></div>
      <div className={styles.transcript} aria-live="polite" aria-atomic="true">
        {interim ? <p className="text-lg text-white sm:text-xl">“{interim}”</p> : lastReply ? <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200 sm:text-base">{stripMd(lastReply)}</p> : <><h3 className={styles.greeting}>Hello sir<span>.</span></h3><p className="mt-3 text-sm text-slate-400">O teu negócio. Sob uma nova perspetiva.</p></>}
        {error && <p role="alert" className="mt-3 text-xs leading-relaxed text-amber-200">{error}</p>}
        {!supported && <p className="mt-3 text-xs text-slate-400">Para falar, abre no Chrome ou Edge. O chat continua disponível.</p>}
        {greetingBlocked && <button onClick={() => { if (!greeting) return; greeting.audio.currentTime = 0; void greeting.audio.play().catch(() => setError("Não foi possível reproduzir a saudação.")); }} className="mt-3 inline-flex items-center gap-2 text-xs text-cyan-200"><RotateCcw size={12} />Ouvir saudação</button>}
        {pendingActions && <button onClick={onChat} className="mt-3 inline-flex items-center gap-2 text-xs text-amber-200">Há uma alteração para confirmar no chat<ArrowUpRight size={13} /></button>}
      </div>
    </main>
    <footer className={styles.footer}>
      <div className="flex items-center justify-center gap-4">
        <button onClick={onChat} className={styles.secondaryButton}><MessageSquare size={16} /><span>Escrever</span></button>
        <button aria-label={listening ? "Terminar pergunta" : "Falar com o assistente"} aria-pressed={listening} disabled={!supported || busy} onClick={() => listening ? recRef.current?.stop() : startListening()} className={cn(styles.micButton, listening && styles.micActive)}><span className={styles.micHalo} style={{ transform: `scale(${1 + (listening ? level : 0) * 0.45})` }} />{listening ? <MicOff size={25} /> : <Mic size={25} />}</button>
        <button onClick={interrupt} disabled={!speaking && !greetingActive} className={styles.secondaryButton}><Square size={15} /><span>Parar voz</span></button>
      </div>
      <p className="mt-4 text-xs text-slate-400">{listening ? "Toca para terminar a pergunta" : busy ? "A preparar a resposta" : "Toca no microfone para falar"}</p>
      <div className={styles.footerMeta}><span>Português · PT</span><span>Voz gerada por IA</span><span>ESC para fechar</span></div>
    </footer>
  </div>;
}
