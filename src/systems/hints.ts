/**
 * Nudges.
 *
 * A nudge reveals the marginal note next to one still-unfound secret. It never
 * gives a recipe — it names the inks and leaves the arrangement to the player,
 * because a game about finding things out cannot sell the finding out.
 *
 * Where a nudge comes from, in the order the game tries:
 *   1. one free every day, for everybody;
 *   2. one more for keeping today's prompt;
 *   3. a nudge from a bought pot, if the player has one;
 *   4. a rewarded video, up to three a day, always player-initiated;
 *   5. no limit at all, with the Illuminator's Kit.
 *
 * Free sources are spent before bought ones on purpose: a player who has both
 * should never find that today's free nudge quietly went unused while their
 * pot drained. The rewarded video stays a separate, explicit button rather
 * than a fallback, so watching one is always a choice.
 */
import { DISCOVERIES } from "../game/sim/discoveries.ts";
import { store } from "../state/store.ts";
import { saveSystem } from "./save.ts";
import { runtimeServices } from "./runtimeServices.ts";
import { inkAudio } from "../audio/inkAudio.ts";
import { nudgeAvailability, spendPotNudge, watchForNudge, type NudgeResult } from "./monetization.ts";
import { localDayKey, serverNow } from "./serverTime.ts";

export type NudgeSource = "free" | "prompt" | "pot" | "kit" | "ad";

export interface NudgeOffer {
    /** A nudge can be spent right now without watching anything. */
    freeReady: boolean;
    /** Where a nudge would come from if spent now, for the button's label. */
    freeSource: Exclude<NudgeSource, "ad"> | null;
    /** Bought nudges still in the pot. */
    potNudges: number;
    /** The rewarded control's state. */
    adVisible: boolean;
    adReady: boolean;
    adReason: string;
    adRemainingToday: number | null;
}

/** A nudge banked by keeping the daily prompt, spendable once. */
let promptNudgeBanked = false;

export function bankPromptNudge(): void {
    promptNudgeBanked = true;
}

export function hasUnrevealed(): boolean {
    const state = store.get();
    return DISCOVERIES.some(
        (entry) => !state.discoveries.includes(entry.id) && !state.revealedHints.includes(entry.id),
    );
}

export function offer(): NudgeOffer {
    const state = store.get();
    const availability = nudgeAvailability();

    let freeSource: Exclude<NudgeSource, "ad"> | null = null;
    if (state.ownsKit) freeSource = "kit";
    else if (!state.freeHintUsed) freeSource = "free";
    else if (promptNudgeBanked) freeSource = "prompt";
    else if (state.potNudges > 0) freeSource = "pot";

    return {
        freeReady: freeSource !== null && hasUnrevealed(),
        freeSource,
        potNudges: state.potNudges,
        adVisible: !state.ownsKit && availability.visible && hasUnrevealed(),
        adReady: availability.ready && hasUnrevealed(),
        adReason: availability.reason,
        adRemainingToday: availability.remainingToday,
    };
}

/**
 * Spend a nudge the player already has. Returns false when there is none.
 *
 * A pot nudge is charged **before** the note is revealed and only proceeds on
 * the server's confirmation. Revealing first and consuming after would hand
 * out a secret for free every time the host was unreachable.
 */
export async function spendFreeNudge(discoveryId: string): Promise<boolean> {
    const state = store.get();
    if (state.discoveries.includes(discoveryId) || state.revealedHints.includes(discoveryId)) return false;

    const source = offer().freeSource;
    if (source === null) return false;

    if (source === "pot") {
        const spent = await spendPotNudge();
        if (spent !== "spent") {
            store.patch({ toast: spent === "empty" ? "that pot is empty" : "could not reach the shop" });
            return false;
        }
    }

    const patch: Parameters<typeof store.patch>[0] = {
        revealedHints: [...store.get().revealedHints, discoveryId],
    };
    if (source === "free") {
        patch.freeHintUsed = true;
        patch.hintDay = localDayKey(serverNow());
    }
    if (source === "prompt") promptNudgeBanked = false;

    store.patch(patch);
    inkAudio.play("reward");
    void runtimeServices.haptic("light");
    runtimeServices.track("currency_spent", { discovery_id: discoveryId, source });
    await saveSystem.flush();
    return true;
}

/** Watch a rewarded video, then reveal the note if the host confirms it played. */
export async function watchNudge(discoveryId: string): Promise<NudgeResult> {
    const state = store.get();
    if (state.discoveries.includes(discoveryId) || state.revealedHints.includes(discoveryId)) return "unavailable";

    const result = await watchForNudge();
    if (result !== "granted") return result;

    const current = store.get();
    store.patch({ revealedHints: [...current.revealedHints, discoveryId] });
    inkAudio.play("reward");
    void runtimeServices.haptic("success");
    runtimeServices.track("currency_spent", { discovery_id: discoveryId, source: "ad" });
    await saveSystem.flush();
    return "granted";
}

export function isRevealed(discoveryId: string): boolean {
    return store.get().revealedHints.includes(discoveryId);
}
