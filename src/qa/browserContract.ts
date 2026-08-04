import packageJson from "../../package.json";
import { inkAudio } from "../audio/inkAudio.ts";
import { getRunCapabilities } from "../sdk/runSdk.ts";
import { store, type Overlay } from "../state/store.ts";

/**
 * A shelf control's box, in **CSS pixels relative to the canvas**.
 *
 * Deliberately not design units: every consumer is an automation script that
 * needs to dispatch a pointer event, and making each of them re-derive the
 * design scale is how they end up hard-coding coordinates that rot the next
 * time the layout changes.
 */
export interface QaShelfSlot {
    kind: string;
    /** Ink slot index, or -1 for a tool. */
    index: number;
    x: number;
    y: number;
    width: number;
    height: number;
}

/** The sheet's box, in CSS pixels relative to the canvas. */
export interface QaPageRect {
    x: number;
    y: number;
    width: number;
    height: number;
    /** Top of the shelf plank, so dead wood below the controls is measurable. */
    shelfTop: number;
    /** Bottom-most edge of any shelf control. */
    shelfContentBottom: number;
    /** Host-reported bottom inset, which the plank legitimately reserves. */
    safeBottom: number;
}

/**
 * A locked bottle's badge: the pill, and the number drawn on it.
 *
 * Both boxes, because the interesting failure is not where the badge is but
 * whether the number fits inside it. That has gone wrong twice — a disc
 * narrower than a two-digit gate, then a pill shorter than the digits' line
 * box — and neither time was visible to anything but a human looking closely.
 * All boxes are canvas-relative CSS pixels.
 */
export interface QaLockBadge {
    /** Ink slot index. */
    index: number;
    pill: { x: number; y: number; width: number; height: number };
    text: { x: number; y: number; width: number; height: number };
}

interface InkbloomQa {
    snapshot(): Record<string, unknown>;
    /** Live shelf geometry, or an empty list when the page is not open. */
    shelfSlots(): QaShelfSlot[];
    /** Where the sheet actually is, so scripted strokes land on it. */
    pageRect(): QaPageRect | null;
    /** Pill and number boxes for every locked bottle currently on the shelf. */
    lockBadges(): QaLockBadge[];
    /** Simulation vitals, or null when the page is not open. */
    simProbe(): QaSimProbe | null;
    openPage(): void;
    openPanel(overlay: Overlay): void;
    returnToTitle(): void;
    /** Open the borrow offer for a slot, to screenshot and assert the surface. */
    openBorrowOffer(slot: number): void;
    /**
     * Sample the master output and report spectral flatness and centroid.
     *
     * Flatness is 1.0 for white noise and falls toward 0 as a signal becomes
     * tonal, so it is a direct measurement of "this sounds like noise".
     */
    measureAudio(ms: number): Promise<{ flatness: number; centroid: number; samples: number; power: number } | null>;
}

declare global {
    // Development-only semantic browser contract. Never present in production.
    var __gameQa: InkbloomQa | undefined;
}

/**
 * A stable surface for headless visual QA to drive the game without hunting for
 * pixels. It may set up local navigation state and nothing else: it can never
 * fabricate a discovery, a purchase, an ad reward, or an entitlement.
 */
let shelfSlotSource: (() => QaShelfSlot[]) | null = null;
let pageRectSource: (() => QaPageRect) | null = null;
let lockBadgeSource: (() => QaLockBadge[]) | null = null;

/**
 * Let the Pixi scene publish its shelf geometry for automated checks.
 *
 * Overlapping controls are invisible to a screenshot diff and obvious to
 * arithmetic, so the layout exposes its boxes rather than relying on someone
 * noticing. A no-op unless the QA contract is installed.
 */
export function publishShelfSlots(source: (() => QaShelfSlot[]) | null): void {
    shelfSlotSource = source;
}

/**
 * Let the Pixi scene publish where the sheet is.
 *
 * Scripted strokes used to be placed at fixed fractions of the *viewport*,
 * which meant that growing the shelf silently moved the page out from under
 * them: the taps landed on wood, nothing was painted, and the run still looked
 * like it had exercised the simulation.
 */
export function publishPageRect(source: (() => QaPageRect) | null): void {
    pageRectSource = source;
}

/** Let the Pixi scene publish its lock badges, pill and number both. */
export function publishLockBadges(source: (() => QaLockBadge[]) | null): void {
    lockBadgeSource = source;
}

/** Simulation vitals for automation: step counter and live cells. */
export interface QaSimProbe {
    tick: number;
    liveCount: number;
}

let simProbeSource: (() => QaSimProbe) | null = null;

/**
 * Let the scene publish the simulation's step counter.
 *
 * "The page looks frozen" and "the page is running at a crawl" are identical
 * in any single screenshot; two probe reads a second apart tell them apart
 * and put a number on the crawl.
 */
export function publishSimProbe(source: (() => QaSimProbe) | null): void {
    simProbeSource = source;
}

export function installBrowserQaContract(): void {
    if (!import.meta.env.DEV || new URLSearchParams(window.location.search).get("qa") !== "1") return;
    document.documentElement.dataset.qaContract = "ready";
    globalThis.__gameQa = {
        snapshot() {
            const state = store.get();
            return {
                version: packageJson.version,
                phase: state.phase,
                menuScreen: state.menuScreen,
                overlay: state.overlay,
                paused: state.paused,
                discoveries: state.discoveryCount,
                selectedInk: state.selectedInk,
                paper: state.paper,
                ownsKit: state.ownsKit,
                potNudges: state.potNudges,
                borrowedInk: state.borrowedInk,
                borrowOffer: state.borrowOffer,
                pageStirring: state.pageStirring,
                folioCount: state.folio.length,
                renderer: document.documentElement.dataset.renderer ?? "pending",
                host: getRunCapabilities().host,
                audio: inkAudio.debugSnapshot(),
            };
        },
        shelfSlots() {
            return shelfSlotSource?.() ?? [];
        },
        pageRect() {
            return pageRectSource?.() ?? null;
        },
        lockBadges() {
            return lockBadgeSource?.() ?? [];
        },
        simProbe() {
            return simProbeSource?.() ?? null;
        },
        openPage() {
            store.patch({ phase: "playing", overlay: "none" });
        },
        openPanel(overlay) {
            store.patch({ phase: "playing", overlay });
        },
        returnToTitle() {
            store.patch({ phase: "menu", menuScreen: "title", overlay: "none" });
        },
        async measureAudio(ms) {
            const analyser = inkAudio.debugAttachAnalyser();
            if (!analyser) return null;
            // The floor has to sit well below anything audible. A -95dB gate
            // with a 64-bin minimum looked reasonable and measured nothing
            // once the mix stopped being broadband hiss — the gate only ever
            // passed the signal it was meant to detect.
            analyser.minDecibels = -140;
            analyser.maxDecibels = 0;
            const bins = new Float32Array(analyser.frequencyBinCount);
            const nyquist = analyser.context.sampleRate / 2;
            let flatnessTotal = 0;
            let centroidTotal = 0;
            let powerTotal = 0;
            let samples = 0;
            const deadline = performance.now() + ms;
            while (performance.now() < deadline) {
                await new Promise((resolve) => setTimeout(resolve, 24));
                analyser.getFloatFrequencyData(bins);
                // Flatness is defined over the whole spectrum, so every bin
                // counts and a floor is applied rather than a filter.
                let logSum = 0;
                let linearSum = 0;
                let weighted = 0;
                let counted = 0;
                for (let bin = 1; bin < bins.length; bin++) {
                    const db = bins[bin] ?? -140;
                    const power = 10 ** ((Number.isFinite(db) ? Math.max(-140, db) : -140) / 10);
                    logSum += Math.log(power);
                    linearSum += power;
                    weighted += power * ((bin / bins.length) * nyquist);
                    counted++;
                }
                // Only loud windows count. A quiet one measures the analyser's
                // own floor, which is perfectly flat and says nothing about the
                // mix — and averaging those in is how a silent page reads as
                // hiss. `samples` then tells the caller whether the scenario
                // ever actually made a sound.
                if (counted === 0 || linearSum / counted < 1e-9) continue;
                flatnessTotal += Math.exp(logSum / counted) / (linearSum / counted);
                centroidTotal += weighted / linearSum;
                powerTotal += linearSum / counted;
                samples++;
            }
            analyser.disconnect();
            return samples === 0
                ? { flatness: 0, centroid: 0, samples: 0, power: 0 }
                : {
                      flatness: flatnessTotal / samples,
                      centroid: centroidTotal / samples,
                      power: powerTotal / samples,
                      samples,
                  };
        },
        openBorrowOffer(slot) {
            // Navigation only. It cannot grant the loan — that still needs a
            // rewarded video the host confirmed.
            store.patch({ phase: "playing", overlay: "none", borrowOffer: slot });
        },
    };
}
