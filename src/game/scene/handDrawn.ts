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
import { CREAM, GOLD, INK } from "./palette.ts";

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
    /** Nominal bottle size in design units. The glass is drawn inside this box. */
    size: number;
    /** Ink colour showing through the glass. */
    colour: number;
    /** Not yet earned: silhouetted, dashed, and marked with its requirement. */
    locked: boolean;
    /** Drawn on the dark shelf rather than on paper. */
    onDesk: boolean;
}

/**
 * A stoppered apothecary bottle, drawn centred on the origin.
 *
 * Locked bottles keep their full silhouette rather than being hidden, so the
 * shelf always shows how much is still to come and the row never reflows as
 * inks arrive — which would move every target out from under the player's
 * thumb mid-session.
 *
 * The shapes are deliberately chunky: at ten slots across a phone these are
 * roughly 40 design units wide, and anything more delicate turns to mush.
 */
export function drawBottle(g: Graphics, style: BottleStyle): void {
    const { size: s, colour, locked } = style;

    // Proportions are tuned for the size these are actually seen at — roughly
    // 40 design units across on a phone. At that scale a bottle has to be a
    // *colour chip shaped like a bottle*, not a rendering of glassware: the
    // silhouette is filled with the ink itself so the eye reads "the blue one"
    // before it reads anything else.
    const bodyW = s * 0.62;
    const bodyH = s * 0.58;
    const top = -bodyH * 0.5;
    const base = bodyH * 0.5;
    const neckW = s * 0.26;
    const neckH = s * 0.16;
    const shoulder = s * 0.1;
    const corkW = s * 0.32;
    const corkH = s * 0.15;
    const corkTop = top - neckH - corkH;
    const radius = s * 0.13;

    // Contact shadow, so the row reads as objects standing in a tray.
    g.ellipse(0, base + s * 0.07, bodyW * 0.6, s * 0.075);
    g.fill({ color: 0x000000, alpha: 0.4 });

    /** The full silhouette: shoulders curving out of a short neck. */
    const body = (): void => {
        g.moveTo(-neckW / 2, top - neckH);
        g.lineTo(neckW / 2, top - neckH);
        g.lineTo(neckW / 2, top - neckH * 0.2);
        g.quadraticCurveTo(bodyW / 2, top, bodyW / 2, top + shoulder);
        g.lineTo(bodyW / 2, base - radius);
        g.quadraticCurveTo(bodyW / 2, base, bodyW / 2 - radius, base);
        g.lineTo(-bodyW / 2 + radius, base);
        g.quadraticCurveTo(-bodyW / 2, base, -bodyW / 2, base - radius);
        g.lineTo(-bodyW / 2, top + shoulder);
        g.quadraticCurveTo(-bodyW / 2, top, -neckW / 2, top - neckH * 0.2);
        g.closePath();
    };

    // Base colour, then a darker wash over the lower half. Two layered fills
    // stand in for the vertical gradient Pixi Graphics cannot express, and are
    // what stop the bottle reading as a flat sticker.
    body();
    // A locked bottle is slate, not a faded version of its ink — on a wooden
    // shelf a low-alpha tint just turns into more wood. It keeps a hint of its
    // colour so the player can still see which ink is coming.
    if (locked) {
        g.fill({ color: 0x4c4a58 });
        body();
        g.fill({ color: colour, alpha: 0.28 });
    } else {
        g.fill({ color: colour });
    }
    if (!locked) {
        g.roundRect(-bodyW / 2, base - bodyH * 0.55, bodyW, bodyH * 0.55, radius);
        g.fill({ color: 0x000000, alpha: 0.18 });
        // The meniscus: a pale line where the ink stops and air begins.
        g.roundRect(-bodyW / 2, top + shoulder * 0.4, bodyW, s * 0.11, radius * 0.5);
        g.fill({ color: 0xffffff, alpha: 0.3 });
    }

    if (!locked) {
        // One soft specular down the left shoulder. One highlight reads as
        // glass; two read as decoration.
        g.roundRect(-bodyW * 0.34, top + shoulder * 0.9, s * 0.07, bodyH * 0.62, s * 0.035);
        g.fill({ color: 0xffffff, alpha: 0.34 });
    }

    // A light rim, matching every other raised surface in the game. A dark
    // outline here made the row look like clip art.
    body();
    g.stroke({
        width: Math.max(1.6, s * 0.05),
        color: 0xffffff,
        alpha: locked ? 0.16 : 0.55,
        join: "round",
    });

    // Cork: a rounded plug with a lit top face.
    g.roundRect(-corkW / 2, corkTop, corkW, corkH + neckH * 0.5, s * 0.05);
    g.fill({ color: locked ? 0x4a4260 : 0xb08753 });
    if (!locked) {
        g.roundRect(-corkW / 2, corkTop, corkW, corkH * 0.42, s * 0.05);
        g.fill({ color: 0xd8b077, alpha: 0.9 });
    }
}

/**
 * The gold badge a locked bottle wears, behind its requirement number.
 *
 * A pill across the foot of the slot rather than a disc in the corner, and —
 * the part that took three goes to get right — **sized from its own number**.
 *
 * Every earlier version derived the badge from the bottle while the number was
 * derived from what is legible on a phone, and the two disagreed every time the
 * shelf changed: first the disc was narrower than a two-digit gate, then the
 * pill was shorter than the digits' line box and the gold rim ran through them.
 * A caller passes the geometry in; `shelfMetrics` derives it from the font size
 * so there is one cascade and nothing left to disagree about.
 *
 * Sitting at the foot also leaves the bottle's silhouette and colour clear, so
 * the player still sees *which* ink is coming, not just that something is.
 *
 * Drawn separately from the bottle so the number can live in a Text object.
 */
export interface LockBadge {
    /** Centre of the badge, relative to the slot centre. */
    y: number;
    width: number;
    height: number;
    fontSize: number;
}

export function drawLockPill(g: Graphics, badge: LockBadge, scale: number): void {
    const w = badge.width * scale;
    const h = badge.height * scale;
    const y = badge.y * scale;
    g.roundRect(-w / 2, y - h / 2 + h * 0.08, w, h, h / 2);
    g.fill({ color: 0x000000, alpha: 0.4 });
    g.roundRect(-w / 2, y - h / 2, w, h, h / 2);
    g.fill({ color: 0x1a1528 });
    g.roundRect(-w / 2, y - h / 2, w, h, h / 2);
    g.stroke({ width: Math.max(1.4, h * 0.11), color: GOLD, alpha: 0.95 });
}

/**
 * The eraser.
 *
 * Built from the same parts as a bottle — contact shadow, body, lit top face,
 * light rim — so it sits in the row as a sibling rather than as a grey lump.
 * It is the one shelf item that is not glass, and the flat block shape is what
 * says so.
 */
export function drawEraser(g: Graphics, s: number, _onDesk: boolean): void {
    const w = s * 0.6;
    const h = s * 0.46;

    g.ellipse(0, h / 2 + s * 0.09, w * 0.6, s * 0.075);
    g.fill({ color: 0x000000, alpha: 0.4 });

    g.roundRect(-w / 2, -h / 2, w, h, s * 0.1);
    g.fill({ color: 0xf6ecd8 });
    // The worn, ink-stained end.
    g.roundRect(-w / 2, h * 0.06, w, h * 0.44, s * 0.1);
    g.fill({ color: 0x9c8a76, alpha: 0.6 });
    // Lit top face.
    g.roundRect(-w / 2, -h / 2, w, h * 0.3, s * 0.1);
    g.fill({ color: 0xffffff, alpha: 0.5 });

    g.roundRect(-w / 2, -h / 2, w, h, s * 0.1);
    g.stroke({ width: Math.max(1.6, s * 0.05), color: 0xffffff, alpha: 0.5, join: "round" });
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
