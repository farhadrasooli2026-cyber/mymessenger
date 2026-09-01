"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { voiceSequential } from "@/lib/voice";

type PlayFn = () => Promise<void> | void;

type VoiceQueueValue = {
  register: (id: string, play: PlayFn) => void;
  unregister: (id: string) => void;
  ended: (id: string) => void;
  autoPlay: boolean;
  sequential: boolean;
  setAutoPlay: (v: boolean) => void;
  setSequential: (v: boolean) => void;
};

const VoiceQueueCtx = createContext<VoiceQueueValue | null>(null);

export function VoiceQueueProvider({ children }: { children: ReactNode }) {
  const map = useRef(new Map<string, PlayFn>());
  const order = useRef<string[]>([]);
  const [autoPlay, setAutoPlayState] = useState(false);
  const [sequential, setSequentialState] = useState(true);

  const register = useCallback((id: string, play: PlayFn) => {
    map.current.set(id, play);
    if (!order.current.includes(id)) order.current.push(id);
  }, []);

  const unregister = useCallback((id: string) => {
    map.current.delete(id);
    order.current = order.current.filter((x) => x !== id);
  }, []);

  const ended = useCallback(
    (id: string) => {
      const seqOn = sequential || voiceSequential();
      if (!seqOn) return;
      const idx = order.current.indexOf(id);
      const nextId = idx >= 0 ? order.current[idx + 1] : undefined;
      if (!nextId) return;
      const play = map.current.get(nextId);
      void play?.();
    },
    [sequential],
  );

  const value = useMemo(
    () => ({
      register,
      unregister,
      ended,
      autoPlay,
      sequential,
      setAutoPlay: setAutoPlayState,
      setSequential: setSequentialState,
    }),
    [register, unregister, ended, autoPlay, sequential],
  );

  return <VoiceQueueCtx.Provider value={value}>{children}</VoiceQueueCtx.Provider>;
}

export function useVoiceQueue() {
  return useContext(VoiceQueueCtx);
}
