/**
 * Today's page.
 *
 * A short brief set once a day, drawn only from secrets the player has already
 * found — so it is always fair, always achievable, and reads as practising a
 * craft rather than as a wall. Keeping it banks a nudge and extends a streak.
 *
 * The prompt is chosen deterministically from the trusted day key and the
 * player's own found-set, so it does not reroll when the game is reopened, and
 * two players who know the same things get the same brief on the same day.
 */
import { DISCOVERIES, discoveryIndexById } from "../game/sim/discoveries.ts";
import { NoiseRandom } from "../game/noiseRandom.ts";
import { store } from "../state/store.ts";
import { saveSystem } from "./save.ts";
import { runtimeServices } from "./runtimeServices.ts";
import { bankPromptNudge } from "./hints.ts";
import { inkAudio } from "../audio/inkAudio.ts";
import { hasServerTime, localDayKey, serverNow } from "./serverTime.ts";
import { getRunCapabilities } from "../sdk/runSdk.ts";
import { monetization } from "./monetization.ts";

/** Prompts only appear once the player has something worth practising. */
const MIN_DISCOVERIES = 3;

export type PromptShape = "reproduce" | "abundance" | "pair";

export interface DailyPrompt {
    /** `<shape>:<ids>` — stable, and what gets persisted. */
    id: string;
    shape: PromptShape;
    /** Discovery ids the prompt is about. */
    targets: string[];
    /** How many times, for `abundance`. */
    quantity: number;
    /** The brief, as written in the journal. */
    brief: string;
}

export interface PromptView {
    available: boolean;
    /** Why there is no prompt, when there is none. */
    reason: string;
    prompt: DailyPrompt | null;
    solved: boolean;
    streak: number;
    /** Progress toward `abundance`/`pair` targets on the current sheet. */
    progress: number;
    target: number;
    /** True when the day key came from trusted RUN time rather than the device. */
    authoritative: boolean;
}

/** Reactions counted on the current sheet, reset when a page is torn off. */
const sheetReactions = new Map<string, number>();

export function noteSheetReactions(counts: Uint16Array): void {
    for (let index = 0; index < counts.length; index++) {
        const amount = counts[index] ?? 0;
        if (amount === 0) continue;
        const entry = DISCOVERIES[index];
        if (!entry) continue;
        sheetReactions.set(entry.id, (sheetReactions.get(entry.id) ?? 0) + amount);
    }
}

export function resetSheetReactions(): void {
    sheetReactions.clear();
}

function dayNumber(day: string): number {
    // A stable 32-bit seed from the calendar day, so the brief is the same for
    // everyone who knows the same things, and does not reroll on reopen.
    let hash = 0x811c_9dc5;
    for (let i = 0; i < day.length; i++) hash = Math.imul(hash ^ day.charCodeAt(i), 0x0100_0193) >>> 0;
    return hash >>> 0;
}

function buildPrompt(day: string, known: readonly string[]): DailyPrompt | null {
    if (known.length < MIN_DISCOVERIES) return null;
    const random = new NoiseRandom(dayNumber(day), 0);
    const sorted = [...known].sort();

    const first = sorted[random.int(0, sorted.length)];
    if (!first) return null;
    const firstEntry = DISCOVERIES[discoveryIndexById(first)];
    if (!firstEntry) return null;

    const roll = random.int(0, 100);
    if (roll < 45) {
        return {
            id: `reproduce:${first}`,
            shape: "reproduce",
            targets: [first],
            quantity: 1,
            brief: `Do it again: ${firstEntry.name.toLowerCase()}, on one sheet.`,
        };
    }
    if (roll < 78) {
        const quantity = 3 + random.int(0, 4);
        return {
            id: `abundance:${first}:${quantity}`,
            shape: "abundance",
            targets: [first],
            quantity,
            brief: `Not once — ${quantity} times. ${firstEntry.name}, on one sheet.`,
        };
    }

    const others = sorted.filter((id) => id !== first);
    const second = others[random.int(0, Math.max(1, others.length))];
    const secondEntry = second ? DISCOVERIES[discoveryIndexById(second)] : undefined;
    if (!second || !secondEntry) {
        return {
            id: `reproduce:${first}`,
            shape: "reproduce",
            targets: [first],
            quantity: 1,
            brief: `Do it again: ${firstEntry.name.toLowerCase()}, on one sheet.`,
        };
    }
    return {
        id: `pair:${first}+${second}`,
        shape: "pair",
        targets: [first, second],
        quantity: 1,
        brief: `Both on one sheet: ${firstEntry.name} and ${secondEntry.name}.`,
    };
}

function timeIsAuthoritative(): boolean {
    const capabilities = getRunCapabilities();
    return capabilities.host && !capabilities.mock;
}

export function view(): PromptView {
    const state = store.get();
    const authoritative = timeIsAuthoritative();
    if (authoritative && !hasServerTime()) {
        return {
            available: false,
            reason: "waiting for trusted RUN time",
            prompt: null,
            solved: false,
            streak: state.promptStreak,
            progress: 0,
            target: 1,
            authoritative,
        };
    }

    const day = localDayKey(serverNow());
    const prompt = buildPrompt(day, state.discoveries);
    if (!prompt) {
        return {
            available: false,
            reason: `find ${MIN_DISCOVERIES} secrets to be given a page`,
            prompt: null,
            solved: false,
            streak: state.promptStreak,
            progress: 0,
            target: 1,
            authoritative,
        };
    }

    const solved = state.promptDay === day && state.promptId === prompt.id && state.promptSolved;
    const target = prompt.shape === "abundance" ? prompt.quantity : prompt.targets.length;
    const progress =
        prompt.shape === "abundance"
            ? Math.min(target, sheetReactions.get(prompt.targets[0] ?? "") ?? 0)
            : prompt.targets.filter((id) => (sheetReactions.get(id) ?? 0) > 0).length;

    return { available: true, reason: "", prompt, solved, streak: state.promptStreak, progress, target, authoritative };
}

function previousDay(day: string): string {
    const date = new Date(`${day}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
}

/**
 * Check the current sheet against today's brief.
 *
 * Called after every simulation frame that produced reactions. Cheap, and
 * idempotent once the prompt is kept.
 */
export function evaluate(): boolean {
    const current = view();
    if (!current.available || !current.prompt || current.solved) return false;
    if (current.progress < current.target) return false;

    const state = store.get();
    const day = localDayKey(serverNow());
    // The streak reads `promptLastKeptDay`, not `promptDay`: the latter rolls
    // forward every time the game is opened and would break every run.
    const streak = state.promptLastKeptDay === previousDay(day) ? state.promptStreak + 1 : 1;

    store.patch({
        promptDay: day,
        promptId: current.prompt.id,
        promptSolved: true,
        promptLastKeptDay: day,
        promptStreak: streak,
    });
    bankPromptNudge();
    inkAudio.play("reward");
    void runtimeServices.haptic("success");
    runtimeServices.track("daily_prompt_kept", {
        prompt_id: current.prompt.id,
        shape: current.prompt.shape,
        streak,
        authoritative: current.authoritative,
    });
    void saveSystem.flush();
    return true;
}

/** Roll the stored day forward when the trusted date changes. */
export function rolloverIfNeeded(): void {
    const state = store.get();
    if (timeIsAuthoritative() && !hasServerTime()) return;
    const day = localDayKey(serverNow());
    monetization.rolloverDay(day);
    if (state.promptDay === day) return;
    // The streak itself is only broken when a *new* prompt is kept, so an
    // unopened day does not silently reset a long run here.
    store.patch({ promptDay: day, promptId: null, promptSolved: false });
    void saveSystem.flush();
}
