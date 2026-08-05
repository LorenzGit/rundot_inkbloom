/**
 * The page, the shelf, and the hand between them.
 *
 * This is the only place that touches the simulation, and the only place that
 * reads a pointer. Its shape:
 *
 *   - a fixed-step simulation clock, decoupled from the render frame and hard
 *     capped so a backgrounded tab cannot come back and run a hundred steps;
 *   - a display list that never changes structure at runtime, only layout, so
 *     rotating the device or opening a panel costs nothing;
 *   - a strict boundary with React — celebrations, counts, and selection are
 *     pushed to the store when they change, and nothing is read back per frame.
 *
 * The ink is drawn twice: a wide, faint halo for the wetness pigment pushes
 * into the fibre, and the mark itself over the top. Both multiply into the
 * paper so the sheet's grain reads through every stroke.
 */
import { Container, Graphics, Sprite, Text, TextStyle, type Application, type Texture } from "pixi.js";
import type { Stage } from "../stage.ts";
import { InkSim } from "../sim/inkSim.ts";
import { BASALT, ELEMENT_COUNT, ERASER_INDEX, INKS } from "../sim/elements.ts";
import { DISCOVERIES, DISCOVERY_COUNT } from "../sim/discoveries.ts";
import { pageStirs } from "../sim/stirs.ts";
import { createSimTexture, type SimTexture } from "./simTexture.ts";
import { createPaperTexture, ruledBorderPath } from "./paperTexture.ts";
import { paperStyle } from "./papers.ts";
import {
    CARD,
    CARD_INK,
    CARD_MUTED,
    CREAM,
    GOLD,
    GOLD_DEEP,
    GOLD_GLOW,
    HAND,
    MOTION,
    RIM,
    SERIF,
    UI,
    WOOD,
    WOOD_DARK,
} from "./palette.ts";
import {
    drawBottle,
    drawBrushIcon,
    drawEraser,
    drawLockPill,
    drawNib,
    type LockBadge,
    drawTornSheetIcon,
    starPath,
} from "./handDrawn.ts";
import { readSafeInsets } from "./safeArea.ts";
import { publishLockBadges, publishPageRect, publishShelfSlots, publishSimProbe } from "../../qa/browserContract.ts";
import {
    BRUSH_LARGE,
    BRUSH_SMALL,
    MAX_CATCHUP_STEPS,
    POUR_TAIL_STEPS,
    SIM_HEIGHT,
    SIM_STEP_MS,
    simWidthForAspect,
    TAP_MAX_MS,
} from "../constants.ts";
import { store } from "../../state/store.ts";
import { inkAudio } from "../../audio/inkAudio.ts";
import {
    foundIndicesFromSave,
    isInkUnlocked,
    nextInkUnlock,
    recordDiscovery,
    takeCelebrations,
    type Celebration,
} from "../../systems/progress.ts";
import { evaluate as evaluatePrompt, noteSheetReactions, resetSheetReactions } from "../../systems/dailyPrompt.ts";
import { folio } from "../../systems/folio.ts";
import { borrowAvailability, endBorrow } from "../../systems/monetization.ts";
import { saveSystem } from "../../systems/save.ts";
import { runtimeServices } from "../../systems/runtimeServices.ts";
import { t } from "../../systems/localization.ts";
import { NoiseRandom } from "../noiseRandom.ts";

import { analytics, FIRST_PLAY_FUNNEL } from "../../systems/analytics/analyticsConfig.ts";
export interface Scene {
    destroy(): void;
}

/** Layout in design units. The short edge is fixed at 720 by `stage.ts`. */
/**
 * Desk left visible down each side of the sheet.
 *
 * Small on purpose: the sheet is the game, and the page used to be letterboxed
 * inside a fixed aspect ratio that left a wide teal band on both sides. All
 * that is left is enough room for the drop shadow to read as a sheet lying on
 * a desk rather than as a hole cut in it.
 */
const PAGE_MARGIN = 9;
/** Gap between the bottom of the sheet and the lip of the shelf. */
const PAGE_TO_SHELF = 10;
/**
 * Reserved for the React HUD above the canvas.
 *
 * The progress chip is a 2.85rem control plus padding; at the fixed 720-unit
 * design width that is about 150 units. Under-reserving slides the sheet
 * beneath the chip, which looks like a bug and eats the top of the page.
 */
const HEADER_RESERVE = 152;

type ShelfKind = "ink" | "brush" | "tear" | "mirror";

interface ShelfItem {
    kind: ShelfKind;
    /** Shelf slot for `ink`. */
    index: number;
    x: number;
    y: number;
    /** Size of the thing drawn inside the slot. */
    size: number;
    /**
     * The recess the item sits in. Owned by the layout, never re-derived at
     * draw time — deriving it from `size` there is what let the slots grow
     * wider than the pitch they were laid out on and overlap their neighbours.
     */
    slotW: number;
    slotH: number;
}

/** Bare plank left between two slots. */
const SLOT_GAP = 6;

/**
 * How many ink slots sit in the top row. The rest go underneath.
 *
 * Fifteen bottles will not fit across a phone at a size worth tapping — a
 * single row put them at about 31 design units, which is a 17px target. Two
 * rows cost roughly 100 units of plank and buy back a *larger* bottle than the
 * original ten-ink row had, which is the trade worth making.
 */
const INK_ROW_ONE = Math.ceil(INKS.length / 2);

/**
 * Shelf geometry, derived once from the available width.
 *
 * Everything cascades from the slot pitch downward — pitch, then slot, then
 * the bottle inside it — so a slot can never be wider than the space allotted
 * to it. Deriving the slot *from* the bottle is what let them overlap: the
 * bottle was clamped to a maximum, the slot was 1.28x the bottle, and on a
 * wide-ish phone that product exceeded the pitch.
 *
 * The row offsets are part of the same cascade rather than being re-derived at
 * layout time, so `contentHeight` and the actual control positions cannot
 * disagree about how tall the plank is.
 */
interface ShelfMetrics {
    slotPitch: number;
    slotW: number;
    slotH: number;
    bottleSize: number;
    toolSize: number;
    toolSlotW: number;
    toolSlotH: number;
    /** The locked-bottle badge, derived from its own font size. */
    lockBadge: LockBadge;
    /** Row centres, measured down from the tray lip. */
    rowOneOffset: number;
    rowTwoOffset: number;
    toolRowOffset: number;
    /** Total plank height this content needs, excluding the bottom safe area. */
    contentHeight: number;
}

function shelfMetrics(available: number): ShelfMetrics {
    const slotPitch = (available - SLOT_GAP * 2) / INK_ROW_ONE;
    const slotW = slotPitch - SLOT_GAP;
    const bottleSize = Math.max(28, Math.min(62, slotW * 0.78));
    const slotH = bottleSize * 1.58;
    const toolSize = Math.max(30, Math.min(50, bottleSize * 0.82));
    const toolSlotH = toolSize * 1.34;

    // The badge cascade, in this order and no other: pick a font size that is
    // legible on a phone, give the pill room for that font's *line box* rather
    // than its cap height, then sit the pill on the slot's bottom edge so it
    // cannot hang into the row below however tall it turns out to be.
    const lockFontSize = Math.max(24, bottleSize * 0.4);
    const lockHeight = lockFontSize * 1.5;
    const lockBadge: LockBadge = {
        fontSize: lockFontSize,
        height: lockHeight,
        width: Math.max(lockHeight * 1.7, slotW * 0.74),
        y: slotH / 2 - lockHeight / 2 - 2,
    };

    const rowOneOffset = 46 + slotH / 2;
    const rowTwoOffset = rowOneOffset + slotH + 4;
    const toolRowOffset = rowTwoOffset + slotH / 2 + 16 + toolSlotH / 2;
    return {
        slotPitch,
        slotW,
        slotH,
        bottleSize,
        toolSize,
        toolSlotW: toolSize * 1.5,
        toolSlotH,
        lockBadge,
        rowOneOffset,
        rowTwoOffset,
        toolRowOffset,
        contentHeight: toolRowOffset + toolSlotH / 2 + 20,
    };
}

interface Particle {
    active: boolean;
    x: number;
    y: number;
    vx: number;
    vy: number;
    age: number;
    life: number;
    radius: number;
    colour: number;
}

interface Toast extends Celebration {
    age: number;
}

/**
 * The page's box, given the design space and the insets.
 *
 * Pulled out of `layout()` so the grid can be sized from it *before* the
 * simulation exists: the sheet fills the whole band, so the number of columns
 * is a property of the device rather than a constant.
 */
function pageBox(stage: Stage): { x: number; y: number; w: number; h: number; shelfTop: number } {
    const width = stage.designWidth();
    const height = stage.designHeight();
    const insets = readSafeInsets();
    const scale = stage.scale() || 1;
    const safeTop = insets.top / scale;
    const safeLeft = insets.left / scale;
    const safeRight = insets.right / scale;
    const headerHeight = HEADER_RESERVE + safeTop;
    const shelfTop = height - (shelfMetrics(width - safeLeft - safeRight).contentHeight + insets.bottom / scale);
    const w = width - safeLeft - safeRight - PAGE_MARGIN * 2;
    const h = Math.max(160, shelfTop - headerHeight - PAGE_TO_SHELF);
    return { x: safeLeft + PAGE_MARGIN, y: headerHeight, w, h, shelfTop };
}

export function createPageScene(app: Application, stage: Stage): Scene {
    const state = store.get();
    const sheetRandom = new NoiseRandom(0xa5c0_1a3b, 0);

    // Sized once, from the space the sheet is actually going to occupy. A later
    // resize stretches the same grid rather than rebuilding it, because a new
    // grid means a blank page and losing the player's work to a rotating status
    // bar is a far worse bug than a cell that is a percent off square.
    const firstBox = pageBox(stage);
    const SIM_WIDTH = simWidthForAspect(firstBox.w / firstBox.h);

    const sim = new InkSim({
        width: SIM_WIDTH,
        height: SIM_HEIGHT,
        seed: 0x1ac0_ffee,
        found: foundIndicesFromSave(state.discoveries),
    });

    // ------------------------------------------------------------ display list

    const desk = new Graphics();
    const pageGroup = new Container();
    const pageShadow = new Graphics();
    const paperSprite = new Sprite();
    const inkLayer = new Container();
    const bleedSprite = new Sprite();
    const inkSprite = new Sprite();
    const glowSprite = new Sprite();
    const ruleGraphics = new Graphics();
    const stirGraphics = new Graphics();
    const tornSprite = new Sprite();
    const shelfGroup = new Container();
    const shelfGraphics = new Graphics();
    const shelfLabel = new Text({
        text: "",
        style: new TextStyle({ fontFamily: UI, fontSize: 36, fontWeight: "900", fill: 0x4a2c0c, letterSpacing: 2 }),
    });
    const flashGraphics = new Graphics();
    const particleGraphics = new Graphics();
    const toastGroup = new Container();
    const toastCard = new Graphics();
    const toastTitle = new Text({
        text: "",
        style: new TextStyle({ fontFamily: UI, fontSize: 44, fontWeight: "900", fill: CARD_INK }),
    });
    const toastNote = new Text({
        text: "",
        style: new TextStyle({ fontFamily: HAND, fontSize: 30, fill: CARD_MUTED }),
    });
    /** "№ 23 / 60" — the find's place in the journal, pressed into the card. */
    const toastStamp = new Text({
        text: "",
        style: new TextStyle({ fontFamily: SERIF, fontSize: 24, fill: CARD_MUTED }),
    });
    const hintLine = new Text({ text: t("HintFirstTouch"), style: labelStyle(17, 0x2a2622, HAND) });
    const cursor = new Container();
    const cursorNib = new Graphics();
    const cursorRing = new Graphics();

    const simTexture: SimTexture = createSimTexture(SIM_WIDTH, SIM_HEIGHT);
    bleedSprite.texture = simTexture.bleed;
    inkSprite.texture = simTexture.mark;
    glowSprite.texture = simTexture.glow;

    /**
     * Both layers blend straight onto the paper, with no Pixi filter anywhere
     * near them. Two attempts at doing this on the GPU failed for reasons worth
     * recording, because both look like the obvious approach:
     *
     *   - a blur filter *on* the ink sprite is composited by the filter pass
     *     rather than by the sprite's own blend mode, so `multiply` is ignored
     *     and every ink lands as a flat black silhouette;
     *   - moving the filter into an offscreen render target fixes the colour
     *     but leaves a filtered child in an off-stage render group, which feeds
     *     Pixi's renderable validator a stale entry and crashes the renderer
     *     mid-frame as soon as there is ink on the page.
     *
     * The softness is produced in `simTexture` instead, by blurring the cell
     * buffer directly — cheaper than either GPU path, and it cannot break the
     * frame.
     */
    bleedSprite.alpha = 0.34;
    inkSprite.alpha = 0.96;
    bleedSprite.blendMode = "multiply";
    inkSprite.blendMode = "multiply";
    // The light plate. `add` regardless of paper: pigment swaps to `screen` on
    // dark sheets, but light is light on any ground. A Sprite, never a
    // Graphics — an additive Graphics silently renders nothing.
    glowSprite.blendMode = "add";

    inkLayer.addChild(bleedSprite, inkSprite);
    pageGroup.addChild(pageShadow, paperSprite, inkLayer, ruleGraphics, stirGraphics, glowSprite, tornSprite);
    stirGraphics.alpha = 0;
    shelfGroup.addChild(shelfGraphics, shelfLabel);
    toastGroup.addChild(toastCard, toastTitle, toastNote, toastStamp);
    toastGroup.visible = false;
    cursor.addChild(cursorNib, cursorRing);
    cursor.visible = false;
    tornSprite.visible = false;
    tornSprite.anchor.set(0.5);

    stage.root.addChild(desk, pageGroup, flashGraphics, hintLine, shelfGroup, particleGraphics, toastGroup, cursor);

    // ------------------------------------------------------------------ state

    let paperTexture: Texture | null = null;
    let tornTexture: Texture | null = null;
    let sheetSeed = sheetRandom.nextUint();
    let currentPaper = state.paper;
    let currentQuality = state.quality;
    let selected = clampSlot(state.selectedInk);
    let largeBrush = state.largeBrush;
    let mirror = state.mirrorBrush && state.ownsKit;

    const page = { x: 0, y: 0, w: 720, h: 960 };
    const shelf = { top: 0, height: 220 };
    let shelfItems: ShelfItem[] = [];
    // Kept alongside the items because the badge is slot geometry, and both the
    // draw pass and the lock-mark layout have to agree about it exactly.
    let lockBadge: LockBadge = shelfMetrics(stage.designWidth()).lockBadge;
    let lastBorrowedInk: number | null = store.get().borrowedInk;

    const particles: Particle[] = Array.from({ length: 120 }, () => ({
        active: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        age: 0,
        life: 1,
        radius: 2,
        colour: 0xffffff,
    }));
    const toasts: Toast[] = [];

    let painting = false;
    let pointerId: number | null = null;
    let pressedAt = 0;
    let brushCellX = 0;
    let brushCellY = 0;
    let lastCellX = 0;
    let lastCellY = 0;
    let pourRemaining = 0;
    let pourX = 0;
    let pourY = 0;
    let hasHoverPointer = false;
    let hintAlpha = 1;
    /**
     * Selection feedback, split by meaning.
     *
     * `pops` is a scale overshoot on a successful pick — it reads as "yes,
     * that one". `refusals` is the left-right shake, kept ONLY for tapping a
     * locked bottle, because a shake is universally the gesture for "no". They
     * used to be the same animation, which made every selection feel like an
     * error.
     */
    const pops = new Float32Array(INKS.length);
    const refusals = new Float32Array(INKS.length);
    let selectionPulse = 0;
    let tearProgress = 0;
    /** 1 the instant a secret is found, easing back to 0. */
    let celebration = 0;
    let celebrationColour = 0xf5b841;
    /**
     * The held beat: the simulation stands still for a breath when a secret
     * fires, so the player sees the moment instead of its aftermath. Only the
     * first find of a burst holds — a chain reaction must not stutter.
     */
    let celebrationHoldMs = 0;
    /** Expanding ring at the reacting cell. Negative age means inactive. */
    let bloomX = 0;
    let bloomY = 0;
    let bloomAge = -1;
    /**
     * The page stirring: an unfound secret's elements are all on the sheet.
     *
     * `stirActive` is the fact, re-checked about twice a second; `stirLevel`
     * eases toward it so the shimmer breathes in and out rather than snapping.
     */
    let stirActive = false;
    let stirLevel = 0;
    let stirPhase = 0;
    let stirCheckMs = 0;
    const elementCensus = new Uint32Array(ELEMENT_COUNT);
    /** Marks made since the last Folio capture — a clean sheet is never kept. */
    let sheetDirty = false;
    let accumulatorMs = 0;
    let frameAverageMs = 8;
    let framesSeen = 0;
    let bleedEnabled = state.quality === "high";
    let bleedLocked = false;
    let destroyed = false;

    // ----------------------------------------------------------------- helpers

    function labelStyle(size: number, colour: number, family: string = SERIF): TextStyle {
        return new TextStyle({ fontFamily: family, fontSize: size, fill: colour, align: "left" });
    }

    function clampSlot(slot: number): number {
        if (!Number.isInteger(slot) || slot < 0 || slot >= INKS.length) return 0;
        return isInkUnlocked(slot, store.get().discoveryCount) ? slot : 0;
    }

    function rebuildPaper(): void {
        const style = paperStyle(currentPaper);
        const resolution = currentQuality === "high" ? 2 : 1;
        const texture = createPaperTexture({
            width: Math.round(page.w * resolution),
            height: Math.round(page.h * resolution),
            seed: sheetSeed,
            style,
            detailed: currentQuality === "high",
        });
        paperTexture?.destroy(true);
        paperTexture = texture;
        paperSprite.texture = texture;
        // The blend lives on each sprite, never on `inkLayer`: a blend mode on
        // the container turns it into an isolated render group, and the first
        // child then blends against transparent black instead of the paper —
        // which silhouettes every ink in flat black.
        bleedSprite.blendMode = style.inkBlend;
        inkSprite.blendMode = style.inkBlend;
        // Screening ink onto a dark sheet needs less halo or it fogs the page.
        bleedSprite.alpha = style.inkBlend === "screen" ? 0.22 : 0.34;
        drawRule();
        drawDesk();
    }

    function drawDesk(): void {
        const style = paperStyle(currentPaper);
        const width = stage.designWidth();
        const height = stage.designHeight();
        desk.clear();
        desk.rect(0, 0, width, height).fill({ color: style.desk });
        // A single warm pool of lamplight, centred on the page.
        const glowRadius = Math.max(width, height) * 0.62;
        for (let ring = 6; ring >= 1; ring--) {
            desk.circle(width / 2, page.y + page.h * 0.35, (glowRadius * ring) / 6);
            desk.fill({ color: style.deskLamp, alpha: 0.05 });
        }
    }

    function drawRule(): void {
        const style = paperStyle(currentPaper);
        ruleGraphics.clear();
        const points = ruledBorderPath(sheetSeed);
        const first = points[0];
        if (!first) return;
        ruleGraphics.moveTo(page.x + first[0] * page.w, page.y + first[1] * page.h);
        for (let index = 1; index < points.length; index++) {
            const point = points[index];
            if (point) ruleGraphics.lineTo(page.x + point[0] * page.w, page.y + point[1] * page.h);
        }
        ruleGraphics.stroke({ width: 2.2, color: style.rule, alpha: 0.2, cap: "round", join: "round" });
        drawStir();
    }

    /**
     * The stir shimmer: the same ruled border, re-traced in gold.
     *
     * Drawn once here and animated purely through `stirGraphics.alpha`, so the
     * tell costs nothing per frame. It deliberately says only "something is
     * possible on this sheet" — which secret, and where, stays the page's
     * business.
     */
    function drawStir(): void {
        stirGraphics.clear();
        const points = ruledBorderPath(sheetSeed);
        const first = points[0];
        if (!first) return;
        stirGraphics.moveTo(page.x + first[0] * page.w, page.y + first[1] * page.h);
        for (let index = 1; index < points.length; index++) {
            const point = points[index];
            if (point) stirGraphics.lineTo(page.x + point[0] * page.w, page.y + point[1] * page.h);
        }
        stirGraphics.stroke({ width: 5, color: GOLD_GLOW, cap: "round", join: "round" });
    }

    // ----------------------------------------------------------------- layout

    function layout(): void {
        const width = stage.designWidth();
        const height = stage.designHeight();
        const insets = readSafeInsets();
        const scale = stage.scale() || 1;
        const safeTop = insets.top / scale;
        const safeBottom = insets.bottom / scale;
        const safeLeft = insets.left / scale;
        const safeRight = insets.right / scale;

        const headerHeight = HEADER_RESERVE + safeTop;

        // The shelf is sized by its contents, not by a share of the screen, so
        // the bottles are the same comfortable size on every phone and the
        // sheet gets everything that is left.
        const metrics = shelfMetrics(width - safeLeft - safeRight);
        shelf.height = metrics.contentHeight + safeBottom;
        shelf.top = height - shelf.height;

        // The sheet takes the whole band. The grid was sized from this box, so
        // there is nothing to letterbox and no bare desk down either side.
        page.w = width - safeLeft - safeRight - PAGE_MARGIN * 2;
        page.h = Math.max(160, shelf.top - headerHeight - PAGE_TO_SHELF);
        page.x = safeLeft + PAGE_MARGIN;
        page.y = headerHeight;

        paperSprite.position.set(page.x, page.y);
        paperSprite.width = page.w;
        paperSprite.height = page.h;
        for (const sprite of [bleedSprite, inkSprite, glowSprite]) {
            sprite.position.set(page.x, page.y);
            sprite.width = page.w;
            sprite.height = page.h;
        }
        tornSprite.position.set(page.x + page.w / 2, page.y + page.h / 2);
        tornSprite.width = page.w;
        tornSprite.height = page.h;

        drawPageShadow();

        hintLine.anchor.set(0.5, 1);
        hintLine.position.set(page.x + page.w / 2, page.y + page.h - 18);
        hintLine.style.fontSize = Math.max(28, page.w * 0.046);

        layoutShelf(width, safeLeft, safeRight, metrics);
        layoutLockMarks();
        layoutToolCaptions();
        drawRule();
        drawDesk();
        rebuildPaperIfPageResized();
    }

    /**
     * The sheet's shadow.
     *
     * Three stacked shadows rather than one: a tight dark contact shadow that
     * anchors the sheet to the desk, and two progressively wider, fainter ones
     * that lift it off. A rim of warm light along the top edge finishes the
     * illusion — without it the sheet reads as a hole cut in the desk.
     */
    function drawPageShadow(): void {
        pageShadow.clear();
        // Lighter than they were: on a bright teal ground a heavy black shadow
        // reads as a dirty band rather than as depth.
        for (const [spread, drop, alpha] of [
            [24, 20, 0.09],
            [12, 10, 0.13],
            [4, 3, 0.2],
        ] as const) {
            pageShadow.roundRect(
                page.x - spread,
                page.y - spread * 0.35 + drop,
                page.w + spread * 2,
                page.h + spread,
                5,
            );
            pageShadow.fill({ color: 0x000000, alpha });
        }
        pageShadow.rect(page.x - 1, page.y - 1.5, page.w + 2, 1.5);
        pageShadow.fill({ color: CREAM, alpha: 0.28 });
    }

    let lastPaperWidth = 0;
    function rebuildPaperIfPageResized(): void {
        // Regenerating a whole sheet on every resize frame would be wasteful;
        // only do it when the page has actually changed size meaningfully.
        if (Math.abs(page.w - lastPaperWidth) < 8 && paperTexture) return;
        lastPaperWidth = page.w;
        rebuildPaper();
    }

    /** Place the shelf's controls using geometry already derived by `shelfMetrics`. */
    function layoutShelf(width: number, safeLeft: number, safeRight: number, metrics: ShelfMetrics): void {
        shelfItems = [];
        const { slotPitch, slotW, slotH, bottleSize, toolSize, toolSlotW, toolSlotH } = metrics;
        lockBadge = metrics.lockBadge;
        const centre = safeLeft + (width - safeLeft - safeRight) / 2;

        const labelY = shelf.top + 24;
        const rowOneY = shelf.top + metrics.rowOneOffset;
        const rowTwoY = shelf.top + metrics.rowTwoOffset;

        // Each row is centred on its own, so the shorter second row sits under
        // the middle of the first rather than hanging off the left edge.
        for (let slot = 0; slot < INKS.length; slot++) {
            const inRowOne = slot < INK_ROW_ONE;
            const column = inRowOne ? slot : slot - INK_ROW_ONE;
            const count = inRowOne ? INK_ROW_ONE : INKS.length - INK_ROW_ONE;
            const rowStart = centre - (count * slotPitch) / 2 + slotPitch / 2;
            shelfItems.push({
                kind: "ink",
                index: slot,
                x: rowStart + column * slotPitch,
                y: inRowOne ? rowOneY : rowTwoY,
                size: bottleSize,
                slotW,
                slotH,
            });
        }

        const tools: ShelfKind[] = mirror ? ["brush", "mirror", "tear"] : ["brush", "tear"];
        // Wide enough for the *captions*, which are longer than the icons: at
        // icon pitch, "size" and "new sheet" ran into each other.
        const toolPitch = Math.max(toolSlotW + SLOT_GAP * 3, 168);
        tools.forEach((kind, position) => {
            const offset = (position - (tools.length - 1) / 2) * toolPitch;
            shelfItems.push({
                kind,
                index: -1,
                x: centre + offset,
                y: shelf.top + metrics.toolRowOffset,
                size: toolSize,
                slotW: toolSlotW,
                slotH: toolSlotH,
            });
        });

        shelfLabel.anchor.set(0.5, 0.5);
        shelfLabel.position.set(centre, labelY);
        shelfLabel.style.fontSize = Math.max(34, bottleSize * 0.6);
    }

    // -------------------------------------------------------------- shelf draw

    function drawShelf(): void {
        const width = stage.designWidth();
        shelfGraphics.clear();

        // The tray is a wooden plank: the one heavy, warm object on screen,
        // and the thing that makes the row read as a shelf of real bottles
        // rather than a toolbar. Layered fills stand in for a gradient, which
        // Pixi Graphics has no primitive for.
        const top = shelf.top;
        const bottom = stage.designHeight();
        const height = bottom - top;
        shelfGraphics.roundRect(-24, top, width + 48, height + 40, 30).fill({ color: WOOD });
        const bands = 9;
        for (let band = 1; band < bands; band++) {
            const t = band / bands;
            shelfGraphics.rect(0, top + height * t, width, height / bands + 1);
            shelfGraphics.fill({ color: WOOD_DARK, alpha: t * 0.42 });
        }
        // Front lip: a bright edge and the shadow the sheet casts onto it.
        shelfGraphics.roundRect(-24, top, width + 48, 5, 3).fill({ color: 0xffd7a3, alpha: 0.6 });
        shelfGraphics.rect(0, top + 5, width, 18).fill({ color: WOOD_DARK, alpha: 0.3 });

        const discoveries = store.get().discoveryCount;
        for (const item of shelfItems) {
            const pop = item.kind === "ink" ? (pops[item.index] ?? 0) : 0;
            const refusal = item.kind === "ink" ? (refusals[item.index] ?? 0) : 0;
            const isSelected = item.kind === "ink" && item.index === selected;
            const ink = item.kind === "ink" ? INKS[item.index] : undefined;
            const locked = item.kind === "ink" && !isInkUnlocked(item.index, discoveries);

            // Every control sits in a rounded slot, which is what makes the row
            // read as a set of buttons rather than a line of loose objects.
            const { slotW, slotH } = item;
            const slotX = item.x - slotW / 2;
            const slotY = item.y - slotH * (item.kind === "ink" ? 0.62 : 0.5);
            // Slots are cut *into* the plank, so an unselected bottle sits in a
            // recess and the selected one is lifted out of it onto a bright
            // amber card with its own bottom edge.
            shelfGraphics.roundRect(slotX, slotY, slotW, slotH, 16);
            shelfGraphics.fill({ color: WOOD_DARK, alpha: isSelected ? 0.1 : 0.34 });
            if (isSelected && !locked) {
                shelfGraphics.roundRect(slotX, slotY + 5, slotW, slotH, 16);
                shelfGraphics.fill({ color: GOLD_DEEP });
                shelfGraphics.roundRect(slotX, slotY, slotW, slotH, 16);
                shelfGraphics.fill({ color: GOLD });
                shelfGraphics.roundRect(slotX + 4, slotY + 4, slotW - 8, slotH * 0.38, 12);
                shelfGraphics.fill({ color: 0xffffff, alpha: 0.32 });
            }

            shelfGraphics.save();
            // A pop is an ease-out overshoot: big immediately, settling back.
            //
            // Applied as a size multiplier, NOT a scale transform. Pixi composes
            // `scaleTransform` after `translateTransform` such that the existing
            // translation is scaled too — at a shelf y of ~1400 design units a
            // 1.16x pop threw the bottle 200 units down the screen.
            const popScale = pop > 0 ? 1 + Math.sin(pop * Math.PI) * 0.18 : 1;
            const drawSize = item.size * popScale;
            shelfGraphics.translateTransform(
                item.x + (refusal > 0 ? Math.sin(refusal * 34) * item.size * 0.13 * refusal : 0),
                item.y + (isSelected ? -item.size * 0.1 : 0),
            );

            if (item.kind === "ink" && ink) {
                if (item.index === ERASER_INDEX) drawEraser(shelfGraphics, drawSize, true);
                else drawBottle(shelfGraphics, { size: drawSize, colour: ink.colour, locked, onDesk: true });
                if (locked) drawLockPill(shelfGraphics, lockBadge, popScale);
            } else if (item.kind === "brush") {
                drawBrushIcon(shelfGraphics, drawSize, largeBrush, INKS[selected]?.colour ?? GOLD, true);
            } else if (item.kind === "mirror") {
                drawMirrorIcon(shelfGraphics, drawSize);
            } else {
                drawTornSheetIcon(shelfGraphics, drawSize, true);
            }
            shelfGraphics.restore();
        }

        refreshLockMarks(discoveries);
    }

    function drawMirrorIcon(g: Graphics, size: number): void {
        g.moveTo(0, -size * 0.34).lineTo(0, size * 0.34);
        g.stroke({ width: Math.max(1.2, size * 0.04), color: CREAM, alpha: 0.55 });
        for (const direction of [-1, 1]) {
            g.moveTo(direction * size * 0.1, size * 0.2);
            g.quadraticCurveTo(direction * size * 0.34, size * 0.02, direction * size * 0.14, -size * 0.26);
            g.stroke({
                width: Math.max(1.5, size * 0.055),
                color: INKS[selected]?.colour ?? GOLD,
                alpha: mirror ? 0.95 : 0.4,
                cap: "round",
            });
        }
    }

    /**
     * The requirement written on a locked bottle.
     *
     * These `Text` objects are created once and then only shown, hidden and
     * repositioned. Building display objects inside the frame loop — even
     * cheap ones — churns Pixi's render-group update list and eventually feeds
     * it a stale entry, which crashes the renderer mid-frame.
     */
    const lockLayer = new Container();
    const lockMarks: Text[] = INKS.map((ink) => {
        const mark = new Text({
            text: ink.unlockAt > 0 ? `${ink.unlockAt}` : "",
            style: new TextStyle({ fontFamily: UI, fontSize: 26, fontWeight: "800", fill: GOLD, align: "center" }),
        });
        mark.anchor.set(0.5);
        mark.alpha = 0.85;
        mark.visible = false;
        lockLayer.addChild(mark);
        return mark;
    });
    shelfGroup.addChild(lockLayer);

    /**
     * Captions under the two tools.
     *
     * The bottles explain themselves — they are bottles — but a pair of
     * abstract marks does not, and "what does the torn page do" is exactly the
     * question you cannot afford a player to answer by tapping it.
     */
    const toolCaptions = new Map<ShelfKind, Text>();
    for (const [kind, label] of [
        ["brush", "size"],
        ["mirror", "mirror"],
        ["tear", "new sheet"],
    ] as const) {
        const caption = new Text({
            text: label,
            style: new TextStyle({
                fontFamily: UI,
                fontSize: 24,
                fontWeight: "800",
                fill: 0x5a3714,
                align: "center",
                letterSpacing: 0.6,
            }),
        });
        caption.anchor.set(0.5, 0);
        caption.alpha = 0.9;
        caption.visible = false;
        shelfGroup.addChild(caption);
        toolCaptions.set(kind, caption);
    }

    function layoutToolCaptions(): void {
        for (const caption of toolCaptions.values()) caption.visible = false;
        for (const item of shelfItems) {
            if (item.kind === "ink") continue;
            const caption = toolCaptions.get(item.kind);
            if (!caption) continue;
            caption.style.fontSize = Math.max(24, item.size * 0.46);
            caption.position.set(item.x, item.y + item.size * 0.46);
            caption.visible = true;
        }
    }

    function layoutLockMarks(): void {
        for (const mark of lockMarks) mark.visible = false;
        for (const item of shelfItems) {
            if (item.kind !== "ink") continue;
            const mark = lockMarks[item.index];
            if (!mark) continue;
            mark.style.fontSize = lockBadge.fontSize;
            mark.position.set(item.x, item.y + lockBadge.y);
        }
        refreshLockMarks(store.get().discoveryCount);
    }

    function refreshLockMarks(discoveries: number): void {
        for (const item of shelfItems) {
            if (item.kind !== "ink") continue;
            const mark = lockMarks[item.index];
            if (!mark) continue;
            mark.visible = !isInkUnlocked(item.index, discoveries);
        }
    }

    // ---------------------------------------------------------------- painting

    function toCellX(designX: number): number {
        const cell = Math.floor(((designX - page.x) / page.w) * SIM_WIDTH);
        return cell < 0 ? 0 : cell >= SIM_WIDTH ? SIM_WIDTH - 1 : cell;
    }

    function toCellY(designY: number): number {
        const cell = Math.floor(((designY - page.y) / page.h) * SIM_HEIGHT);
        return cell < 0 ? 0 : cell >= SIM_HEIGHT ? SIM_HEIGHT - 1 : cell;
    }

    function onPage(designX: number, designY: number): boolean {
        return designX >= page.x && designX <= page.x + page.w && designY >= page.y && designY <= page.y + page.h;
    }

    function brushRadius(): number {
        const ink = INKS[selected];
        const base = largeBrush ? BRUSH_LARGE : BRUSH_SMALL;
        return ink?.element === -1 ? base + 1 : base;
    }

    function stamp(cx: number, cy: number, strength: number): void {
        const ink = INKS[selected];
        if (!ink) return;
        const radius = brushRadius();
        sim.paint(cx, cy, ink.element, radius, strength);
        if (mirror) sim.paint(SIM_WIDTH - 1 - cx, cy, ink.element, radius, strength);
        sheetDirty = true;
    }

    function stampLine(ax: number, ay: number, bx: number, by: number): void {
        const dx = bx - ax;
        const dy = by - ay;
        const steps = Math.max(1, Math.floor(Math.max(Math.abs(dx), Math.abs(dy))));
        for (let step = 0; step <= steps; step++) {
            stamp(Math.round(ax + (dx * step) / steps), Math.round(ay + (dy * step) / steps), 1);
        }
    }

    // ------------------------------------------------------------------- input

    function toDesign(event: PointerEvent): { x: number; y: number } {
        const rect = app.canvas.getBoundingClientRect();
        const scale = stage.scale() || 1;
        return { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale };
    }

    /**
     * Nearest shelf item to a tap, with no dead space.
     *
     * Anywhere below the shelf's top rule belongs to the shelf, so a thumb
     * reaching the very edge of the screen still lands on the outermost bottle
     * instead of on nothing. The row is chosen first — a tap between the two
     * rows should not jump columns — and then the nearest item in it wins.
     */
    function hitShelf(x: number, y: number): ShelfItem | null {
        if (y < shelf.top - 12 || shelfItems.length === 0) return null;

        let nearestRowY = Number.POSITIVE_INFINITY;
        for (const item of shelfItems) {
            if (Math.abs(y - item.y) < Math.abs(y - nearestRowY)) nearestRowY = item.y;
        }

        let best: ShelfItem | null = null;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const item of shelfItems) {
            if (item.y !== nearestRowY) continue;
            const distance = Math.abs(x - item.x);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = item;
            }
        }
        return best;
    }

    function selectInk(slot: number): void {
        const ink = INKS[slot];
        if (!ink) return;
        if (!isInkUnlocked(slot, store.get().discoveryCount)) {
            refusals[slot] = 1;
            inkAudio.play("deny");
            void runtimeServices.haptic("warning");
            // Tapping a bottle you cannot have is the clearest statement of
            // intent in the game. If it is the *next* one and a loan is on
            // offer, answer with the offer instead of only a number — the
            // shelf still arrives in the order the game intends, because only
            // ever the next bottle can be borrowed.
            const next = nextInkUnlock(store.get().discoveryCount);
            if (next?.slot === slot && borrowAvailability().visible) {
                store.patch({ borrowOffer: slot });
                return;
            }
            store.patch({ toast: `${ink.unlockAt} discoveries to open this one` });
            return;
        }
        // Pop even when re-picking the same bottle: the tap should always be
        // acknowledged, or it feels broken.
        pops[slot] = 1;
        if (selected === slot) return;
        selected = slot;
        selectionPulse = 1;
        inkAudio.play("select");
        void runtimeServices.haptic("light");
        store.patch({ selectedInk: slot });
        void saveSystem.flush();
    }

    function toggleBrush(): void {
        largeBrush = !largeBrush;
        inkAudio.play("tap");
        void runtimeServices.haptic("light");
        store.patch({ largeBrush });
        void saveSystem.flush();
    }

    function toggleMirror(): void {
        if (!store.get().ownsKit) return;
        mirror = !mirror;
        inkAudio.play("tap");
        void runtimeServices.haptic("light");
        store.patch({ mirrorBrush: mirror });
        void saveSystem.flush();
    }

    /**
     * Compose the sheet into a small JPEG for the Folio.
     *
     * Deliberately not a Pixi extract: WebGPU readback is async, WebGL needs
     * `preserveDrawingBuffer`, and the cell buffers already live on the CPU in
     * `simTexture`. A 2D canvas composite of paper colour × mark (+ glow) is
     * synchronous, renderer-independent, and safe to run even mid-teardown.
     * Returns null for a sheet without enough work on it to be worth keeping.
     */
    function captureSheetImage(): string | null {
        if (sim.liveCount < 140) return null;
        try {
            const style = paperStyle(currentPaper);
            const cellCanvas = document.createElement("canvas");
            cellCanvas.width = SIM_WIDTH;
            cellCanvas.height = SIM_HEIGHT;
            const cellContext = cellCanvas.getContext("2d");
            if (!cellContext) return null;

            // putImageData expects straight alpha; the plate is premultiplied.
            const unpremultiply = (source: Uint8Array): ImageData => {
                const image = cellContext.createImageData(SIM_WIDTH, SIM_HEIGHT);
                const out = image.data;
                for (let i = 0; i < source.length; i += 4) {
                    const alpha = source[i + 3] ?? 0;
                    if (alpha === 0) continue;
                    out[i] = Math.min(255, (((source[i] ?? 0) * 255) / alpha) | 0);
                    out[i + 1] = Math.min(255, (((source[i + 1] ?? 0) * 255) / alpha) | 0);
                    out[i + 2] = Math.min(255, (((source[i + 2] ?? 0) * 255) / alpha) | 0);
                    out[i + 3] = alpha;
                }
                return image;
            };

            const scale = 3;
            const output = document.createElement("canvas");
            output.width = SIM_WIDTH * scale;
            output.height = SIM_HEIGHT * scale;
            const context = output.getContext("2d");
            if (!context) return null;
            context.fillStyle = style.base;
            context.fillRect(0, 0, output.width, output.height);
            context.imageSmoothingEnabled = true;

            cellContext.putImageData(unpremultiply(simTexture.markPixels), 0, 0);
            // Same compositing the live page uses: pigment multiplies into
            // light paper and screens onto dark.
            context.globalCompositeOperation = style.inkBlend === "screen" ? "screen" : "multiply";
            context.drawImage(cellCanvas, 0, 0, output.width, output.height);

            cellContext.clearRect(0, 0, SIM_WIDTH, SIM_HEIGHT);
            cellContext.putImageData(unpremultiply(simTexture.glowPixels), 0, 0);
            context.globalCompositeOperation = "lighter";
            context.drawImage(cellCanvas, 0, 0, output.width, output.height);

            return output.toDataURL("image/jpeg", 0.7);
        } catch (error) {
            // A failed capture loses a gallery entry, never the tear itself.
            console.warn("[scene] sheet capture failed", error);
            return null;
        }
    }

    /** Keep the sheet in the Folio if it has unkept work on it. */
    function captureToFolio(): void {
        if (!sheetDirty) return;
        const image = captureSheetImage();
        if (image) folio.record(image);
        sheetDirty = false;
    }

    /**
     * The sheet's furniture: one to three thin basalt ledges printed into the
     * upper page before the player touches it.
     *
     * Gravity drags everything to the bottom sixth of a tall sheet, so the
     * upper two-thirds were dead space no pour could ever occupy for long.
     * A printed ledge is something to build weather over, drip wax onto, and
     * pool rain against — the upturned lips make each one a shallow basin.
     * It is ordinary basalt: the eraser removes it, acid opens it, and it
     * counts honestly toward the stir. Deterministic from the sheet seed; the
     * very first sheet stays blank so the opening page is the player's alone,
     * and one sheet in four arrives clean for the same reason.
     */
    function printFurniture(): void {
        if (store.get().pagesTorn === 0) return;
        // `^` yields a SIGNED 32-bit value and NoiseRandom rejects negatives.
        const random = new NoiseRandom((sheetSeed ^ 0x5afe_c0de) >>> 0, 0);
        // One sheet in four arrives clean — except the first torn sheet, which
        // always shows the mechanic. The seed sequence is deterministic, so a
        // blank roll here would hide furniture from every player's second page.
        if (store.get().pagesTorn > 1 && random.float(0, 1) < 0.25) return;

        const bands: ReadonlyArray<readonly [number, number]> = [
            [0.16, 0.28],
            [0.34, 0.46],
            [0.52, 0.62],
        ];
        let printed = 0;
        for (const [top, bottom] of bands) {
            // Each band prints independently, and the middle one is forced if
            // the dice left the sheet bare — "furniture" must mean furniture.
            const wanted = random.float(0, 1) < 0.55;
            const isLastChance = printed === 0 && bottom > 0.6;
            if (!wanted && !isLastChance) continue;
            printed++;

            const y = Math.round(SIM_HEIGHT * random.float(top, bottom));
            const widthCells = Math.round(SIM_WIDTH * random.float(0.2, 0.42));
            const x0 = Math.round(random.float(0.06, 0.94) * (SIM_WIDTH - widthCells));
            for (let x = x0; x <= x0 + widthCells; x++) {
                sim.etch(x, y, BASALT);
                sim.etch(x, y + 1, BASALT);
            }
            // The lips: a one-cell rise at each end, so the ledge holds water.
            sim.etch(x0, y - 1, BASALT);
            sim.etch(x0 + widthCells, y - 1, BASALT);
        }
    }

    function tearOffSheet(): void {
        captureToFolio();
        // Snapshot what is being torn away so it can fly off the desk, then
        // give the next sheet a genuinely different grain and border.
        tornTexture?.destroy(true);
        tornTexture = app.renderer.generateTexture({ target: pageGroup, resolution: 1 });
        tornSprite.texture = tornTexture;
        tornSprite.visible = true;
        tearProgress = 1;

        sim.clear();
        // A new sheet is a new shelf: a borrowed bottle goes back.
        endBorrow();
        if (!isInkUnlocked(selected, store.get().discoveryCount)) selectInk(0);
        resetSheetReactions();
        sheetSeed = sheetRandom.nextUint();
        lastPaperWidth = 0;
        rebuildPaperIfPageResized();
        inkAudio.play("tear");
        void runtimeServices.haptic("medium");
        const current = store.get();
        store.patch({ pagesTorn: current.pagesTorn + 1, toast: t("ToastSheetTorn") });
        // After the count and the seed both roll: the furniture belongs to the
        // NEW sheet, and its "first sheet stays blank" gate reads pagesTorn.
        printFurniture();
        runtimeServices.track("sheet_torn", { sheets: current.pagesTorn + 1, discoveries: current.discoveryCount });
        void saveSystem.flush();
    }

    function handlePointerDown(event: PointerEvent): void {
        if (store.get().overlay !== "none" || store.get().paused) return;
        void inkAudio.unlock();
        const point = toDesign(event);
        if (event.pointerType === "mouse") {
            hasHoverPointer = true;
            cursor.position.set(point.x, point.y);
        }

        const item = hitShelf(point.x, point.y);
        if (item) {
            event.preventDefault();
            if (item.kind === "ink") selectInk(item.index);
            else if (item.kind === "brush") toggleBrush();
            else if (item.kind === "mirror") toggleMirror();
            else tearOffSheet();
            return;
        }
        if (!onPage(point.x, point.y)) return;

        event.preventDefault();
        painting = true;
        pointerId = event.pointerId;
        pressedAt = performance.now();
        pourRemaining = 0;
        brushCellX = toCellX(point.x);
        brushCellY = toCellY(point.y);
        lastCellX = brushCellX;
        lastCellY = brushCellY;
        stamp(brushCellX, brushCellY, 1);
        inkAudio.stroke(INKS[selected]?.name === "EMBER" ? "fizz" : "nib", 3);
        try {
            app.canvas.setPointerCapture(event.pointerId);
        } catch {
            /* capture is a nicety, not a requirement */
        }
        const current = store.get();
        store.patch({ strokes: current.strokes + 1 });
    }

    function handlePointerMove(event: PointerEvent): void {
        const point = toDesign(event);
        if (event.pointerType === "mouse") {
            hasHoverPointer = true;
            cursor.position.set(point.x, point.y);
        }
        if (!painting || (pointerId !== null && event.pointerId !== pointerId)) return;
        const cellX = toCellX(point.x);
        const cellY = toCellY(point.y);
        const travelled = Math.abs(cellX - lastCellX) + Math.abs(cellY - lastCellY);
        if (travelled > 0) {
            stampLine(lastCellX, lastCellY, cellX, cellY);
            lastCellX = cellX;
            lastCellY = cellY;
            if (travelled > 1) {
                inkAudio.stroke(INKS[selected]?.name === "EMBER" ? "fizz" : "nib", travelled);
            }
        }
        brushCellX = cellX;
        brushCellY = cellY;
    }

    function handlePointerUp(event: PointerEvent): void {
        if (!painting || (pointerId !== null && event.pointerId !== pointerId)) return;
        painting = false;
        pointerId = null;
        // A dab should still be a drop of ink, so a quick tap keeps pouring
        // briefly and then tapers off rather than stopping mid-bead.
        if (performance.now() - pressedAt < TAP_MAX_MS) {
            pourRemaining = POUR_TAIL_STEPS;
            pourX = brushCellX;
            pourY = brushCellY;
        }
    }

    function handleKeyDown(event: KeyboardEvent): void {
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        if (store.get().overlay !== "none") return;
        const key = event.key;
        // `1`-`0` reach the first ten; the `qwertyui` row continues along the
        // shelf's second row, which is where those bottles physically are.
        if (key >= "1" && key <= "9") {
            selectInk(key.charCodeAt(0) - 49);
            event.preventDefault();
            return;
        }
        if (key === "0") {
            selectInk(9);
            event.preventDefault();
            return;
        }
        const overflow = "qwertyui".indexOf(key.toLowerCase());
        if (overflow >= 0 && key.length === 1) {
            selectInk(10 + overflow);
            event.preventDefault();
            return;
        }
        if (key === "e" || key === "E") {
            selectInk(ERASER_INDEX);
            return;
        }
        if (key === "b" || key === "B" || key === " ") {
            toggleBrush();
            event.preventDefault();
            return;
        }
        if (key === "m" || key === "M") {
            toggleMirror();
            return;
        }
        if (key === "x" || key === "X") {
            tearOffSheet();
            return;
        }
        if (key === "ArrowRight" || key === "ArrowDown") {
            cycleInk(1);
            event.preventDefault();
            return;
        }
        if (key === "ArrowLeft" || key === "ArrowUp") {
            cycleInk(-1);
            event.preventDefault();
        }
    }

    function cycleInk(direction: number): void {
        const discoveries = store.get().discoveryCount;
        let slot = selected;
        for (let attempt = 0; attempt < INKS.length; attempt++) {
            slot = (slot + direction + INKS.length) % INKS.length;
            if (isInkUnlocked(slot, discoveries)) {
                selectInk(slot);
                return;
            }
        }
    }

    function handlePointerLeave(): void {
        hasHoverPointer = false;
    }

    app.canvas.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    app.canvas.addEventListener("pointerleave", handlePointerLeave);
    window.addEventListener("keydown", handleKeyDown);

    // ------------------------------------------------------------- particles

    function spawnParticle(
        x: number,
        y: number,
        vx: number,
        vy: number,
        colour: number,
        radius: number,
        life: number,
    ): void {
        for (const particle of particles) {
            if (particle.active) continue;
            particle.active = true;
            particle.x = x;
            particle.y = y;
            particle.vx = vx;
            particle.vy = vy;
            particle.colour = colour;
            particle.radius = radius;
            particle.age = 0;
            particle.life = life;
            return;
        }
    }

    const burstRandom = new NoiseRandom(0x3b0f_1c77, 0);

    /** A simulation cell's centre, in design units on the page. */
    function cellPoint(cell: number): { x: number; y: number } {
        return {
            x: page.x + ((cell % SIM_WIDTH) + 0.5) * (page.w / SIM_WIDTH),
            y: page.y + (Math.floor(cell / SIM_WIDTH) + 0.5) * (page.h / SIM_HEIGHT),
        };
    }

    function burstAtCell(cell: number, colour: number, count: number): void {
        if (store.get().reducedMotion) return;
        const { x: cx, y: cy } = cellPoint(cell);
        for (let index = 0; index < count; index++) {
            const angle = burstRandom.float(0, Math.PI * 2);
            const speed = burstRandom.float(30, 130);
            spawnParticle(
                cx,
                cy,
                Math.cos(angle) * speed,
                Math.sin(angle) * speed - 55,
                colour,
                burstRandom.float(1, 2.8),
                burstRandom.float(0.5, 0.8),
            );
        }
    }

    function updateParticles(dt: number): void {
        particleGraphics.clear();
        for (const particle of particles) {
            if (!particle.active) continue;
            particle.age += dt;
            if (particle.age >= particle.life) {
                particle.active = false;
                continue;
            }
            particle.vy += 340 * dt;
            particle.x += particle.vx * dt;
            particle.y += particle.vy * dt;
            const remaining = 1 - particle.age / particle.life;
            particleGraphics.circle(particle.x, particle.y, particle.radius * (0.5 + remaining * 0.5));
            particleGraphics.fill({ color: particle.colour, alpha: remaining * 0.6 });
        }
    }

    // ---------------------------------------------------------------- toasts

    function updateToasts(dt: number): void {
        const reduced = store.get().reducedMotion;
        for (const event of takeCelebrations()) {
            const startsBurst = toasts.length === 0;
            toasts.push({ ...event, age: 0 });
            if (event.kind === "unlock") inkAudio.play("unlock");
            if (event.cell !== null) {
                burstAtCell(event.cell, event.colour, 18);
                if (!reduced) {
                    const point = cellPoint(event.cell);
                    bloomX = point.x;
                    bloomY = point.y;
                    bloomAge = 0;
                }
            }
            if (event.kind === "discovery" && startsBurst && !reduced) celebrationHoldMs = 420;
            celebration = 1;
            celebrationColour = event.colour;
        }

        const current = toasts[0];
        if (!current) {
            toastGroup.visible = false;
            return;
        }
        current.age += dt;
        const duration = MOTION.dwellMs / 1_000;
        if (current.age > duration) {
            toasts.shift();
            return;
        }
        const entered = Math.min(1, current.age / (MOTION.revealMs / 1_000));
        const eased = 1 - (1 - entered) ** 3;
        const fade = current.age > duration - 0.3 ? (duration - current.age) / 0.3 : Math.min(1, entered * 2.2);

        const label = current.title;
        toastTitle.text = label;
        toastNote.text = current.note;
        toastTitle.style.fontSize = Math.max(42, page.w * 0.072);
        toastNote.style.fontSize = Math.max(28, page.w * 0.048);
        toastStamp.text =
            current.kind === "discovery" && current.ordinal !== null ? `№ ${current.ordinal} / ${DISCOVERY_COUNT}` : "";
        toastStamp.visible = toastStamp.text.length > 0;
        toastStamp.style.fontSize = Math.max(22, page.w * 0.037);

        const padding = 20;
        const iconWidth = 44;
        const stampWidth = toastStamp.visible ? toastStamp.width + 22 : 0;
        const cardWidth = Math.min(
            stage.designWidth() - 32,
            Math.max(toastTitle.width + stampWidth, toastNote.width) + padding * 2 + iconWidth,
        );
        const cardHeight = toastTitle.height + toastNote.height + padding * 1.4;
        const centreX = stage.designWidth() / 2;
        const restY = page.y + 34;
        const y = reduced ? restY : -cardHeight + eased * (restY + cardHeight);

        toastGroup.visible = true;
        toastGroup.alpha = fade;
        toastGroup.position.set(centreX, y);
        toastGroup.rotation = 0;

        // A raised card in the game's chrome, not a note on the page: it is a
        // reward announcement and should read like every other UI surface.
        toastCard.clear();
        toastCard.roundRect(-cardWidth / 2, -cardHeight / 2 + 5, cardWidth, cardHeight, 18);
        toastCard.fill({ color: 0x000000, alpha: 0.45 });
        toastCard.roundRect(-cardWidth / 2, -cardHeight / 2, cardWidth, cardHeight, 18);
        toastCard.fill({ color: CARD });
        toastCard.roundRect(-cardWidth / 2 + 6, -cardHeight / 2 + 4, cardWidth - 12, cardHeight * 0.34, 12);
        toastCard.fill({ color: RIM, alpha: 0.5 });
        toastCard.roundRect(-cardWidth / 2, -cardHeight / 2, cardWidth, cardHeight, 18);
        toastCard.stroke({ width: 3, color: current.colour, alpha: 0.9 });

        // The medal: the discovery's own colour behind a gold star.
        const iconX = -cardWidth / 2 + 26;
        toastCard.circle(iconX, 0, 15).fill({ color: current.colour, alpha: 0.9 });
        starPath(toastCard, iconX, 0, 8);
        toastCard.fill({ color: 0xffffff, alpha: 0.95 });

        toastTitle.anchor.set(0, 1);
        toastTitle.position.set(-cardWidth / 2 + iconWidth + 4, 2);
        toastNote.anchor.set(0, 0);
        toastNote.position.set(-cardWidth / 2 + iconWidth + 4, 4);
        // The stamp shares the title's baseline, pressed against the far edge.
        toastStamp.anchor.set(1, 1);
        toastStamp.position.set(cardWidth / 2 - padding * 0.75, 0);
    }

    /**
     * The reward flash.
     *
     * A rim of the discovery's own colour races around the sheet and fades.
     * It reads instantly in peripheral vision, which matters because the player
     * is usually watching the reaction, not the counter — and unlike a particle
     * burst it works even when the discovery happened off-screen.
     */
    function updateCelebration(dt: number): void {
        flashGraphics.clear();

        // The bloom: a ring rolling out from the exact cell that reacted,
        // so the eye is led to *where* it happened, not just that it did.
        if (bloomAge >= 0) {
            bloomAge += dt;
            const life = 0.7;
            const progress = bloomAge / life;
            if (progress >= 1) {
                bloomAge = -1;
            } else {
                const eased = 1 - (1 - progress) ** 2;
                const radius = 14 + eased * page.w * 0.24;
                flashGraphics.circle(bloomX, bloomY, radius);
                flashGraphics.stroke({
                    width: 4 * (1 - progress) + 1.5,
                    color: celebrationColour,
                    alpha: (1 - progress) * 0.55,
                });
                flashGraphics.circle(bloomX, bloomY, radius * 0.62);
                flashGraphics.stroke({ width: 2.5, color: GOLD_GLOW, alpha: (1 - progress) * 0.4 });
            }
        }

        if (celebration <= 0) return;
        celebration = Math.max(0, celebration - dt * (store.get().reducedMotion ? 4 : 1.9));
        const strength = celebration * celebration;
        for (let ring = 4; ring >= 1; ring--) {
            const spread = ring * 9 * (0.4 + celebration * 0.6);
            flashGraphics.roundRect(page.x - spread, page.y - spread, page.w + spread * 2, page.h + spread * 2, 8);
            flashGraphics.stroke({ width: 5, color: celebrationColour, alpha: strength * 0.16 });
        }
        flashGraphics.roundRect(page.x - 2, page.y - 2, page.w + 4, page.h + 4, 5);
        flashGraphics.stroke({ width: 3, color: GOLD_GLOW, alpha: strength * 0.7 });
    }

    // ---------------------------------------------------------------- cursor

    function updateCursor(): void {
        const visible = hasHoverPointer && store.get().overlay === "none";
        cursor.visible = visible;
        if (!visible) return;
        cursorNib.clear();
        cursorNib.rotation = 0.62;
        drawNib(cursorNib, INKS[selected]?.colour ?? GOLD);
        cursorNib.rotation = 0.62;
        cursorRing.clear();
        cursorRing.circle(0, 0, brushRadius() * (page.w / SIM_WIDTH));
        cursorRing.stroke({ width: 1, color: 0x2a2622, alpha: 0.25 });
    }

    // -------------------------------------------------------------- main loop

    function syncFromStore(): void {
        const current = store.get();
        if (current.paper !== currentPaper || current.quality !== currentQuality) {
            currentPaper = current.paper;
            currentQuality = current.quality;
            if (!bleedLocked) bleedEnabled = currentQuality === "high";
            lastPaperWidth = 0;
            rebuildPaperIfPageResized();
        }
        const wantsMirror = current.mirrorBrush && current.ownsKit;
        if (wantsMirror !== mirror) {
            mirror = wantsMirror;
            layout();
        }

        // A loan is granted from React, which cannot reach the scene's own
        // selection. Put the bottle in the player's hand: they paid a video
        // for it, and making them tap it a second time reads as the offer
        // having failed.
        if (current.borrowedInk !== null && current.borrowedInk !== lastBorrowedInk) {
            selectInk(current.borrowedInk);
        }
        lastBorrowedInk = current.borrowedInk;
    }

    function tick(): void {
        if (destroyed) return;
        const started = performance.now();
        const deltaMs = Math.min(100, app.ticker.deltaMS);
        const dt = deltaMs / 1_000;

        syncFromStore();

        accumulatorMs += deltaMs;
        // The held beat: while a discovery is being savoured the simulation
        // stands still, and the pause is swallowed rather than banked — it
        // must not come back as a lurch of catch-up steps.
        if (celebrationHoldMs > 0) {
            celebrationHoldMs = Math.max(0, celebrationHoldMs - deltaMs);
            accumulatorMs = 0;
        }
        let steps = 0;
        while (accumulatorMs >= SIM_STEP_MS && steps < MAX_CATCHUP_STEPS) {
            if (painting) stamp(brushCellX, brushCellY, 1);
            else if (pourRemaining > 0) {
                pourRemaining--;
                stamp(pourX, pourY, pourRemaining / POUR_TAIL_STEPS);
            }
            sim.step();
            accumulatorMs -= SIM_STEP_MS;
            steps++;
        }
        // A long stall must not turn into a burst of catch-up frames later.
        if (steps === MAX_CATCHUP_STEPS) accumulatorMs = 0;

        if (steps > 0) {
            for (const event of sim.takeDiscoveries()) recordDiscovery(event.index, event.cell);
            noteSheetReactions(sim.reactions);
            sim.reactions.fill(0);
            evaluatePrompt();
            simTexture.update(sim, bleedEnabled);
            inkAudio.setFireDensity(sim.burningCount);
            inkAudio.setPageActivity(Math.min(1, sim.liveCount / (SIM_WIDTH * SIM_HEIGHT * 0.35)));
        }

        bleedSprite.visible = bleedEnabled;

        // The stir check is a census over the whole grid, so it runs on a
        // half-second cadence rather than every step; the flag only crosses to
        // React when it flips.
        stirCheckMs += deltaMs;
        if (steps > 0 && stirCheckMs >= 450) {
            stirCheckMs = 0;
            sim.countElements(elementCensus);
            const stirring = pageStirs(DISCOVERIES, sim.found, elementCensus);
            if (stirring !== stirActive) {
                stirActive = stirring;
                store.patch({ pageStirring: stirring });
            }
        }
        stirLevel += ((stirActive ? 1 : 0) - stirLevel) * Math.min(1, dt * 1.6);
        if (stirLevel > 0.005) {
            stirPhase += dt;
            // Reduced motion holds the shimmer steady instead of breathing it.
            const breath = store.get().reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(stirPhase * 2.2);
            stirGraphics.alpha = stirLevel * (0.05 + 0.13 * breath);
        } else {
            stirGraphics.alpha = 0;
        }

        if (tearProgress > 0) {
            tearProgress = Math.max(0, tearProgress - dt * (store.get().reducedMotion ? 4.5 : 1.7));
            const progress = 1 - tearProgress;
            tornSprite.alpha = Math.min(1, tearProgress * 2.2);
            if (store.get().reducedMotion) {
                tornSprite.position.set(page.x + page.w / 2, page.y + page.h / 2);
                tornSprite.rotation = 0;
            } else {
                tornSprite.position.set(
                    page.x + page.w / 2 + progress * progress * page.w * 0.75,
                    page.y + page.h / 2 - progress * page.h * 0.45,
                );
                tornSprite.rotation = -progress * 0.36;
            }
            if (tearProgress === 0) tornSprite.visible = false;
        }

        for (let index = 0; index < pops.length; index++) {
            const pop = pops[index] ?? 0;
            if (pop > 0) pops[index] = Math.max(0, pop - dt * 4.5);
            const refusal = refusals[index] ?? 0;
            if (refusal > 0) refusals[index] = Math.max(0, refusal - dt * 3.2);
        }
        if (selectionPulse > 0) selectionPulse = Math.max(0, selectionPulse - dt * 3);

        if (hintAlpha > 0 && (store.get().strokes >= 3 || sim.tick > 900)) {
            hintAlpha = Math.max(0, hintAlpha - dt * 0.6);
        }
        hintLine.alpha = hintAlpha * 0.75;
        hintLine.visible = hintAlpha > 0.01;

        drawShelf();
        shelfLabel.text = INKS[selected]?.name ?? "";
        shelfLabel.alpha = 0.72;
        updateParticles(dt);
        updateCelebration(dt);
        updateToasts(dt);
        updateCursor();

        // Adaptive quality: the bleed pass is the first thing to go when the
        // device cannot keep up, because losing it costs softness, not clarity.
        const frameMs = performance.now() - started;
        frameAverageMs = frameAverageMs * 0.94 + frameMs * 0.06;
        framesSeen++;
        if (!bleedLocked && framesSeen > 150 && frameAverageMs > 12 && bleedEnabled) {
            bleedEnabled = false;
            bleedLocked = true;
            console.info("[scene] bleed pass disabled to hold frame rate");
        }
    }

    // Publish shelf geometry so automated QA can prove no two controls overlap.
    publishShelfSlots(() => {
        const scale = stage.scale() || 1;
        return shelfItems.map((item) => ({
            kind: item.kind,
            index: item.index,
            x: item.x * scale,
            y: item.y * scale,
            width: item.slotW * scale,
            height: item.slotH * scale,
        }));
    });

    // And where the sheet is, so scripted strokes land on paper rather than on
    // whatever the layout happened to move under them.
    publishPageRect(() => {
        const scale = stage.scale() || 1;
        let bottom = shelf.top;
        for (const item of shelfItems) bottom = Math.max(bottom, item.y + item.slotH / 2);
        return {
            x: page.x * scale,
            y: page.y * scale,
            width: page.w * scale,
            height: page.h * scale,
            shelfTop: shelf.top * scale,
            shelfContentBottom: bottom * scale,
            safeBottom: readSafeInsets().bottom,
        };
    });

    // And the lock badges, pill and number both, so "the digits overlap the
    // rim" is arithmetic rather than something a person has to notice.
    publishLockBadges(() => {
        const scale = stage.scale() || 1;
        const badges = [];
        for (const item of shelfItems) {
            if (item.kind !== "ink") continue;
            const mark = lockMarks[item.index];
            if (!mark?.visible) continue;
            badges.push({
                index: item.index,
                pill: {
                    x: item.x * scale,
                    y: (item.y + lockBadge.y) * scale,
                    width: lockBadge.width * scale,
                    height: lockBadge.height * scale,
                },
                text: {
                    x: mark.x * scale,
                    y: mark.y * scale,
                    width: mark.width * scale,
                    height: mark.height * scale,
                },
            });
        }
        return badges;
    });

    publishSimProbe(() => ({ tick: sim.tick, liveCount: sim.liveCount }));

    // Continuous page sound is gated on the sheet existing, not on any caller
    // remembering to wind it down. See `inkAudio.silencePage`.
    inkAudio.openPage();

    const unsubscribeResize = stage.onResize(layout);
    layout();
    rebuildPaper();
    printFurniture();
    simTexture.update(sim, bleedEnabled);
    app.ticker.add(tick);
    analytics.funnelStep(FIRST_PLAY_FUNNEL, 2);

    return {
        destroy() {
            destroyed = true;
            // Before anything else: the page voice is a permanent looping
            // source, so tearing down Pixi does not stop it. Leaving this until
            // after the renderer teardown risks an exception skipping it.
            inkAudio.silencePage();
            // Leaving the page destroys the sheet as surely as tearing it, so
            // it gets the same chance to be kept. Purely CPU-side — safe here.
            captureToFolio();
            // The stir is a fact about a sheet that no longer exists.
            if (stirActive) store.patch({ pageStirring: false });
            publishShelfSlots(null);
            publishPageRect(null);
            publishLockBadges(null);
            publishSimProbe(null);
            app.ticker.remove(tick);
            unsubscribeResize();
            app.canvas.removeEventListener("pointerdown", handlePointerDown);
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", handlePointerUp);
            app.canvas.removeEventListener("pointerleave", handlePointerLeave);
            window.removeEventListener("keydown", handleKeyDown);
            simTexture.destroy();
            paperTexture?.destroy(true);
            tornTexture?.destroy(true);
        },
    };
}
