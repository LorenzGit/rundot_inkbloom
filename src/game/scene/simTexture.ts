/**
 * Turning cells into pigment.
 *
 * The simulation grid is uploaded to the GPU every frame as two small RGBA
 * textures — a *mark* and a *bleed* — which are drawn over the paper with a
 * multiply blend. Three effects do the work:
 *
 *   - **granulation** — each cell's brightness is nudged by its fixed paper
 *     grain, so a flat pour of one colour still reads as pigment settling into
 *     an uneven sheet;
 *   - **edge darkening** — cells that touch empty paper are darkened and made
 *     more opaque, reproducing the dark rim real watercolour leaves as it dries;
 *   - **bleed** — a blurred, faint copy underneath, which is the wet halo that
 *     spreads into the fibre around every mark.
 *
 * The bleed is blurred *here*, in a separable box pass over the cell buffer,
 * rather than with a Pixi `BlurFilter`. That is deliberate: a filtered display
 * object is composited by its filter pass, and that composite does not blend
 * correctly against the page — every ink lands as a flat black silhouette. Two
 * box passes over 30,000 cells cost a fraction of a millisecond and keep the
 * whole ink layer on an ordinary, correctly-blended sprite.
 *
 * Colours are written premultiplied so they can multiply into the paper
 * without a separate conversion pass.
 */
import { BufferImageSource, Texture } from "pixi.js";
import type { InkSim } from "../sim/inkSim.ts";
import {
    ASH,
    ACID,
    AMALGAM,
    AMBER,
    BASALT,
    BLOSSOM,
    BRIAR,
    BRINE,
    CRYSTAL,
    EMBER,
    EMPTY,
    FROST,
    FUME,
    FULGURITE,
    GUST,
    GLASS,
    GRIT,
    HAZE,
    ICE,
    MOTE,
    PITCH,
    RILL,
    MAGMA,
    MOLTEN,
    MOSS,
    OBSIDIAN,
    PEAT,
    QUICK,
    RESIN,
    RIME,
    SALT,
    SEALED,
    SILT,
    SMOKE,
    SPORE,
    VOLT,
    WAX,
    STEAM,
} from "../sim/elements.ts";

/**
 * Bleed blur radius, in cells.
 *
 * The mark itself is NOT blurred. A cell is only a few device pixels wide, so
 * even a one-cell blur smears a pile of sand into a brown cloud and throws away
 * the per-cell granulation that makes it read as grains at all. Bilinear
 * magnification already softens the cell edges; that is the right amount.
 *
 * The bleed is a separate, deliberately wide pass — the wet halo that spreads
 * into the fibre around a mark — drawn faintly underneath.
 */
const BLEED_RADIUS = 3;

/**
 * Glow halo radius, in cells.
 *
 * Wider than the bleed would look like fog off every spark; narrower stops
 * reading as light and goes back to being a coloured pixel.
 */
const GLOW_RADIUS = 2;

export interface SimTexture {
    /** The mark itself. */
    readonly mark: Texture;
    /** The wet halo drawn underneath it. */
    readonly bleed: Texture;
    /**
     * The light the page gives back.
     *
     * Everything else here multiplies into the paper, which means fire, magma,
     * a charge and a mote can only ever *darken* the sheet — a wildfire reads
     * as brown dots. This plate is drawn additively on top, so the hot
     * elements actually glow. On high quality the core is blurred into a halo;
     * on low it is the bare core, which still reads as light.
     */
    readonly glow: Texture;
    /**
     * Live views of the mark and glow cell buffers, premultiplied RGBA.
     *
     * Read-only by contract: the folio capture composites them onto a 2D
     * canvas at tear time, which keeps the capture renderer-independent — a
     * WebGPU readback is async and a WebGL one needs `preserveDrawingBuffer`,
     * and neither is worth it for pixels that already live on the CPU.
     */
    readonly markPixels: Uint8Array;
    readonly glowPixels: Uint8Array;
    /** Repaint from the simulation and push new pixels to the GPU. */
    update(sim: InkSim, withBleed: boolean): void;
    destroy(): void;
}

export function createSimTexture(width: number, height: number): SimTexture {
    const cells = width * height;
    const markPixels = new Uint8Array(cells * 4);
    const markWords = new Uint32Array(markPixels.buffer);
    const bleedPixels = new Uint8Array(cells * 4);
    const scratch = new Uint8Array(cells * 4);
    const glowCore = new Uint8Array(cells * 4);
    const glowCoreWords = new Uint32Array(glowCore.buffer);
    const glowPixels = new Uint8Array(cells * 4);

    const makeSource = (resource: Uint8Array) => {
        const source = new BufferImageSource({
            resource,
            width,
            height,
            alphaMode: "premultiplied-alpha",
            format: "rgba8unorm",
        });
        // Set explicitly rather than through the constructor options: the page
        // is magnified about 4.5x from the cell grid, and nearest sampling
        // there turns wet ink into visible squares.
        source.style.scaleMode = "linear";
        source.style.addressMode = "clamp-to-edge";
        return source;
    };

    const markSource = makeSource(markPixels);
    const bleedSource = makeSource(bleedPixels);
    const glowSource = makeSource(glowPixels);
    const mark = new Texture({ source: markSource });
    const bleed = new Texture({ source: bleedSource });
    const glow = new Texture({ source: glowSource });

    // Skip the glow passes entirely while the page holds nothing hot — which
    // is most of the time — but always clear and upload once on the way down,
    // or the last frame of a fire stays burned into the plate.
    let hadGlow = false;

    return {
        mark,
        bleed,
        glow,
        markPixels,
        glowPixels,
        update(sim, withBleed) {
            paint(sim, markWords, width, height);
            markSource.update();

            const lit = paintGlow(sim, glowCoreWords, width, height);
            if (lit > 0) {
                if (withBleed) {
                    // Halo pass: the blurred core is the light spilling onto
                    // the paper, and the core folded back in is the hot centre.
                    blur(glowCore, glowPixels, scratch, width, height, GLOW_RADIUS);
                    for (let i = 0; i < glowPixels.length; i++) {
                        const sum = (glowPixels[i] ?? 0) + (glowCore[i] ?? 0);
                        glowPixels[i] = sum > 255 ? 255 : sum;
                    }
                } else {
                    glowPixels.set(glowCore);
                }
                glowSource.update();
                hadGlow = true;
            } else if (hadGlow) {
                glowPixels.fill(0);
                glowSource.update();
                hadGlow = false;
            }

            if (!withBleed) return;
            blur(markPixels, bleedPixels, scratch, width, height, BLEED_RADIUS);
            bleedSource.update();
        },
        destroy() {
            mark.destroy(true);
            bleed.destroy(true);
            glow.destroy(true);
        },
    };
}

/** Little-endian RGBA8 packing, premultiplied. */
function pack(r: number, g: number, b: number, a: number): number {
    const alpha = a > 255 ? 255 : a < 0 ? 0 : a;
    const scale = alpha / 255;
    const rr = (r * scale) & 0xff;
    const gg = (g * scale) & 0xff;
    const bb = (b * scale) & 0xff;
    return ((alpha << 24) | (bb << 16) | (gg << 8) | rr) >>> 0;
}

/**
 * Separable box blur over premultiplied RGBA.
 *
 * Premultiplied data is exactly what makes this safe to average naively:
 * transparent cells contribute nothing to colour because their colour is
 * already scaled to zero, so a blurred edge fades out instead of smearing
 * toward black.
 */
function blur(
    source: Uint8Array,
    destination: Uint8Array,
    scratch: Uint8Array,
    width: number,
    height: number,
    radius: number,
): void {
    const window = radius * 2 + 1;

    // Horizontal pass: source -> scratch.
    for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let x = 0; x < width; x++) {
            let r = 0;
            let g = 0;
            let b = 0;
            let a = 0;
            for (let offset = -radius; offset <= radius; offset++) {
                const sx = x + offset;
                const clamped = sx < 0 ? 0 : sx >= width ? width - 1 : sx;
                const i = (row + clamped) * 4;
                r += source[i] ?? 0;
                g += source[i + 1] ?? 0;
                b += source[i + 2] ?? 0;
                a += source[i + 3] ?? 0;
            }
            const out = (row + x) * 4;
            scratch[out] = (r / window) | 0;
            scratch[out + 1] = (g / window) | 0;
            scratch[out + 2] = (b / window) | 0;
            scratch[out + 3] = (a / window) | 0;
        }
    }

    // Vertical pass: scratch -> destination.
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let r = 0;
            let g = 0;
            let b = 0;
            let a = 0;
            for (let offset = -radius; offset <= radius; offset++) {
                const sy = y + offset;
                const clamped = sy < 0 ? 0 : sy >= height ? height - 1 : sy;
                const i = (clamped * width + x) * 4;
                r += scratch[i] ?? 0;
                g += scratch[i + 1] ?? 0;
                b += scratch[i + 2] ?? 0;
                a += scratch[i + 3] ?? 0;
            }
            const out = (y * width + x) * 4;
            destination[out] = (r / window) | 0;
            destination[out + 1] = (g / window) | 0;
            destination[out + 2] = (b / window) | 0;
            destination[out + 3] = (a / window) | 0;
        }
    }
}

/**
 * Write the emissive core: every cell that is a light source right now.
 *
 * Colours are packed premultiplied with the intensity in the alpha channel, so
 * under an `add` blend the contribution *is* `colour × intensity` — no shader
 * work needed. Flicker phases reuse `grain + tick × prime`, the same idiom the
 * mark uses, so the two plates shimmer in sympathy rather than beating against
 * each other. Returns how many cells were lit so the caller can skip the halo
 * pass on a cold page.
 */
function paintGlow(sim: InkSim, words: Uint32Array, width: number, height: number): number {
    const { cells, life, burn, grain, tick } = sim;
    let lit = 0;

    for (let i = 0, count = width * height; i < count; i++) {
        const element = cells[i] ?? EMPTY;
        const g = grain[i] ?? 0;

        if ((burn[i] ?? 0) > 0) {
            // Open flame: the brightest thing on the page, and never steady.
            const flicker = (g + tick * 7) & 31;
            words[i] = pack(255, 186, 96, flicker < 14 ? 190 : 140);
            lit++;
            continue;
        }

        switch (element) {
            case EMBER: {
                const pulse = (g + tick * 5) & 31;
                words[i] = pack(255, 158, 64, pulse < 12 ? 150 : 105);
                lit++;
                continue;
            }
            case MAGMA: {
                // `life` is the cooling counter: brand-new magma floods light,
                // crusting magma barely leaks it through the cracks.
                const cooling = life[i] ?? 0;
                const intensity = cooling > 150 ? 55 : cooling > 110 ? 115 : 175;
                words[i] = pack(255, 128, 44, intensity);
                lit++;
                continue;
            }
            case MOLTEN: {
                // Faint while it runs hot, nothing once it is merely warm.
                if ((life[i] ?? 0) > 120) break;
                words[i] = pack(255, 196, 96, 60);
                lit++;
                continue;
            }
            case VOLT: {
                const flash = ((g + tick * 7) & 15) < 6;
                words[i] = pack(196, 232, 255, flash ? 235 : 130);
                lit++;
                continue;
            }
            case MOTE: {
                const fade = (life[i] ?? 0) * 2;
                words[i] = pack(255, 222, 148, fade > 96 ? 96 : fade);
                lit++;
                continue;
            }
            default:
                break;
        }

        words[i] = 0;
    }

    return lit;
}

function paint(sim: InkSim, words: Uint32Array, width: number, height: number): void {
    const { cells, life, burn, grain, tick } = sim;

    for (let y = 0; y < height; y++) {
        const rowBase = y * width;
        for (let x = 0; x < width; x++) {
            const i = rowBase + x;
            const element = cells[i] ?? EMPTY;
            if (element === EMPTY) {
                words[i] = 0;
                continue;
            }

            const g = grain[i] ?? 0;
            let r: number;
            let gg: number;
            let b: number;
            let a: number;

            if ((burn[i] ?? 0) > 0) {
                // Flame colour cycles per cell, offset by grain so a burning
                // front shimmers instead of strobing in unison.
                const phase = (g + tick * 7) & 63;
                if (phase < 18) {
                    r = 246;
                    gg = 198;
                    b = 84;
                } else if (phase < 42) {
                    r = 232;
                    gg = 122;
                    b = 42;
                } else {
                    r = 201;
                    gg = 72;
                    b = 30;
                }
                a = 235;
            } else {
                switch (element) {
                    case GRIT:
                        r = g < 30 ? 197 : 217;
                        gg = g < 30 ? 144 : 164;
                        b = g < 30 ? 52 : 65;
                        a = 235;
                        break;
                    case SILT:
                        r = 148;
                        gg = 99;
                        b = 37;
                        a = 248;
                        break;
                    case RILL: {
                        // Depth: water with water above it reads darker, which
                        // is how a pool gains a surface line for free.
                        const submerged = y > 0 && (cells[i - width] ?? EMPTY) === RILL;
                        r = submerged ? 52 : 62;
                        gg = submerged ? 105 : 124;
                        b = submerged ? 160 : 184;
                        a = submerged ? 178 : 142;
                        break;
                    }
                    case EMBER: {
                        const phase = (g + tick * 5) & 31;
                        r = phase < 12 ? 245 : 224;
                        gg = phase < 12 ? 166 : 106;
                        b = phase < 12 ? 53 : 31;
                        a = 240;
                        break;
                    }
                    case BRIAR: {
                        const vigorous = (life[i] ?? 0) > 90;
                        r = 63;
                        gg = vigorous ? 148 : 125;
                        b = vigorous ? 82 : 69;
                        a = 220;
                        break;
                    }
                    case PITCH:
                        r = 110;
                        gg = 58;
                        b = 94;
                        a = 205;
                        break;
                    case BASALT:
                        r = 42;
                        gg = 38;
                        b = 34;
                        a = 242;
                        break;
                    case SMOKE: {
                        r = 133;
                        gg = 125;
                        b = 111;
                        const fade = (life[i] ?? 0) * 3;
                        a = fade > 70 ? 70 : fade;
                        break;
                    }
                    case STEAM: {
                        r = 158;
                        gg = 178;
                        b = 186;
                        const fade = (life[i] ?? 0) * 2;
                        a = fade > 54 ? 54 : fade;
                        break;
                    }
                    case MOTE: {
                        // A mote is the one thing on the page that gives light
                        // back rather than absorbing it, so it stays pale.
                        const pulse = (g + tick * 3) & 31;
                        r = 244;
                        gg = pulse < 16 ? 216 : 198;
                        b = pulse < 16 ? 140 : 108;
                        const fade = (life[i] ?? 0) * 2;
                        a = fade > 205 ? 205 : fade;
                        break;
                    }
                    case BLOSSOM:
                        r = g < 70 ? 239 : 214;
                        gg = g < 70 ? 180 : 106;
                        b = g < 70 ? 200 : 142;
                        a = 232;
                        break;
                    case GLASS:
                        r = g < 26 ? 240 : 159;
                        gg = g < 26 ? 250 : 201;
                        b = g < 26 ? 246 : 191;
                        a = g < 26 ? 130 : 90;
                        break;
                    case HAZE: {
                        r = 141;
                        gg = 150;
                        b = 184;
                        const body = 40 + ((life[i] ?? 0) >> 1);
                        a = body > 125 ? 125 : body;
                        break;
                    }
                    case SPORE:
                        r = 122;
                        gg = 82;
                        b = 48;
                        a = 235;
                        break;
                    case FROST:
                        r = g < 40 ? 232 : 186;
                        gg = g < 40 ? 244 : 216;
                        b = g < 40 ? 248 : 230;
                        a = 190;
                        break;
                    case ICE:
                        r = g < 34 ? 206 : 148;
                        gg = g < 34 ? 232 : 194;
                        b = g < 34 ? 242 : 214;
                        a = 168;
                        break;
                    case RIME:
                        r = g < 90 ? 226 : 198;
                        gg = g < 90 ? 242 : 226;
                        b = g < 90 ? 246 : 236;
                        a = 198;
                        break;
                    case SALT:
                        r = 236;
                        gg = 232;
                        b = 220;
                        a = 222;
                        break;
                    case BRINE:
                        r = 128;
                        gg = 156;
                        b = 148;
                        a = 168;
                        break;
                    case CRYSTAL:
                        r = g < 30 ? 252 : 226;
                        gg = g < 30 ? 250 : 220;
                        b = g < 30 ? 240 : 204;
                        a = 214;
                        break;
                    case ASH:
                        r = 107;
                        gg = 100;
                        b = 89;
                        a = 225;
                        break;
                    case WAX:
                        r = g < 30 ? 224 : 206;
                        gg = g < 30 ? 200 : 182;
                        b = g < 30 ? 138 : 120;
                        a = 236;
                        break;
                    case MOLTEN: {
                        // Hot when it starts running, dull as it sets. `life`
                        // is the cooling counter, so the colour is the state.
                        const cool = (life[i] ?? 0) > 120;
                        r = cool ? 226 : 244;
                        gg = cool ? 168 : 182;
                        b = cool ? 84 : 62;
                        a = 232;
                        break;
                    }
                    case SEALED:
                        r = g < 30 ? 214 : 196;
                        gg = g < 30 ? 176 : 158;
                        b = g < 30 ? 110 : 96;
                        a = 244;
                        break;
                    case MOSS: {
                        // Older patches are darker, so a bed reads as having
                        // grown outward rather than having been painted flat.
                        const old = (life[i] ?? 0) > 6;
                        r = old ? 74 : 96;
                        gg = old ? 132 : 158;
                        b = old ? 44 : 52;
                        a = 228;
                        break;
                    }
                    case PEAT:
                        r = g < 30 ? 86 : 70;
                        gg = g < 30 ? 60 : 48;
                        b = g < 30 ? 36 : 28;
                        a = 246;
                        break;
                    case ACID: {
                        const submerged = y > 0 && (cells[i - width] ?? EMPTY) === ACID;
                        r = submerged ? 138 : 160;
                        gg = submerged ? 186 : 208;
                        b = submerged ? 30 : 40;
                        a = submerged ? 200 : 168;
                        break;
                    }
                    case FUME: {
                        r = 176;
                        gg = 196;
                        b = 74;
                        const fade = (life[i] ?? 0) * 2;
                        a = fade > 92 ? 92 : fade;
                        break;
                    }
                    case QUICK: {
                        // A bright specular band that walks with the tick, so a
                        // bead of quicksilver reads as metal and not as grey.
                        const sheen = ((g + tick * 3) & 31) < 8;
                        r = sheen ? 236 : 150;
                        gg = sheen ? 242 : 160;
                        b = sheen ? 250 : 178;
                        a = 246;
                        break;
                    }
                    case VOLT: {
                        // Flickers hard between white-hot and its own blue, so
                        // a charge never reads as a static dot of pigment.
                        const flash = ((g + tick * 7) & 15) < 6;
                        r = flash ? 252 : 128;
                        gg = flash ? 253 : 214;
                        b = 255;
                        a = 250;
                        break;
                    }
                    case MAGMA: {
                        // Cools visibly: `life` is the cooling counter, so the
                        // colour tells the player how long it has left.
                        const cooling = life[i] ?? 0;
                        const crust = cooling > 150 && ((g + cooling) & 7) < 3;
                        r = crust ? 122 : cooling > 110 ? 226 : 250;
                        gg = crust ? 74 : cooling > 110 ? 96 : 148;
                        b = crust ? 56 : cooling > 110 ? 34 : 40;
                        a = 246;
                        break;
                    }
                    case RESIN: {
                        // Darkens as it thickens.
                        const thick = (life[i] ?? 0) > 120;
                        r = thick ? 198 : 224;
                        gg = thick ? 130 : 158;
                        b = thick ? 34 : 50;
                        a = thick ? 236 : 206;
                        break;
                    }
                    case AMBER:
                        r = g < 30 ? 226 : 200;
                        gg = g < 30 ? 158 : 132;
                        b = g < 30 ? 52 : 38;
                        a = 240;
                        break;
                    case GUST: {
                        // Barely there. A gust is legible from what it moves,
                        // not from itself, and a solid mark would read as fog.
                        r = 224;
                        gg = 240;
                        b = 244;
                        const fade = life[i] ?? 0;
                        a = fade > 56 ? 56 : fade;
                        break;
                    }
                    case OBSIDIAN: {
                        const facet = ((g >> 2) & 7) < 2;
                        r = facet ? 74 : 34;
                        gg = facet ? 62 : 28;
                        b = facet ? 92 : 44;
                        a = 250;
                        break;
                    }
                    case FULGURITE:
                        r = g < 30 ? 214 : 186;
                        gg = g < 30 ? 206 : 178;
                        b = g < 30 ? 232 : 206;
                        a = 240;
                        break;
                    case AMALGAM:
                        r = g < 30 ? 196 : 172;
                        gg = g < 30 ? 204 : 180;
                        b = g < 30 ? 218 : 194;
                        a = 248;
                        break;
                    default:
                        r = 42;
                        gg = 38;
                        b = 34;
                        a = 200;
                }
            }

            // Granulation: pigment never dries perfectly flat.
            //
            // Widened deliberately. A narrow range averages out at a distance
            // and a pile of sand reads as one flat colour; this is what makes
            // individual grains visible now that the mark is no longer blurred.
            const grainScale = 224 + ((g & 31) << 1);
            r = (r * grainScale) >> 8;
            gg = (gg * grainScale) >> 8;
            b = (b * grainScale) >> 8;

            // Watercolour edge: the dark rim a drying pool leaves behind.
            // Gases have no meniscus, so they are exempt.
            if (element !== SMOKE && element !== STEAM && element !== HAZE && element !== MOTE) {
                const touchesPaper =
                    (x > 0 && (cells[i - 1] ?? EMPTY) === EMPTY) ||
                    (x < width - 1 && (cells[i + 1] ?? EMPTY) === EMPTY) ||
                    (y > 0 && (cells[i - width] ?? EMPTY) === EMPTY) ||
                    (y < height - 1 && (cells[i + width] ?? EMPTY) === EMPTY);
                if (touchesPaper) {
                    r = (r * 200) >> 8;
                    gg = (gg * 200) >> 8;
                    b = (b * 200) >> 8;
                    a += 34;
                }
            }

            words[i] = pack(r, gg, b, a);
        }
    }
}
