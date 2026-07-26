/**
 * Hot-path deterministic randomness for the ink simulation.
 *
 * The simulation visits every non-empty cell 60 times a second and most cells
 * consume several random numbers per visit, so the workspace's `NoiseRandom`
 * class is too heavy here: its per-call `Number.isSafeInteger` argument
 * validation dominates the cost at that call volume.
 *
 * This is NOT a second random algorithm. `SimRandom` computes the identical
 * squirrel-noise hash as `NoiseRandom.randomize(seed, position, salt)` and
 * advances `position` the same way — it simply skips the argument validation
 * and the bounds mapping, and exposes bit-level helpers the automaton wants.
 * `scripts/verify-sim.mjs` asserts the two produce identical streams, so the
 * "one deterministic RNG, never Math.random()" rule still holds.
 *
 * Seed and position are both persisted with the page, so a saved page resumes
 * its exact random stream instead of quietly diverging.
 */

const BIT_NOISE1 = 0xb529_7a4d;
const BIT_NOISE2 = 0x68e3_1da4;
const BIT_NOISE3 = 0x1b56_c4e9;

export class SimRandom {
    seed: number;
    position: number;

    constructor(seed = 0x1ac0_ffee, position = 0) {
        this.seed = seed >>> 0;
        this.position = position >>> 0;
    }

    /** Uniform uint32, advancing the stream by one. */
    nextUint(): number {
        let noise = Math.imul(this.position, BIT_NOISE1) >>> 0;
        this.position = (this.position + 1) >>> 0;
        noise = (noise + this.seed) >>> 0;
        noise = (noise ^ (noise >>> 8)) >>> 0;
        noise = (noise + BIT_NOISE2) >>> 0;
        noise = (noise ^ (noise << 8)) >>> 0;
        noise = Math.imul(noise, BIT_NOISE3) >>> 0;
        return (noise ^ (noise >>> 8)) >>> 0;
    }

    /**
     * The low `bits` bits of the next value. The automaton asks questions like
     * "one chance in eight" constantly, and a mask is the cheapest way to ask.
     */
    bits(bits: number): number {
        return this.nextUint() & ((1 << bits) - 1);
    }

    /** A coin flip expressed as -1 or 1, for "try this side first" choices. */
    side(): number {
        return (this.nextUint() & 1) === 0 ? -1 : 1;
    }

    /** True `numerator` times out of `2 ** bits`. */
    chance(numerator: number, bits: number): boolean {
        return (this.nextUint() & ((1 << bits) - 1)) < numerator;
    }

    /** Uniform float in [0, 1). */
    unit(): number {
        return this.nextUint() / 4_294_967_296;
    }

    /** Uniform integer in [0, bound). `bound` must be positive. */
    below(bound: number): number {
        return this.nextUint() % bound;
    }
}
