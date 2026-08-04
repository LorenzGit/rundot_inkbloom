/**
 * Shared state between the React shell and the Pixi page.
 *
 * The Pixi scene never renders React and React never touches the simulation.
 * They meet here: the scene pushes discoveries, selection, and counts up; the
 * shell pushes settings, paper choice, and overlay routing down. Nothing
 * per-frame crosses this boundary — the scene writes only when something the
 * player would actually notice has changed.
 */
import { useSyncExternalStore } from "react";
import { DEFAULT_PAPER, type PaperId } from "../game/constants.ts";
import type { FolioEntry } from "../systems/folio.ts";

/** Full-screen destinations reachable from the title. */
export type MenuScreen = "title" | "shop" | "settings" | "stats";

/** Panels that open over the page without leaving it. */
export type Overlay = "none" | "notes" | "shop" | "settings" | "prompt";

export interface AppState {
    phase: "loading" | "menu" | "playing";
    loadProgress: number;
    paused: boolean;
    menuScreen: MenuScreen;
    /** Open panel while `phase === 'playing'`. */
    overlay: Overlay;

    /** Discovery ids that have been found, in the order they were found. */
    discoveries: string[];
    /** Cheap mirror of `discoveries.length` for render-hot selectors. */
    discoveryCount: number;
    /** Sheets torn off, and marks made — the player's record. */
    pagesTorn: number;
    strokes: number;
    /** Kept images of torn sheets, newest first. Persisted under its own key. */
    folio: FolioEntry[];
    /** The 60/60 ceremony has been shown. Saved, so it happens exactly once. */
    colophonSeen: boolean;
    /** The sixtieth secret just landed; the colophon should appear. Transient. */
    colophonPending: boolean;
    /** Currently selected shelf slot. */
    selectedInk: number;
    /** Large brush toggle. */
    largeBrush: boolean;
    /** Mirror painting, from the Illuminator's Kit. */
    mirrorBrush: boolean;

    /** Nudges the player has spent on still-unfound secrets. */
    revealedHints: string[];
    /** Today's nudge budget. */
    hintDay: string | null;
    freeHintUsed: boolean;
    hintsWatchedToday: number;

    /** Today's prompt and its state. */
    promptDay: string | null;
    promptId: string | null;
    promptSolved: boolean;
    /** The last day a prompt was actually kept — the streak's only authority. */
    promptLastKeptDay: string | null;
    promptStreak: number;

    /** Monetization state. Ownership is only ever set from a verified host reply. */
    ownsKit: boolean;
    paper: PaperId;
    kitOfferSeen: boolean;
    /**
     * Nudges bought in a pot and not yet spent.
     *
     * A cache of the server's consumable entitlement quantity, never a source
     * of truth: it is written only from a host reply, and a spend is not
     * allowed to happen until the server has confirmed the consume.
     */
    potNudges: number;

    /**
     * A shelf slot on loan from a rewarded video, for this sheet only.
     *
     * Deliberately absent from the save. A loan that survived a reinstall
     * would be an ink the player owns, which is not what was offered.
     */
    borrowedInk: number | null;
    /** Slot the borrow offer is open for, or null when it is closed. */
    borrowOffer: number | null;
    /** Daily loan budget, keyed to the trusted day so a clock change cannot reset it. */
    borrowDay: string | null;
    borrowsToday: number;

    /** Player settings mirrored from save. */
    musicEnabled: boolean;
    musicVolume: number;
    sfxEnabled: boolean;
    sfxVolume: number;
    notificationsEnabled: boolean;
    notificationsConsent: "unknown" | "granted" | "denied";
    hapticsEnabled: boolean;
    reducedMotion: boolean;
    locale: string;
    quality: "high" | "low";

    /**
     * True while the current sheet holds every element of some unfound secret.
     *
     * Written by the scene when the fact flips, never per frame. Deliberately
     * not saved: it is a property of the sheet, and the sheet dies with the
     * session.
     */
    pageStirring: boolean;

    /** One-line transient message shown over everything. */
    toast: string | null;

    runtimeReady: boolean;
    runtimeConfigVersion: string | null;
    trustedTimeReady: boolean;
}

const listeners = new Set<() => void>();

let state: AppState = {
    phase: "loading",
    loadProgress: 0,
    paused: false,
    menuScreen: "title",
    overlay: "none",

    discoveries: [],
    discoveryCount: 0,
    pagesTorn: 0,
    strokes: 0,
    folio: [],
    colophonSeen: false,
    colophonPending: false,
    selectedInk: 0,
    largeBrush: false,
    mirrorBrush: false,

    revealedHints: [],
    hintDay: null,
    freeHintUsed: false,
    hintsWatchedToday: 0,

    promptDay: null,
    promptId: null,
    promptSolved: false,
    promptLastKeptDay: null,
    promptStreak: 0,

    ownsKit: false,
    potNudges: 0,
    borrowedInk: null,
    borrowOffer: null,
    borrowDay: null,
    borrowsToday: 0,
    paper: DEFAULT_PAPER,
    kitOfferSeen: false,

    musicEnabled: true,
    musicVolume: 0.38,
    sfxEnabled: true,
    sfxVolume: 0.72,
    notificationsEnabled: false,
    notificationsConsent: "unknown",
    hapticsEnabled: true,
    reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    locale: "English",
    quality: "high",

    pageStirring: false,

    toast: null,

    runtimeReady: false,
    runtimeConfigVersion: null,
    trustedTimeReady: false,
};

export const store = {
    get(): AppState {
        return state;
    },

    patch(partial: Partial<AppState>): void {
        state = { ...state, ...partial };
        for (const listener of listeners) listener();
    },

    subscribe(listener: () => void): () => void {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
};

export function useStore<T = AppState>(selector: (s: AppState) => T = (s) => s as unknown as T): T {
    return useSyncExternalStore(store.subscribe, () => selector(state));
}
