/**
 * The sheet itself.
 *
 * Drawn once into an offscreen canvas and uploaded as a texture, because paper
 * grain must be *stable* — if the fibre re-randomised every frame the page
 * would crawl. Everything here is procedural: no image asset ships, and the
 * sheet renders at whatever resolution the device deserves.
 *
 * Deterministic by construction (`NoiseRandom`, never `Math.random`), so the
 * same sheet seed always produces the same sheet.
 */
import { Texture } from "pixi.js";
import { NoiseRandom } from "../noiseRandom.ts";
import type { PaperStyle } from "./papers.ts";

export interface PaperOptions {
    /** Texture size in pixels. */
    width: number;
    height: number;
    /** Sheet seed — every torn-off page gets a new one, so no two sheets match. */
    seed: number;
    style: PaperStyle;
    /** Skip the expensive fibre and foxing passes on low-quality devices. */
    detailed: boolean;
}

/**
 * Build a paper texture. The caller owns destruction: call `texture.destroy(true)`
 * when the sheet is replaced so the canvas-backed GPU resource is released.
 */
export function createPaperTexture({ width, height, seed, style, detailed }: PaperOptions): Texture {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(2, Math.round(width));
    canvas.height = Math.max(2, Math.round(height));
    const context = canvas.getContext("2d");
    if (!context) return Texture.WHITE;

    const w = canvas.width;
    const h = canvas.height;
    const random = new NoiseRandom(seed >>> 0, 0);
    const unit = () => random.nextDouble();
    const scale = w / 720;

    context.fillStyle = style.base;
    context.fillRect(0, 0, w, h);

    // Fibre speckle: the difference between "a beige rectangle" and "paper".
    const speckles = detailed ? Math.round((w * h) / 46) : Math.round((w * h) / 190);
    for (let i = 0; i < speckles; i++) {
        const x = unit() * w;
        const y = unit() * h;
        const dark = unit() < 0.5;
        const tint = dark ? style.speckleDark : style.speckleLight;
        const alpha = dark ? 0.03 + unit() * 0.05 : 0.04 + unit() * 0.05;
        context.fillStyle = `rgba(${tint},${alpha.toFixed(3)})`;
        context.fillRect(x, y, 1 + unit() * 1.7, 1 + unit() * 1.3);
    }

    if (detailed) {
        // Long fibres pressed into the sheet during making.
        context.lineWidth = 1;
        const fibres = Math.round((w * h) / 1_700);
        for (let i = 0; i < fibres; i++) {
            const x = unit() * w;
            const y = unit() * h;
            const angle = unit() * Math.PI * 2;
            const length = (4 + unit() * 15) * scale;
            context.strokeStyle = `rgba(${style.fibre},${(0.025 + unit() * 0.03).toFixed(3)})`;
            context.beginPath();
            context.moveTo(x, y);
            context.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
            context.stroke();
        }

        // Foxing — the faint rust blooms an old sheet picks up at its edges.
        if (style.foxing) {
            const blooms = 5 + Math.floor(unit() * 4);
            for (let i = 0; i < blooms; i++) {
                const nearLeftEdge = unit() < 0.5;
                const x = nearLeftEdge ? unit() * w * 0.22 : w - unit() * w * 0.22;
                const y = unit() * h;
                const radius = (14 + unit() * 34) * scale;
                const bloom = context.createRadialGradient(x, y, 0, x, y, radius);
                bloom.addColorStop(0, `rgba(${style.foxing},${(0.05 + unit() * 0.04).toFixed(3)})`);
                bloom.addColorStop(1, `rgba(${style.foxing},0)`);
                context.fillStyle = bloom;
                context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
            }
        }
    }

    if (style.grid) {
        const step = w / style.grid.cells;
        context.strokeStyle = style.grid.colour;
        context.lineWidth = Math.max(1, scale);
        context.beginPath();
        for (let x = step; x < w; x += step) {
            context.moveTo(Math.round(x) + 0.5, 0);
            context.lineTo(Math.round(x) + 0.5, h);
        }
        for (let y = step; y < h; y += step) {
            context.moveTo(0, Math.round(y) + 0.5);
            context.lineTo(w, Math.round(y) + 0.5);
        }
        context.stroke();
    }

    // Lamp falloff toward the corners.
    const vignette = context.createRadialGradient(w / 2, h * 0.44, h * 0.34, w / 2, h * 0.5, h * 0.94);
    vignette.addColorStop(0, `rgba(${style.vignette},0)`);
    vignette.addColorStop(1, `rgba(${style.vignette},${style.dark ? 0.42 : 0.13})`);
    context.fillStyle = vignette;
    context.fillRect(0, 0, w, h);

    return Texture.from(canvas);
}

/**
 * Hand-ruled border, returned in 0..1 page space so the caller can stroke it at
 * whatever size the page happens to be.
 *
 * The wobble is what sells "ruled with a pen against a straight edge" rather
 * than "rectangle". It is deterministic per seed so it does not shimmer.
 */
export function ruledBorderPath(seed: number, inset = 0.016): Array<[number, number]> {
    const random = new NoiseRandom(seed >>> 0, 0);
    const jitter = () => (random.nextDouble() - 0.5) * 0.007;
    const corners: Array<[number, number]> = [
        [inset, inset],
        [1 - inset, inset],
        [1 - inset, 1 - inset],
        [inset, 1 - inset],
    ];
    const points: Array<[number, number]> = [];
    for (let corner = 0; corner < 4; corner++) {
        const from = corners[corner] ?? [0, 0];
        const to = corners[(corner + 1) % 4] ?? [0, 0];
        for (let step = 0; step < 5; step++) {
            const t = step / 5;
            points.push([from[0] + (to[0] - from[0]) * t + jitter(), from[1] + (to[1] - from[1]) * t + jitter()]);
        }
    }
    const first = points[0];
    if (first) points.push([first[0], first[1]]);
    return points;
}
