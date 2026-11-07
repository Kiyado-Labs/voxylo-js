export type LevelSource = "agent" | "user" | "active";

export interface AnalyserLike {
  /** RMS of the current audio window, roughly 0..0.5 for real speech */
  read(): number;
  dispose(): void;
}

export interface AudioEnv {
  requestFrame(cb: (timeMs: number) => void): number;
  cancelFrame(id: number): void;
  createAnalyser(track: MediaStreamTrack): AnalyserLike | null;
}

export interface MicHold {
  /** Stops the permission stream; call once LiveKit's own mic track is live */
  release(): void;
}

export interface MediaEnv {
  /** Must run synchronously inside the user's click so Safari lets audio play */
  unlockAudio(): void;
  /** Starts the permission prompt synchronously; resolves once the mic is allowed */
  requestMic(): Promise<MicHold>;
  attachAudio(el: HTMLMediaElement): void;
  detachAudio(el: HTMLMediaElement): void;
}

export type BrowserEnv = AudioEnv & MediaEnv;

export interface LevelMonitor {
  setTrack(which: "agent" | "user", track: MediaStreamTrack | null): void;
  setUserMuted(muted: boolean): void;
  setAgentSpeaking(speaking: boolean): void;
  get(source: LevelSource): number;
  subscribe(source: LevelSource, fn: (level: number) => void): () => void;
  reset(): void;
}

// Byte-domain RMS of normal speech sits around 0.1; this maps it to 0.5
const GAIN = 5;
const ATTACK = 0.5;
const RELEASE = 0.15;
const EPSILON = 1e-4;

export function createLevelMonitor(env: AudioEnv): LevelMonitor {
  const analysers: Record<"agent" | "user", AnalyserLike | null> = { agent: null, user: null };
  const levels = { agent: 0, user: 0 };
  let userMuted = false;
  let agentSpeaking = false;
  let frameId: number | null = null;
  const subs = new Set<{ source: LevelSource; fn: (level: number) => void; last: number }>();

  const get = (source: LevelSource): number => {
    if (source === "agent") return levels.agent;
    if (source === "user") return userMuted ? 0 : levels.user;
    return agentSpeaking ? levels.agent : userMuted ? 0 : levels.user;
  };

  const emit = () => {
    for (const s of subs) {
      const v = get(s.source);
      if (Number.isNaN(s.last) || Math.abs(v - s.last) > EPSILON) {
        s.last = v;
        s.fn(v);
      }
    }
  };

  const smooth = (prev: number, target: number) => prev + (target - prev) * (target > prev ? ATTACK : RELEASE);

  const tick = () => {
    frameId = null;
    for (const which of ["agent", "user"] as const) {
      const a = analysers[which];
      if (!a) continue;
      const target = Math.min(1, a.read() * GAIN);
      levels[which] = Math.min(1, Math.max(0, smooth(levels[which], target)));
    }
    emit();
    schedule();
  };

  const schedule = () => {
    const active = subs.size > 0 && (analysers.agent !== null || analysers.user !== null);
    if (active && frameId === null) frameId = env.requestFrame(tick);
    if (!active && frameId !== null) {
      env.cancelFrame(frameId);
      frameId = null;
    }
  };

  return {
    setTrack(which, track) {
      analysers[which]?.dispose();
      analysers[which] = track ? env.createAnalyser(track) : null;
      if (!track) {
        levels[which] = 0;
        emit();
      }
      schedule();
    },
    setUserMuted(muted) {
      userMuted = muted;
      emit();
    },
    setAgentSpeaking(speaking) {
      agentSpeaking = speaking;
      emit();
    },
    get,
    subscribe(source, fn) {
      const sub = { source, fn, last: Number.NaN };
      subs.add(sub);
      schedule();
      return () => {
        subs.delete(sub);
        schedule();
      };
    },
    reset() {
      analysers.agent?.dispose();
      analysers.user?.dispose();
      analysers.agent = null;
      analysers.user = null;
      levels.agent = 0;
      levels.user = 0;
      agentSpeaking = false;
      userMuted = false;
      emit();
      schedule();
    },
  };
}

let sharedContext: AudioContext | null = null;

function audioContext(create: boolean): AudioContext | null {
  if (sharedContext || !create) return sharedContext;
  const Ctor =
    typeof window === "undefined"
      ? undefined
      : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!Ctor) return null;
  try {
    sharedContext = new Ctor();
  } catch {
    return null;
  }
  return sharedContext;
}

export function createBrowserEnv(): BrowserEnv {
  return {
    requestFrame: (cb) => requestAnimationFrame(cb),
    cancelFrame: (id) => cancelAnimationFrame(id),
    createAnalyser(track) {
      const ctx = audioContext(true);
      if (!ctx) return null;
      try {
        const source = ctx.createMediaStreamSource(new MediaStream([track]));
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        const buffer = new Uint8Array(analyser.fftSize);
        source.connect(analyser);
        return {
          read() {
            analyser.getByteTimeDomainData(buffer);
            let sum = 0;
            for (let i = 0; i < buffer.length; i++) {
              const v = ((buffer[i] ?? 128) - 128) / 128;
              sum += v * v;
            }
            return Math.sqrt(sum / buffer.length);
          },
          dispose() {
            source.disconnect();
            analyser.disconnect();
          },
        };
      } catch {
        return null;
      }
    },
    unlockAudio() {
      const ctx = audioContext(true);
      if (ctx && ctx.state !== "running") void ctx.resume().catch(() => {});
    },
    async requestMic() {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        throw new DOMException("Microphone is not available on this page", "NotAllowedError");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Kept open until LiveKit's mic is live: Firefox forgets a one-time "Allow" once the device is released
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          for (const t of stream.getTracks()) t.stop();
        },
      };
    },
    attachAudio(el) {
      el.style.display = "none";
      document.body.appendChild(el);
      void el.play?.().catch(() => {});
    },
    detachAudio(el) {
      el.remove();
    },
  };
}
