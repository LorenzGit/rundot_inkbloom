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
    /** True once the page has been silenced and nothing continuous is running. */
    pageSilent: boolean;
}

/**
 * How many synthesised voices may sound at once.
 *
 * There was no cap, and a burning page under a moving finger is a stream of
 * crackles, a stream of stroke noise and a run of discovery chimes all at the
 * same time. Thirty overlapping noise bursts do not sound like a big fire —
 * they sound like static, and the limiter can only flatten the result, not
 * separate it. Past the cap a voice is dropped rather than queued: a sound
 * that arrives late is worse than one that never arrives.
 */
const MAX_VOICES = 14;

/**
 * The floor on the gap between fire crackles.
 *
 * Intensity is carried by how loud and how low each crackle is, not by how
 * many of them there are. Rate alone converges on white noise: past roughly
 * twenty a second the ear stops hearing events and starts hearing hiss.
 */
const MIN_CRACKLE_GAP_MS = 55;

/** One rate limit for every continuous stroke sound, so none can be forgotten. */
const STROKE_GAP_MS = 70;

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

/**
 * Minimum gap between two of the same cue.
 *
 * `discovery` is the long one and it is deliberately longer than it looks like
 * it needs to be: the chime is three tones with tails up to 0.86s, and a
 * wildfire can turn over half a dozen secrets in a second. At the old 220ms
 * four chime stacks overlapped into a chord nobody wrote.
 */
const CUE_COOLDOWN_MS: Record<SfxCue, number> = {
    tap: 45,
    select: 40,
    deny: 180,
    discovery: 400,
    unlock: 300,
    tear: 260,
    reward: 320,
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
    /**
     * The subset of voices the *page* is making.
     *
     * Tracked separately so leaving the sheet can cut them without touching the
     * ambient bed or a menu tap that is still ringing — the music is supposed
     * to follow the player out to the title screen.
     */
    private pageVoices = new Set<AudioScheduledSourceNode>();
    private lastCueAt = new Map<SfxCue, number>();
    private lastStrokeAt = 0;
    private lastCrackleAt = 0;
    private suppressedCues = 0;

    /**
     * True while the page is torn down — between leaving the sheet and opening
     * it again.
     *
     * The page voice is a *permanent* looping source gated only by a bus gain,
     * so nothing about destroying the Pixi scene stopped it: the bed kept
     * droning at whatever level the page was at when the player left, all the
     * way through the main menu. Continuous page sound is gated on this rather
     * than on any caller remembering to wind it down.
     */
    private pageSilent = true;

    private paused = false;
    private hostPaused = false;
    private hostOverlayVisible = false;
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
            if (this.context.state === "suspended") {
                // WebKit leaves resume() pending FOREVER when the call is not
                // backed by recognized user activation. Never let that hang a
                // caller — UI actions may await unlock before proceeding.
                await Promise.race([
                    this.context.resume(),
                    new Promise<void>((resolve) => window.setTimeout(resolve, 300)),
                ]);
            }
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

    /** Host-owned ads and checkout sheets are independent of lifecycle pause. */
    setHostOverlayVisible(visible: boolean): void {
        this.hostOverlayVisible = visible;
        this.applyPauseState();
    }

    // ------------------------------------------------------------- one-shots

    /**
     * `options.lift` transposes the cue by that many semitones. Only the
     * discovery chime uses it: each find strikes a different degree of the
     * same key, so a session of discoveries plays a slow melody instead of
     * the same stamp sixty times.
     */
    play(cue: SfxCue, options?: { lift?: number }): void {
        const state = store.get();
        if (!this.context || !this.cueBus || this.paused || !state.sfxEnabled || state.sfxVolume <= 0) return;
        const now = performance.now();
        if (now - (this.lastCueAt.get(cue) ?? Number.NEGATIVE_INFINITY) < CUE_COOLDOWN_MS[cue]) {
            this.suppressedCues += 1;
            return;
        }
        this.lastCueAt.set(cue, now);
        const at = this.context.currentTime;
        const ratio = 2 ** ((options?.lift ?? 0) / 12);

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
                this.tone(659.25 * ratio, 0.72, 0.1, "sine", at, this.cueBus);
                this.tone(987.77 * ratio, 0.86, 0.055, "sine", at + 0.09, this.cueBus);
                this.tone(1_318.5 * ratio, 0.52, 0.02, "triangle", at + 0.1, this.cueBus);
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
     * The sound of a stroke being drawn: the nib on paper, or an ember fizzing.
     *
     * Both go through one entry point on purpose. They were separate methods,
     * `scratch` was rate-limited and `fizz` was not, and pointermove fires at
     * 60-120Hz — so painting with ember was a machine gun of noise bursts while
     * painting with anything else was a scrape. Sharing the limiter is the only
     * way a future third stroke sound cannot repeat that.
     */
    stroke(kind: "nib" | "fizz", distance: number): void {
        const state = store.get();
        if (!this.context || this.paused || this.pageSilent) return;
        if (!state.sfxEnabled || state.sfxVolume <= 0) return;
        const now = performance.now();
        if (now - this.lastStrokeAt < STROKE_GAP_MS) return;
        this.lastStrokeAt = now;
        const spread = this.jitter();
        const at = this.context.currentTime;
        if (kind === "fizz") {
            // An ember landing on paper: a short bright crack that falls away,
            // not a 140ms wash of top end.
            this.burst(0.055, 2_600 + spread * 500, 5, 0.03, 1, at, "page", 900);
            if (this.cueBus) this.tone(180 + spread * 40, 0.06, 0.02, "triangle", at, this.cueBus, 900);
            return;
        }
        // A nib catches paper fibre by fibre. Each catch is a short resonant
        // tick at its own pitch — which is why the centre frequency moves per
        // stroke — and the run of them reads as a scrape. The old version was a
        // 90ms band at Q 0.7, which is to say ninety milliseconds of hiss,
        // repeated every seventy.
        this.burst(
            0.032,
            620 + spread * 900,
            8,
            Math.min(0.045, 0.016 + distance * 0.002),
            0.8 + spread * 0.4,
            at,
            "page",
            420 + spread * 260,
        );
    }

    /**
     * Fire crackle density, driven straight from the simulation's burning cell
     * count. A small ember ticks; a page-wide wildfire roars.
     */
    setFireDensity(burningCells: number): void {
        const state = store.get();
        if (!this.context || this.paused || this.pageSilent) return;
        if (!state.sfxEnabled || state.sfxVolume <= 0) return;
        if (burningCells <= 0) return;
        const now = performance.now();
        const interval = Math.max(MIN_CRACKLE_GAP_MS, 240 - burningCells * 1.6);
        if (now - this.lastCrackleAt < interval) return;
        this.lastCrackleAt = now;
        // Past the rate floor, a bigger fire gets *bigger crackles* rather than
        // more of them: longer, louder, and lower. More events per second is
        // how a fire turns into hiss.
        // A crackle is an impulse: a resin pocket letting go. Short, resonant,
        // and pitched — never a band of noise held open, which is what a long
        // low-Q burst is. Size raises the level and drops the pitch; it does
        // not lengthen the sound, because a longer noise burst is just hiss.
        const size = Math.min(1, burningCells / 220);
        const spread = this.jitter();
        this.burst(
            0.02 + size * 0.014,
            520 - size * 180 + spread * 420,
            9,
            0.028 + size * 0.026,
            1,
            this.context.currentTime,
            "page",
            180 + spread * 120,
        );
    }

    /**
     * How alive the page is, 0..1. Opens a gentle filtered bed so a busy sheet
     * has presence without any explicit cue.
     */
    setPageActivity(activity: number): void {
        this.pageVoiceTarget = this.pageSilent ? 0 : Math.max(0, Math.min(1, activity));
        if (!this.context || !this.pageBus) return;
        const target = this.paused ? 0 : this.pageVoiceTarget * 0.05;
        this.pageBus.gain.setTargetAtTime(target, this.context.currentTime, 0.35);
    }

    /**
     * The sheet is open. Continuous page sound is allowed again.
     */
    openPage(): void {
        this.pageSilent = false;
    }

    /**
     * The sheet is gone — torn down, or the player went back to the menu.
     *
     * Winds the page voice down, stops every scheduled one-shot, and latches
     * `pageSilent` so a late call from a dying frame cannot start it again.
     * Menus keep their own taps and the ambient bed; what stops is everything
     * the *page* was making.
     */
    silencePage(): void {
        this.pageSilent = true;
        this.pageVoiceTarget = 0;
        this.lastCrackleAt = 0;
        this.lastStrokeAt = 0;
        if (!this.context) return;
        this.pageBus?.gain.setTargetAtTime(0, this.context.currentTime, 0.08);
        this.stopVoices();
    }

    /**
     * Attach an analyser to the master output and report what the game
     * actually sounds like.
     *
     * **Spectral flatness** is the number that matters: it is the geometric
     * mean of the power spectrum over its arithmetic mean, so 1.0 is white
     * noise and values near 0 are tonal. "It sounds like noise" is not a
     * matter of taste — it is a flatness measurement, and it is the only way to
     * tell whether a change to the synthesis actually helped.
     *
     * Development only, and read-only: it taps the graph and changes nothing.
     */
    debugAttachAnalyser(): AnalyserNode | null {
        if (!import.meta.env.DEV || !this.context || !this.master) return null;
        const analyser = this.context.createAnalyser();
        analyser.fftSize = 2_048;
        analyser.smoothingTimeConstant = 0;
        this.master.connect(analyser);
        return analyser;
    }

    debugSnapshot(): AudioDebugSnapshot {
        return {
            contextState: this.context?.state ?? "locked",
            ambientRunning: this.ambientTimer !== 0,
            ambientStep: this.ambientStep,
            activeVoices: this.voices.size,
            suppressedCues: this.suppressedCues,
            pageVoiceGain: this.pageVoiceTarget,
            pageSilent: this.pageSilent,
        };
    }

    // -------------------------------------------------------------- internals

    private jitter(): number {
        return this.noiseSource.nextDouble();
    }

    private noiseSource = new NoiseRandom(0x0bad_c0de, 0);

    private applyPauseState(): void {
        this.paused = this.hostPaused || this.pageHidden || this.hostOverlayVisible;
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

        /*
         * The page voice is the room tone of a working sheet.
         *
         * It was a *bandpass* at Q 0.6, which is barely a filter at all — the
         * bed was effectively broadband noise held open whenever anything was
         * on the page, and that is the single loudest reason the game sounded
         * like static. A low lowpass turns the same source into a rumble the
         * ear reads as presence rather than as hiss, and the level is halved.
         */
        const pageFilter = this.context.createBiquadFilter();
        pageFilter.type = "lowpass";
        pageFilter.frequency.value = 260;
        pageFilter.Q.value = 0.9;
        this.pageBus.connect(pageFilter).connect(this.master);

        /*
         * Tone shaping across everything, before the limiter.
         *
         * The highpass keeps stacked bursts from building mud at the bottom;
         * the lowpass takes off the top octave, which is where noise stops
         * being a texture and starts being a hiss. Per-sound fixes cannot do
         * this job — it has to be the whole mix or the sounds stop matching.
         */
        const rumbleCut = this.context.createBiquadFilter();
        rumbleCut.type = "highpass";
        rumbleCut.frequency.value = 80;
        rumbleCut.Q.value = 0.7;
        const airCut = this.context.createBiquadFilter();
        airCut.type = "lowpass";
        airCut.frequency.value = 6_200;
        airCut.Q.value = 0.6;

        this.master.connect(rumbleCut).connect(airCut).connect(limiter).connect(this.context.destination);

        this.noise = this.createNoiseBuffer(this.context);
        this.startPageVoice();
    }

    /**
     * Deterministic **pink** noise, so the texture is identical on every device.
     *
     * It was white, which is the harshest spectrum there is: equal power in
     * every octave means most of the energy sits in the top two, and every
     * sound built on it read as hiss. Pink falls at 3dB per octave, which is
     * what paper, fire and rushing water actually do. This one change warms
     * every burst in the game, because they all draw from this buffer.
     *
     * Paul Kellet's filter approximation — cheap, and accurate to about 0.05dB
     * across the audible band.
     */
    private createNoiseBuffer(context: AudioContext): AudioBuffer {
        const frames = Math.max(1, Math.round(context.sampleRate));
        const buffer = context.createBuffer(1, frames, context.sampleRate);
        const data = buffer.getChannelData(0);
        const random = new NoiseRandom(0x5ea1_1eaf, 0);
        let b0 = 0;
        let b1 = 0;
        let b2 = 0;
        let b3 = 0;
        let b4 = 0;
        let b5 = 0;
        let b6 = 0;
        for (let i = 0; i < frames; i++) {
            const white = random.nextDouble() * 2 - 1;
            b0 = 0.99886 * b0 + white * 0.0555179;
            b1 = 0.99332 * b1 + white * 0.0750759;
            b2 = 0.969 * b2 + white * 0.153852;
            b3 = 0.8665 * b3 + white * 0.3104856;
            b4 = 0.55 * b4 + white * 0.5329522;
            b5 = -0.7616 * b5 - white * 0.016898;
            data[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
            b6 = white * 0.115926;
        }
        // Normalised rather than scaled by a constant. The filter's output
        // level is not the white input's, so a guessed constant silently
        // re-gains every sound in the game — the first attempt at this made
        // the whole mix roughly 12dB quieter and looked like a bug elsewhere.
        let peak = 0;
        for (let i = 0; i < frames; i++) {
            const magnitude = Math.abs(data[i] ?? 0);
            if (magnitude > peak) peak = magnitude;
        }
        if (peak > 0) {
            const scale = 0.92 / peak;
            for (let i = 0; i < frames; i++) data[i] = (data[i] ?? 0) * scale;
        }
        return buffer;
    }

    private startPageVoice(): void {
        if (!this.context || !this.noise || !this.pageBus) return;
        const source = this.context.createBufferSource();
        source.buffer = this.noise;
        source.loop = true;
        source.playbackRate.value = 0.18;
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
        if (!this.context || this.atVoiceLimit()) return;
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

    /**
     * A filtered noise event.
     *
     * `endFrequency` sweeps the filter over the life of the burst. That sweep
     * is most of the difference between a sound and a texture: a static band
     * of noise is a hiss no matter how short it is, while the same noise with
     * a falling filter is a fizz, a tick, or a pop. Every continuous sound in
     * the game now sweeps.
     */
    private burst(
        duration: number,
        frequency: number,
        q: number,
        peak: number,
        rate: number,
        startAt: number,
        owner: "cue" | "page" = "cue",
        endFrequency?: number,
    ): void {
        if (!this.context || !this.noise || !this.cueBus || this.atVoiceLimit()) return;
        const source = this.context.createBufferSource();
        source.buffer = this.noise;
        source.loop = true;
        source.playbackRate.value = rate;
        const filter = this.context.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.setValueAtTime(frequency, startAt);
        if (endFrequency !== undefined) {
            filter.frequency.exponentialRampToValueAtTime(Math.max(40, endFrequency), startAt + duration);
        }
        filter.Q.value = q;
        const envelope = this.context.createGain();
        envelope.gain.setValueAtTime(Math.max(0.0002, peak), startAt);
        envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
        source.connect(filter).connect(envelope).connect(this.cueBus);
        if (owner === "page") this.pageVoices.add(source);
        this.track(source, () => {
            this.pageVoices.delete(source);
            filter.disconnect();
            envelope.disconnect();
        });
        source.start(startAt);
        source.stop(startAt + duration + 0.02);
    }

    /** True when there is no room left in the voice budget. */
    private atVoiceLimit(): boolean {
        if (this.voices.size < MAX_VOICES) return false;
        this.suppressedCues += 1;
        return true;
    }

    /** Cut every one-shot the page is making. */
    private stopVoices(): void {
        for (const voice of [...this.pageVoices]) {
            try {
                voice.stop();
            } catch {
                /* already stopped; the ended handler will clean it up */
            }
        }
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
