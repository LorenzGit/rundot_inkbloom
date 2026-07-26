/**
 * The pen.
 *
 * Every panel, star, bottle, and tool in this game is drawn here rather than
 * imported as an image, so the whole interface is resolution-free and shares
 * one hand. The wobble is deterministic per `seed`: a panel must look
 * hand-ruled, not jittery, so its irregularity has to be the *same* irregularity
 * on every frame.
 */
import { Graphics } from "pixi.js";
import { NoiseRandom } from "../noiseRandom.ts";
import { INK, CREAM } from "./palette.ts";

/**
 * A rectangle ruled by hand: four sides, each broken into short segments that
 * miss the true line by a hair.
 */
export function wobblyRect(g: Graphics, x: number, y: number, w: number, h: number, seed: number, wobble = 3): void {
    const random = new NoiseRandom(seed >>> 0, 0);
    const off = () => (random.nextDouble() - 0.5) * wobble;
    const corners: Array<[number, number]> = [
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
        [x, y],
    ];
    g.moveTo(x + off(), y + off());
    let px = x;
    let py = y;
    for (const [cx, cy] of corners) {
        for (let step = 1; step <= 4; step++) {
            const t = step / 4;
            g.lineTo(px + (cx - px) * t + off(), py + (cy - py) * t + off());
        }
        px = cx;
        py = cy;
    }
    g.closePath();
}

/**
 * The four-pointed star used for a confirmed discovery. Inked, not outlined —
 * it should look stamped into the page.
 */
export function starPath(g: Graphics, x: number, y: number, r: number): void {
    const waist = r * 0.18;
    g.moveTo(x, y - r);
    g.quadraticCurveTo(x + waist, y - waist, x + r, y);
    g.quadraticCurveTo(x + waist, y + waist, x, y + r);
    g.quadraticCurveTo(x - waist, y + waist, x - r, y);
    g.quadraticCurveTo(x - waist, y - waist, x, y - r);
    g.closePath();
}

/** An open five-petal mark used for the game's logotype flourish. */
export function bloomPath(g: Graphics, x: number, y: number, r: number): void {
    for (let petal = 0; petal < 5; petal++) {
        const angle = (petal / 5) * Math.PI * 2 - Math.PI / 2;
        const cx = x + Math.cos(angle) * r * 0.52;
        const cy = y + Math.sin(angle) * r * 0.52;
        g.circle(cx, cy, r * 0.42);
    }
}

export interface BottleStyle {
    /** Bottle size in design units (the glass is drawn inside this box). */
    size: number;
    /** Ink colour showing through the glass. */
    colour: number;
    /** Dimmed, dashed, and marked with its unlock requirement. */
    locked: boolean;
    /** Drawn on the dark desk band rather than on paper. */
    onDesk: boolean;
}

/**
 * A stoppered ink bottle. Locked bottles keep their silhouette so the shelf
 * always shows how much is still to come — the row never reflows as inks
 * arrive, which would move every target under the player's thumb.
 */
export function drawBottle(g: Graphics, style: BottleStyle): void {
    const { size: s, colour, locked, onDesk } = style;
    const outline = onDesk ? CREAM : INK;
    const outlineAlpha = onDesk ? 0.9 : 0.85;
    const bodyW = s * 0.62;
    const bodyH = s * 0.6;
    const neckW = s * 0.26;
    const neckH = s * 0.22;

    g.moveTo(-neckW / 2, -bodyH / 2 - neckH);
    g.lineTo(neckW / 2, -bodyH / 2 - neckH);
    g.lineTo(neckW / 2 + 1, -bodyH / 2);
    g.quadraticCurveTo(bodyW / 2 + 2, -bodyH / 2 + 2, bodyW / 2, bodyH / 8);
    g.quadraticCurveTo(bodyW / 2 + 1, bodyH / 2, 0, bodyH / 2);
    g.quadraticCurveTo(-bodyW / 2 - 1, bodyH / 2, -bodyW / 2, bodyH / 8);
    g.quadraticCurveTo(-bodyW / 2 - 2, -bodyH / 2 + 2, -neckW / 2 - 1, -bodyH / 2);
    g.closePath();
    // Frosted enough that even basalt — the darkest ink — reads against it.
    g.fill({ color: onDesk ? CREAM : 0xffffff, alpha: onDesk ? 0.42 : 0.55 });

    // The ink sitting in the bottom two thirds of the glass.
    g.rect(-bodyW / 2 - 2, -bodyH / 8, bodyW + 4, bodyH * 0.7);
    g.fill({ color: colour, alpha: locked ? 0.3 : 0.92 });

    g.moveTo(-neckW / 2, -bodyH / 2 - neckH);
    g.lineTo(neckW / 2, -bodyH / 2 - neckH);
    g.lineTo(neckW / 2 + 1, -bodyH / 2);
    g.quadraticCurveTo(bodyW / 2 + 2, -bodyH / 2 + 2, bodyW / 2, bodyH / 8);
    g.quadraticCurveTo(bodyW / 2 + 1, bodyH / 2, 0, bodyH / 2);
    g.quadraticCurveTo(-bodyW / 2 - 1, bodyH / 2, -bodyW / 2, bodyH / 8);
    g.quadraticCurveTo(-bodyW / 2 - 2, -bodyH / 2 + 2, -neckW / 2 - 1, -bodyH / 2);
    g.closePath();
    g.stroke({
        width: Math.max(1.4, s * 0.045),
        color: outline,
        alpha: locked ? outlineAlpha * 0.5 : outlineAlpha,
        cap: "round",
        join: "round",
    });
}

/** The kneaded gum eraser — deliberately the one shelf item that is not glass. */
export function drawEraser(g: Graphics, s: number, onDesk: boolean): void {
    g.moveTo(-s * 0.32, s * 0.18);
    g.quadraticCurveTo(-s * 0.38, -s * 0.18, -s * 0.05, -s * 0.26);
    g.quadraticCurveTo(s * 0.3, -s * 0.34, s * 0.34, s * 0.02);
    g.quadraticCurveTo(s * 0.36, s * 0.3, 0, s * 0.3);
    g.quadraticCurveTo(-s * 0.28, s * 0.32, -s * 0.32, s * 0.18);
    g.closePath();
    g.fill({ color: 0xc9bfa8, alpha: 0.94 });
    g.stroke({
        width: Math.max(1.4, s * 0.045),
        color: onDesk ? CREAM : INK,
        alpha: 0.85,
        cap: "round",
        join: "round",
    });
}

/** A torn-off sheet, used as the icon for clearing the page. */
export function drawTornSheetIcon(g: Graphics, s: number, onDesk: boolean): void {
    const w = s * 0.54;
    const h = s * 0.62;
    g.moveTo(-w / 2, -h / 2 + 3);
    for (let tooth = 0; tooth < 5; tooth++) {
        g.lineTo(-w / 2 + (w * (tooth + 0.5)) / 5, -h / 2 + ((tooth & 1) === 1 ? 3 : -1));
    }
    g.lineTo(w / 2, -h / 2 + 3);
    g.lineTo(w / 2, h / 2);
    g.lineTo(-w / 2, h / 2);
    g.closePath();
    g.fill({ color: 0xfcf9f0, alpha: 0.92 });
    g.stroke({ width: Math.max(1.3, s * 0.045), color: onDesk ? CREAM : INK, alpha: 0.85, join: "round" });

    g.moveTo(-w * 0.3, -h * 0.08);
    g.lineTo(w * 0.3, -h * 0.08);
    g.moveTo(-w * 0.3, h * 0.14);
    g.lineTo(w * 0.14, h * 0.14);
    g.stroke({ width: Math.max(1, s * 0.028), color: INK, alpha: 0.45 });
}

/** Two dots: the small and large brush, with the active one inked in. */
export function drawBrushIcon(g: Graphics, s: number, large: boolean, colour: number, onDesk: boolean): void {
    const outline = onDesk ? CREAM : INK;
    g.circle(-s * 0.22, 0, s * 0.1);
    if (!large) g.fill({ color: colour, alpha: 0.95 });
    g.stroke({ width: Math.max(1.3, s * 0.045), color: outline, alpha: 0.85 });

    g.circle(s * 0.17, 0, s * 0.23);
    if (large) g.fill({ color: colour, alpha: 0.95 });
    g.stroke({ width: Math.max(1.3, s * 0.045), color: outline, alpha: 0.85 });
}

/**
 * The dip pen that follows the pointer on devices that have one. Its tip sits
 * exactly on the cursor position so the player can aim.
 */
export function drawNib(g: Graphics, colour: number): void {
    g.moveTo(0, 0);
    g.quadraticCurveTo(-5, -9, -4.5, -17);
    g.lineTo(4.5, -17);
    g.quadraticCurveTo(5, -9, 0, 0);
    g.closePath();
    g.fill({ color: INK, alpha: 0.95 });

    g.moveTo(0, 0);
    g.quadraticCurveTo(-3, -4.5, -3, -7);
    g.lineTo(3, -7);
    g.quadraticCurveTo(3, -4.5, 0, 0);
    g.closePath();
    g.fill({ color: colour, alpha: 1 });

    g.moveTo(0, -2.5);
    g.lineTo(0, -13);
    g.stroke({ width: 1, color: 0xfcf9f0, alpha: 0.6 });

    g.moveTo(-4, -17);
    g.lineTo(4, -17);
    g.lineTo(2.6, -31);
    g.lineTo(-2.6, -31);
    g.closePath();
    g.fill({ color: 0x6b5a41, alpha: 1 });
}
