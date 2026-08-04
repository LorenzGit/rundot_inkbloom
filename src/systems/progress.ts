/**
 * What the player has learned, and what that opens.
 *
 * Discoveries are the game's only progression currency: they gate the four
 * later inks, they are the RUN score, and they are what the daily prompt asks
 * for. Nothing here can be bought — the Illuminator's Kit changes what the
 * page looks like and how patient you have to be, never what is reachable.
 */
import { DISCOVERIES, DISCOVERY_COUNT } from "../game/sim/discoveries.ts";
import { ERASER_INDEX, INKS } from "../game/sim/elements.ts";
import { store } from "../state/store.ts";
import { saveSystem } from "./save.ts";
import { runtimeServices } from "./runtimeServices.ts";
import { inkAudio } from "../audio/inkAudio.ts";
import { submitDiscoveryScore } from "../sdk/runCommerce.ts";

/** A discovery or unlock the page should celebrate, in the order it happened. */
export interface Celebration {
    kind: "discovery" | "unlock";
    title: string;
    note: string;
    colour: number;
    /** `n/60` for discoveries. */
    ordinal: number | null;
    /** Simulation cell to burst particles from, when there is one. */
    cell: number | null;
}

const pending: Celebration[] = [];

/** Drain the celebration queue. The Pixi scene owns how these are shown. */
export function takeCelebrations(): Celebration[] {
    if (pending.length === 0) return [];
    return pending.splice(0, pending.length);
}

export function isInkUnlocked(slot: number, discoveryCount: number): boolean {
    if (slot === ERASER_INDEX) return true;
    const ink = INKS[slot];
    if (ink === undefined) return false;
    // A borrowed bottle is usable but not earned: `discoveryCount` is what
    // gates the shelf, and the loan is checked separately so nothing else in
    // the game mistakes it for progress.
    if (store.get().borrowedInk === slot) return true;
    return discoveryCount >= ink.unlockAt;
}

/** The next bottle still to come, for the shelf's "coming up" affordance. */
export function nextInkUnlock(discoveryCount: number): { slot: number; at: number } | null {
    for (let slot = 0; slot < INKS.length; slot++) {
        const ink = INKS[slot];
        if (ink && ink.unlockAt > discoveryCount) return { slot, at: ink.unlockAt };
    }
    return null;
}

export function isFound(id: string): boolean {
    return store.get().discoveries.includes(id);
}

/**
 * Record a secret the simulation just performed.
 *
 * Idempotent: the simulation also tracks what it has already fired, but a
 * reloaded page and a restored save both re-enter through here, so this is the
 * authority on "is this new".
 */
export function recordDiscovery(index: number, cell: number | null): void {
    const discovery = DISCOVERIES[index];
    if (!discovery) return;
    const state = store.get();
    if (state.discoveries.includes(discovery.id)) return;

    const discoveries = [...state.discoveries, discovery.id];
    const count = discoveries.length;
    store.patch({ discoveries, discoveryCount: count });

    pending.push({
        kind: "discovery",
        title: discovery.name,
        note: discovery.note,
        colour: discovery.colour,
        ordinal: count,
        cell,
    });
    // Each find strikes a different degree of the same pentatonic key, and
    // the sixtieth lands a full octave up — the journey has a melody.
    const degrees = [0, 2, 4, 7, 9];
    inkAudio.play("discovery", { lift: count === DISCOVERY_COUNT ? 12 : (degrees[(count - 1) % 5] ?? 0) });
    void runtimeServices.haptic("success");
    runtimeServices.track("discovery_found", {
        discovery_id: discovery.id,
        ordinal: count,
        of: DISCOVERY_COUNT,
        was_hinted: state.revealedHints.includes(discovery.id),
        paper: state.paper,
    });

    // A newly crossed unlock threshold is celebrated after the discovery that
    // caused it, so the two toasts read as cause and effect.
    for (let slot = 0; slot < INKS.length; slot++) {
        const ink = INKS[slot];
        if (!ink || ink.unlockAt !== count) continue;
        pending.push({
            kind: "unlock",
            title: `New ink — ${ink.name}`,
            note: ink.unlockLine,
            colour: ink.colour,
            ordinal: null,
            cell: null,
        });
        runtimeServices.track("ink_unlocked", { ink_id: ink.id, at: count });
    }

    // The sixtieth find summons the colophon — once, ever. The overlay itself
    // waits out the toast so the "№ 60" card gets its moment first.
    if (count === DISCOVERY_COUNT && !state.colophonSeen) {
        store.patch({ colophonPending: true });
        runtimeServices.track("colophon_reached", { pages_torn: state.pagesTorn, strokes: state.strokes });
    }

    void submitDiscoveryScore(count);
    void saveSystem.flush();
}

/** Apply a restored save to the simulation's own found-set. */
export function foundIndicesFromSave(ids: readonly string[]): number[] {
    const indices: number[] = [];
    for (let index = 0; index < DISCOVERIES.length; index++) {
        const entry = DISCOVERIES[index];
        if (entry && ids.includes(entry.id)) indices.push(index);
    }
    return indices;
}
