import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({
    appType: "custom",
    configFile: false,
    logLevel: "silent",
    server: { middlewareMode: true },
});

try {
    const { NoiseRandom } = await server.ssrLoadModule("/src/game/noiseRandom.ts");

    const vectors = [
        [0x0000_0000, 0x0000_0000, 0x0000_0000, 0x1a0a_96c2],
        [0x0000_0001, 0x0000_0000, 0x0000_0000, 0xde7c_c04f],
        [0x0000_0001, 0x0000_0001, 0x0000_0000, 0xd5c3_1a94],
        [0x1234_5678, 0x0000_0000, 0x0000_0000, 0x9531_58de],
        [0x1234_5678, 0x0000_002a, 0x0000_0000, 0xed7c_45dd],
        [0x1234_5678, 0x0000_002a, 0x0000_0063, 0x5a30_aa2e],
        [0xffff_ffff, 0xffff_ffff, 0xffff_ffff, 0x382e_1a94],
        [0xdead_beef, 0xcafe_babe, 0x1020_3040, 0x8d4e_eb47],
    ];

    for (const [seed, position, salt, expected] of vectors) {
        assert.equal(NoiseRandom.randomize(seed, position, salt), expected);
    }

    const sequence = new NoiseRandom(0x1234_5678, 0);
    assert.deepEqual(
        Array.from({ length: 6 }, () => sequence.nextUint()),
        [2503039198, 2812778486, 3455909771, 1820901707, 1913445549, 3795588174],
    );
    assert.equal(sequence.position, 6);

    const salted = new NoiseRandom(0x1234_5678, 42);
    assert.equal(salted.nextUint(99), 0x5a30_aa2e);
    assert.equal(salted.position, 43);

    const reset = new NoiseRandom(1, 1);
    reset.setSeedAndPosition(0x1234_5678, 42);
    assert.equal(reset.nextUint(), 0xed7c_45dd);

    const pure = new NoiseRandom(7, 11);
    assert.equal(pure.randomize(0x1234_5678, 42, 0), 0xed7c_45dd);
    assert.equal(pure.position, 11);

    const integersA = new NoiseRandom(99, 7);
    const integersB = new NoiseRandom(99, 7);
    const integerSequenceA = Array.from({ length: 64 }, () => integersA.int(-8, 13, 17));
    const integerSequenceB = Array.from({ length: 64 }, () => integersB.int(-8, 13, 17));
    assert.deepEqual(integerSequenceA, integerSequenceB);
    assert(integerSequenceA.every((value) => value >= -8 && value < 13));

    const floats = new NoiseRandom(31, 9);
    const floatSequence = Array.from({ length: 64 }, () => floats.float(-2.5, 4.25, 3));
    assert(floatSequence.every((value) => value >= -2.5 && value <= 4.25));

    const booleansA = new NoiseRandom(123, 4);
    const booleansB = new NoiseRandom(123, 4);
    assert.deepEqual(
        Array.from({ length: 64 }, () => booleansA.bool(0.35, 8)),
        Array.from({ length: 64 }, () => booleansB.bool(0.35, 8)),
    );
    assert.equal(new NoiseRandom(1, 0).bool(0), false);
    assert.equal(new NoiseRandom(1, 0).bool(1), true);

    const wrapping = new NoiseRandom(5, 0xffff_ffff);
    wrapping.nextUint();
    assert.equal(wrapping.position, 0);

    assert.throws(() => new NoiseRandom(-1, 0), RangeError);
    assert.throws(() => new NoiseRandom(0, 0).int(4, 4), RangeError);
    assert.throws(() => new NoiseRandom(0, 0).float(2, 1), RangeError);
    assert.throws(() => new NoiseRandom(0, 0).bool(1.1), RangeError);

    console.log(`NoiseRandom checks passed: ${vectors.length} C# compatibility vectors.`);
} finally {
    await server.close();
}
