/**
 * Lightweight in-house tween utility used by the template scene.
 *
 * Small, typed, intentionally simple:
 * - independent numeric tweens per property
 * - chain-safe update loop
 * - per-tween completion hooks
 *
 * Good enough for menu/card motion, punch-bounce effects, reward pop-ins,
 * and particle burst scale/alpha fades.
 */

export type Easing = (t: number) => number;

export interface TweenOptions {
    /** Run time in milliseconds */
    durationMs: number;
    /** Optional wait before the first frame */
    delayMs?: number;
    /** Called once when fromValue === toValue */
    immediate?: boolean;
}

export interface ActiveTween {
    /** Update callback receives value 0..1 after easing */
    tick: (value: number) => void;
    /** Optional completion callback */
    onDone?: () => void;
    /** Internal */
    elapsed: number;
    readonly durationMs: number;
    readonly delayMs: number;
    done: boolean;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

export const ease = {
    linear: (t: number): number => clamp01(t),
    outCubic: (t: number): number => {
        const x = clamp01(t);
        return 1 - Math.pow(1 - x, 3);
    },
    outBack: (t: number): number => {
        const x = clamp01(t);
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
    },
    inOutSine: (t: number): number => -(Math.cos(Math.PI * clamp01(t)) - 1) / 2,
};

export interface TweenController {
    /** Add a new tween over one property. */
    addTween(
        setValue: (value: number) => void,
        from: number,
        to: number,
        easing: Easing,
        onDone?: () => void,
        options?: TweenOptions,
    ): ActiveTween;
    /** Update all active tweens; call once per tick */
    update(dtSeconds: number): void;
    /** Remove and kill every in-flight tween */
    clear(): void;
    /** Active tween count (debug/testing). */
    readonly count: number;
}

export function createTweenController(): TweenController {
    const tweens: ActiveTween[] = [];

    function addTween(
        setValue: (value: number) => void,
        from: number,
        to: number,
        easing: Easing,
        onDone?: () => void,
        options: TweenOptions = { durationMs: 300 },
    ): ActiveTween {
        const immediate = options.immediate === true || to === from;
        const apply = (ratio: number): void => {
            const v = from + (to - from) * easing(ratio);
            setValue(v);
        };

        const durationMs = Math.max(1, options.durationMs || 1);
        const initialElapsed = -Math.max(0, options.delayMs ?? 0);
        const runner: ActiveTween = {
            tick: apply,
            durationMs,
            delayMs: Math.max(0, options.delayMs ?? 0),
            done: immediate,
            elapsed: immediate ? durationMs : initialElapsed,
            ...(onDone ? { onDone } : {}),
        };

        if (immediate && onDone) queueMicrotask(() => onDone());
        if (!immediate) tweens.push(runner);

        return runner;
    }

    function update(dtSeconds: number): void {
        if (tweens.length === 0) return;
        const dtMs = dtSeconds * 1000;
        for (let i = tweens.length - 1; i >= 0; i--) {
            const t = tweens[i];
            if (!t) continue;
            if (t.done) {
                tweens.splice(i, 1);
                continue;
            }
            t.elapsed += dtMs;
            if (t.elapsed < t.delayMs) continue;

            const raw = (t.elapsed - t.delayMs) / t.durationMs;
            const value = raw >= 1 ? 1 : raw;
            t.tick(Math.min(1, value));
            if (value >= 1) {
                t.done = true;
                if (t.onDone) {
                    try {
                        t.onDone();
                    } catch {
                        /* hook safety */
                    }
                }
                tweens.splice(i, 1);
            }
        }
    }

    return {
        addTween,
        update,
        clear() {
            tweens.length = 0;
        },
        get count() {
            return tweens.length;
        },
    };
}
