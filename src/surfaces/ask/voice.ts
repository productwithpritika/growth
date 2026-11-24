// Voice mode (Phase 4 §4.3): browser speech recognition for push-to-talk and hands-free, and
// speech synthesis for a short spoken answer. Everything degrades to text when the browser (or
// the frame the app runs in) doesn't allow it.
import { useCallback, useEffect, useRef, useState } from "react";

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}
type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechSupport() {
  return { listen: !!ctor(), speak: typeof window !== "undefined" && "speechSynthesis" in window };
}

export function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.05;
  window.speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

/** First sentence: what voice mode reads aloud before the details on screen. */
export function shortAnswer(text: string): string {
  const m = text.match(/^(.+?[.!?])(\s|$)/);
  return (m ? m[1] : text).slice(0, 220);
}

export function useVoice(onFinal: (text: string) => void) {
  const rec = useRef<Recognition | null>(null);
  const [listening, setListening] = useState<null | "ptt" | "hands-free">(null);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const finalRef = useRef(onFinal);
  const modeRef = useRef<null | "ptt" | "hands-free">(null);
  useEffect(() => {
    finalRef.current = onFinal;
  }, [onFinal]);

  const stop = useCallback(() => {
    modeRef.current = null;
    rec.current?.stop();
    setListening(null);
  }, []);

  const start = useCallback((mode: "ptt" | "hands-free") => {
    const C = ctor();
    if (!C) {
      setError("Voice input isn't available in this browser. Type instead; answers can still be read aloud.");
      return;
    }
    stopSpeaking();
    setError(null);
    setTranscript("");
    try {
      const r = new C();
      r.continuous = mode === "hands-free";
      r.interimResults = true;
      r.lang = "en-GB";
      r.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) {
            const text = res[0].transcript.trim();
            setTranscript(text);
            if (text) finalRef.current(text);
          } else interim += res[0].transcript;
        }
        if (interim) setTranscript(interim);
      };
      r.onerror = (e) => {
        setError(e.error === "not-allowed" ? "Microphone access was blocked. Allow it in the browser, or type instead." : `Voice stopped (${e.error}). Type instead, or try again.`);
        modeRef.current = null;
        setListening(null);
      };
      r.onend = () => {
        if (modeRef.current === "hands-free" && rec.current === r) {
          try {
            r.start();
            return;
          } catch {
            // fall through and stop
          }
        }
        modeRef.current = null;
        setListening(null);
      };
      rec.current = r;
      modeRef.current = mode;
      r.start();
      setListening(mode);
    } catch {
      setError("Voice input couldn't start here. Type instead.");
      modeRef.current = null;
      setListening(null);
    }
  }, []);

  useEffect(() => () => rec.current?.abort(), []);
  return { listening, transcript, error, start, stop, setError };
}
