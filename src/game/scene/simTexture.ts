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
    BASALT,
    BLOSSOM,
    BRIAR,
    BRINE,
    CRYSTAL,
    EMBER,
    EMPTY,
    FROST,
    GLASS,
    GRIT,
    HAZE,
    ICE,
    MOTE,
    PITCH,
    RILL,
    RIME,
    SALT,
    SILT,
    SMOKE,
    SPORE,
    STEAM,
} from "../sim/elements.ts";

/**
 * Blur radii, in cells.
 *
 * The mark gets a single-cell blur: combined with the roughly 4.5x bilinear
 * magnification to the page, that is what turns a grid of cells into something
 * with a wet edge. The bleed gets a wide one for the halo that spreads into the
 * fibre around every mark.
 */
const MARK_RADIUS = 1;
const BLEED_RADIUS = 3;

export interface SimTexture {
    /** The mark itself. */
    readonly mark: Texture;
    /** The wet halo drawn underneath it. */
    readonly bleed: Texture;
    /** Repaint from the simulation and push new pixels to the GPU. */
    update(sim: InkSim, withBleed: boolean): void;
    destroy(): void;
}

export function createSimTexture(width: number, height: number): SimTexture {
    const cells = width * height;
    const rawPixels = new Uint8Array(cells * 4);
    const rawWords = new Uint32Array(rawPixels.buffer);
    const markPixels = new Uint8Array(cells * 4);
    const bleedPixels = new Uint8Array(cells * 4);
    const scratch = new Uint8Array(cells * 4);

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
    const mark = new Texture({ source: markSource });
    const bleed = new Texture({ source: bleedSource });

    return {
        mark,
        bleed,
        update(sim, withBleed) {
            paint(sim, rawWords, width, height);
            blur(rawPixels, markPixels, scratch, width, height, MARK_RADIUS);
            markSource.update();
            if (!withBleed) return;
            blur(rawPixels, bleedPixels, scratch, width, height, BLEED_RADIUS);
            bleedSource.update();
        },
        destroy() {
            mark.destroy(true);
            bleed.destroy(true);
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
                    default:
                        r = 42;
                        gg = 38;
                        b = 34;
                        a = 200;
                }
            }

            // Granulation: pigment never dries perfectly flat.
            const grainScale = 238 + (g & 31);
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
