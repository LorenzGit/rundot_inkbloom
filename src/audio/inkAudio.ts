/**
 * The sound of a quiet room and a working pen.
 *
 * Everything is synthesised — no audio files ship — because the game's sounds
 * are all textures rather than melodies: a nib dragging on rag paper, water
 * finding a level, a fire ticking, a gilt star being stamped into the page.
 *
 * Three buses under one limiter: an ambient bed, one-shot cues, and a
 * continuous *page voice* whose level follows how busy the simulation is. That
 * last one is what makes a burning page feel loud and a settled page feel calm
 * without a single scripted cue.
 *
 * Lifecycle rules inherited from the RUN template and kept intentionally:
 * host pause, page visibility, and ad overlays each suspend audio
 * independently of the player's persisted mute and volume settings.
 */
import { NoiseRandom } from "../game/noiseRandom.ts";
import { store } from "../state/store.ts";

export type SfxCue = "tap" | "select" | "deny" | "discovery" | "unlock" | "tear" | "reward" | "error";

export interface AudioDebugSnapshot {
    contextState: AudioContextState | "locked";
    ambientRunning: boolean;
    ambientStep: number;
    activeVoices: number;
    suppressedCues: number;
    pageVoiceGain: number;
}

/**
 * A slow modal figure in D dorian. It is deliberately sparse: three or four
 * notes a bar with long rests, so it reads as a room someone is working in
 * rather than a soundtrack.
 */
const AMBIENT_STEP_SECONDS = 60 / 52 / 2;
const SCHEDULE_AHEAD_SECONDS = 0.4;
const DRONES = [73.42, 110.0, 98.0, 82.41] as const;
const FIGURE: readonly (number | null)[] = [
    0,
    null,
    null,
    2,
    null,
    4,
    null,
    null,
    3,
    null,
    null,
    1,
    null,
    2,
    null,
    null,
];
const SCALE = [293.66, 329.63, 392.0, 440.0, 587.33] as const;

const CUE_COOLDOWN_MS: Record<SfxCue, number> = {
    tap: 45,
    select: 40,
    deny: 180,
    discovery: 220,
    unlock: 300,
    tear: 260,
    reward: 260,
    error: 220,
};

class InkAudio {
    private context: AudioContext | null = null;
    private master: GainNode | null = null;
    private ambientBus: GainNode | null = null;
    private cueBus: GainNode | null = null;
    private pageBus: GainNode | null = null;
    private noise: AudioBuffer | null = null;

    private ambientTimer = 0;
    private ambientStep = 0;
    private nextAmbientTime = 0;

    private voices = new Set<AudioScheduledSourceNode>();
    private lastCueAt = new Map<SfxCue, number>();
    private lastScratchAt = 0;
    private lastCrackleAt = 0;
    private suppressedCues = 0;

    private paused = false;
    private hostPaused = false;
    private adVisible = false;
    private pageHidden = document.visibilityState !== "visible";
    private bound = false;
    private pageVoiceTarget = 0;

    bind(): void {
        if (this.bound) return;
        this.bound = true;
        store.subscribe(() => this.sync());
        document.addEventListener("visibilitychange", () => {
            this.pageHidden = document.visibilityState !== "visible";
            this.applyPauseState();
        });
    }

    async unlock(): Promise<boolean> {
        try {
            this.ensureGraph();
            if (!this.context || this.paused) return false;
            if (this.context.state === "suspended") await this.context.resume();
            this.sync();
            return this.context.state === "running";
        } catch (error) {
            console.warn("[audio] WebAudio unavailable", error);
            return false;
        }
    }

    setPaused(paused: boolean): void {
        this.hostPaused = paused;
        this.applyPauseState();
    }

    /**
     * Ads do not reliably emit host lifecycle events, so their interruption is
     * tracked separately and never written to the player's saved settings.
     */
    setAdVisible(visible: boolean): void {
        this.adVisible = visible;
        this.applyPauseState();
    }

    // ------------------------------------------------------------- one-shots

    play(cue: SfxCue): void {
        const state = store.get();
        if (!this.context || !this.cueBus || this.paused || !state.sfxEnabled || state.sfxVolume <= 0) return;
        const now = performance.now();
        if (now - (this.lastCueAt.get(cue) ?? Number.NEGATIVE_INFINITY) < CUE_COOLDOWN_MS[cue]) {
            this.suppressedCues += 1;
            return;
        }
        this.lastCueAt.set(cue, now);
        const at = this.context.currentTime;

        switch (cue) {
            case "tap":
                this.burst(0.03, 900, 3, 0.04, 1.2, at);
                break;
            case "select":
                this.tone(322, 0.07, 0.05, "sine", at, this.cueBus);
                this.burst(0.02, 1_400, 4, 0.02, 1.4, at);
                break;
            case "deny":
                this.tone(172, 0.1, 0.045, "sine", at, this.cueBus);
                break;
            case "discovery":
                // A gilt star pressed into the page: struck, then two overtones.
                this.tone(659.25, 0.72, 0.1, "sine", at, this.cueBus);
                this.tone(987.77, 0.86, 0.055, "sine", at + 0.09, this.cueBus);
                this.tone(1_318.5, 0.52, 0.02, "triangle", at + 0.1, this.cueBus);
                break;
            case "unlock":
                this.tone(523.25, 0.4, 0.075, "sine", at, this.cueBus);
                this.tone(659.25, 0.4, 0.075, "sine", at + 0.12, this.cueBus);
                this.tone(783.99, 0.72, 0.075, "sine", at + 0.24, this.cueBus);
                break;
            case "tear":
                // Two rips: the fibres letting go, then the sheet coming free.
                this.burst(0.26, 640, 0.5, 0.11, 1.6, at);
                this.burst(0.2, 1_450, 0.8, 0.06, 2.3, at + 0.05);
                break;
            case "reward":
                this.tone(392, 0.26, 0.07, "triangle", at, this.cueBus);
                this.tone(587.33, 0.36, 0.06, "sine", at + 0.1, this.cueBus);
                break;
            case "error":
                this.tone(146.83, 0.18, 0.05, "triangle", at, this.cueBus);
                break;
        }
    }

    /**
     * The nib on paper. Called from the paint loop with how far the stroke
     * travelled, and rate-limited hard — a continuous drag must sound like one
     * continuous scrape, not a machine gun of grains.
     */
    scratch(distance: number): void {
        const state = store.get();
        if (!this.context || this.paused || !state.sfxEnabled || state.sfxVolume <= 0) return;
        const now = performance.now();
        if (now - this.lastScratchAt < 70) return;
        this.lastScratchAt = now;
        const spread = this.jitter();
        this.burst(
            0.09,
            800 + spread * 700,
            0.7,
            Math.min(0.05, 0.015 + distance * 0.002),
            0.7 + spread * 0.5,
            this.context.currentTime,
        );
    }

    /** Ember hitting the page — a fizz rather than a scrape. */
    fizz(): void {
        const state = store.get();
        if (!this.context || this.paused || !state.sfxEnabled || state.sfxVolume <= 0) return;
        this.burst(0.14, 2_200 + this.jitter() * 600, 1.2, 0.028, 1, this.context.currentTime);
    }

    /**
     * Fire crackle density, driven straight from the simulation's burning cell
     * count. A small ember ticks; a page-wide wildfire roars.
     */
    setFireDensity(burningCells: number): void {
        const state = store.get();
        if (!this.context || this.paused || !state.sfxEnabled || state.sfxVolume <= 0) return;
        if (burningCells <= 0) return;
        const now = performance.now();
        const interval = Math.max(28, 240 - burningCells * 1.6);
        if (now - this.lastCrackleAt < interval) return;
        this.lastCrackleAt = now;
        this.burst(0.035, 350 + this.jitter() * 400, 2.5, 0.03, 1, this.context.currentTime);
    }

    /**
     * How alive the page is, 0..1. Opens a gentle filtered bed so a busy sheet
     * has presence without any explicit cue.
     */
    setPageActivity(activity: number): void {
        this.pageVoiceTarget = Math.max(0, Math.min(1, activity));
        if (!this.context || !this.pageBus) return;
        const target = this.paused ? 0 : this.pageVoiceTarget * 0.1;
        this.pageBus.gain.setTargetAtTime(target, this.context.currentTime, 0.35);
    }

    debugSnapshot(): AudioDebugSnapshot {
        return {
            contextState: this.context?.state ?? "locked",
            ambientRunning: this.ambientTimer !== 0,
            ambientStep: this.ambientStep,
            activeVoices: this.voices.size,
            suppressedCues: this.suppressedCues,
            pageVoiceGain: this.pageVoiceTarget,
        };
    }

    // -------------------------------------------------------------- internals

    private jitter(): number {
        return this.noiseSource.nextDouble();
    }

    private noiseSource = new NoiseRandom(0x0bad_c0de, 0);

    private applyPauseState(): void {
        this.paused = this.hostPaused || this.pageHidden || this.adVisible;
        if (!this.context) return;
        if (this.paused) {
            this.stopAmbient();
            void this.context.suspend().catch(() => undefined);
        } else {
            void this.context
                .resume()
                .then(() => this.sync())
                .catch(() => undefined);
        }
    }

    private ensureGraph(): void {
        if (this.context) return;
        const AudioContextCtor = window.AudioContext;
        if (!AudioContextCtor) return;
        this.context = new AudioContextCtor();
        this.master = this.context.createGain();
        this.ambientBus = this.context.createGain();
        this.cueBus = this.context.createGain();
        this.pageBus = this.context.createGain();
        this.pageBus.gain.value = 0;

        const limiter = this.context.createDynamicsCompressor();
        limiter.threshold.value = -20;
        limiter.knee.value = 18;
        limiter.ratio.value = 4;
        limiter.attack.value = 0.004;
        limiter.release.value = 0.24;

        this.ambientBus.connect(this.master);
        this.cueBus.connect(this.master);

        // The page voice is filtered noise: the room tone of a wet sheet.
        const pageFilter = this.context.createBiquadFilter();
        pageFilter.type = "bandpass";
        pageFilter.frequency.value = 520;
        pageFilter.Q.value = 0.6;
        this.pageBus.connect(pageFilter).connect(this.master);
        this.master.connect(limiter).connect(this.context.destination);

        this.noise = this.createNoiseBuffer(this.context);
        this.startPageVoice();
    }

    /** Deterministic noise, so the texture is identical on every device. */
    private createNoiseBuffer(context: AudioContext): AudioBuffer {
        const frames = Math.max(1, Math.round(context.sampleRate));
        const buffer = context.createBuffer(1, frames, context.sampleRate);
        const data = buffer.getChannelData(0);
        const random = new NoiseRandom(0x5ea1_1eaf, 0);
        for (let i = 0; i < frames; i++) data[i] = random.nextDouble() * 2 - 1;
        return buffer;
    }

    private startPageVoice(): void {
        if (!this.context || !this.noise || !this.pageBus) return;
        const source = this.context.createBufferSource();
        source.buffer = this.noise;
        source.loop = true;
        source.playbackRate.value = 0.22;
        source.connect(this.pageBus);
        source.start();
        // Intentionally never tracked for stop: this is the one permanent
        // source, gated entirely by pageBus gain and context suspension.
    }

    private sync(): void {
        if (!this.context || !this.master || !this.ambientBus || !this.cueBus) return;
        const state = store.get();
        const now = this.context.currentTime;
        this.ambientBus.gain.setTargetAtTime(state.musicEnabled ? state.musicVolume : 0, now, 0.16);
        this.cueBus.gain.setTargetAtTime(state.sfxEnabled ? state.sfxVolume : 0, now, 0.03);
        this.master.gain.setTargetAtTime(this.paused ? 0 : 0.6, now, 0.08);
        if (!state.sfxEnabled || state.sfxVolume <= 0) this.setPageActivity(0);
        if (state.musicEnabled && state.musicVolume > 0 && !this.paused && this.context.state === "running") {
            this.startAmbient();
        } else {
            this.stopAmbient();
        }
    }

    private startAmbient(): void {
        if (!this.context || !this.ambientBus || this.ambientTimer !== 0) return;
        this.nextAmbientTime = this.context.currentTime + 0.08;
        this.scheduleAmbient();
        this.ambientTimer = window.setInterval(() => this.scheduleAmbient(), 110);
    }

    private scheduleAmbient(): void {
        if (!this.context || !this.ambientBus || this.paused) return;
        while (this.nextAmbientTime < this.context.currentTime + SCHEDULE_AHEAD_SECONDS) {
            const position = this.ambientStep % FIGURE.length;
            const drone = DRONES[Math.floor(this.ambientStep / FIGURE.length) % DRONES.length] ?? DRONES[0];
            if (position === 0) this.tone(drone, 4.6, 0.014, "sine", this.nextAmbientTime, this.ambientBus, 620);
            const degree = FIGURE[position];
            if (degree !== null && degree !== undefined) {
                const note = SCALE[degree] ?? SCALE[0];
                this.tone(note, 1.5, 0.02, "sine", this.nextAmbientTime, this.ambientBus, 1_300);
                this.tone(note * 2, 0.7, 0.004, "triangle", this.nextAmbientTime, this.ambientBus, 1_800);
            }
            this.ambientStep += 1;
            this.nextAmbientTime += AMBIENT_STEP_SECONDS;
        }
    }

    private stopAmbient(): void {
        if (this.ambientTimer) window.clearInterval(this.ambientTimer);
        this.ambientTimer = 0;
        if (!this.context) return;
        const stopAt = this.context.currentTime + 0.1;
        for (const voice of this.voices) {
            try {
                voice.stop(stopAt);
            } catch {
                /* already stopped */
            }
        }
    }

    private tone(
        frequency: number,
        duration: number,
        peak: number,
        type: OscillatorType,
        startAt: number,
        destination: GainNode,
        cutoff?: number,
    ): void {
        if (!this.context) return;
        const oscillator = this.context.createOscillator();
        const envelope = this.context.createGain();
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, startAt);
        envelope.gain.setValueAtTime(0.0001, startAt);
        envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), startAt + 0.02);
        envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

        let filter: BiquadFilterNode | null = null;
        if (cutoff !== undefined) {
            filter = this.context.createBiquadFilter();
            filter.type = "lowpass";
            filter.frequency.setValueAtTime(cutoff, startAt);
            filter.Q.value = 0.4;
            oscillator.connect(filter).connect(envelope).connect(destination);
        } else {
            oscillator.connect(envelope).connect(destination);
        }
        this.track(oscillator, () => {
            envelope.disconnect();
            filter?.disconnect();
        });
        oscillator.start(startAt);
        oscillator.stop(startAt + duration + 0.03);
    }

    private burst(duration: number, frequency: number, q: number, peak: number, rate: number, startAt: number): void {
        if (!this.context || !this.noise || !this.cueBus) return;
        const source = this.context.createBufferSource();
        source.buffer = this.noise;
        source.loop = true;
        source.playbackRate.value = rate;
        const filter = this.context.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.value = frequency;
        filter.Q.value = q;
        const envelope = this.context.createGain();
        envelope.gain.setValueAtTime(Math.max(0.0002, peak), startAt);
        envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
        source.connect(filter).connect(envelope).connect(this.cueBus);
        this.track(source, () => {
            filter.disconnect();
            envelope.disconnect();
        });
        source.start(startAt);
        source.stop(startAt + duration + 0.02);
    }

    private track(node: AudioScheduledSourceNode, cleanup: () => void): void {
        this.voices.add(node);
        node.addEventListener(
            "ended",
            () => {
                this.voices.delete(node);
                node.disconnect();
                cleanup();
            },
            { once: true },
        );
    }
}

export const inkAudio = new InkAudio();
