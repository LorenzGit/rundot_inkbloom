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
import { ERASER_INDEX, INKS } from "../sim/elements.ts";
import { createSimTexture, type SimTexture } from "./simTexture.ts";
import { createPaperTexture, ruledBorderPath } from "./paperTexture.ts";
import { paperStyle } from "./papers.ts";
import { CREAM, GILT, HAND, MOTION, SERIF } from "./palette.ts";
import {
    drawBottle,
    drawBrushIcon,
    drawEraser,
    drawNib,
    drawTornSheetIcon,
    starPath,
    wobblyRect,
} from "./handDrawn.ts";
import { readSafeInsets } from "./safeArea.ts";
import {
    BRUSH_LARGE,
    BRUSH_SMALL,
    MAX_CATCHUP_STEPS,
    POUR_TAIL_STEPS,
    SIM_HEIGHT,
    SIM_STEP_MS,
    SIM_WIDTH,
    TAP_MAX_MS,
} from "../constants.ts";
import { store } from "../../state/store.ts";
import { inkAudio } from "../../audio/inkAudio.ts";
import {
    foundIndicesFromSave,
    isInkUnlocked,
    recordDiscovery,
    takeCelebrations,
    type Celebration,
} from "../../systems/progress.ts";
import { evaluate as evaluatePrompt, noteSheetReactions, resetSheetReactions } from "../../systems/dailyPrompt.ts";
import { saveSystem } from "../../systems/save.ts";
import { runtimeServices } from "../../systems/runtimeServices.ts";
import { t } from "../../systems/localization.ts";
import { NoiseRandom } from "../noiseRandom.ts";

export interface Scene {
    destroy(): void;
}

/** Layout in design units. The short edge is fixed at 720 by `stage.ts`. */
const MARGIN = 22;
const SHELF_ROWS_GAP = 74;
const SHELF_PAD = 26;

type ShelfKind = "ink" | "brush" | "tear" | "mirror";

interface ShelfItem {
    kind: ShelfKind;
    /** Shelf slot for `ink`. */
    index: number;
    x: number;
    y: number;
    size: number;
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

export function createPageScene(app: Application, stage: Stage): Scene {
    const state = store.get();
    const sheetRandom = new NoiseRandom(0xa5c0_1a3b, 0);

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
    const ruleGraphics = new Graphics();
    const tornSprite = new Sprite();
    const shelfGroup = new Container();
    const shelfGraphics = new Graphics();
    const shelfLabel = new Text({ text: "", style: labelStyle(20, CREAM) });
    const particleGraphics = new Graphics();
    const toastGroup = new Container();
    const toastCard = new Graphics();
    const toastTitle = new Text({ text: "", style: labelStyle(26, 0x2a2622) });
    const toastNote = new Text({ text: "", style: labelStyle(15, 0x2a2622, HAND) });
    const hintLine = new Text({ text: t("HintFirstTouch"), style: labelStyle(17, 0x2a2622, HAND) });
    const cursor = new Container();
    const cursorNib = new Graphics();
    const cursorRing = new Graphics();

    const simTexture: SimTexture = createSimTexture(SIM_WIDTH, SIM_HEIGHT);
    bleedSprite.texture = simTexture.bleed;
    inkSprite.texture = simTexture.mark;

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
    bleedSprite.alpha = 0.5;
    inkSprite.alpha = 0.94;
    bleedSprite.blendMode = "multiply";
    inkSprite.blendMode = "multiply";

    inkLayer.addChild(bleedSprite, inkSprite);
    pageGroup.addChild(pageShadow, paperSprite, inkLayer, ruleGraphics, tornSprite);
    shelfGroup.addChild(shelfGraphics, shelfLabel);
    toastGroup.addChild(toastCard, toastTitle, toastNote);
    toastGroup.visible = false;
    cursor.addChild(cursorNib, cursorRing);
    cursor.visible = false;
    tornSprite.visible = false;
    tornSprite.anchor.set(0.5);

    stage.root.addChild(desk, pageGroup, hintLine, shelfGroup, particleGraphics, toastGroup, cursor);

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
    const wiggles = new Float32Array(INKS.length);
    let selectionPulse = 0;
    let tearProgress = 0;
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
        bleedSprite.alpha = style.inkBlend === "screen" ? 0.32 : 0.5;
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

        // The React header bar sits above the canvas; reserve its height so the
        // page never slides under the wordmark or the discovery counter.
        const headerHeight = 88 + safeTop;

        const slotCount = INKS.length;
        const shelfInnerWidth = width - safeLeft - safeRight - SHELF_PAD * 2;
        const slotPitch = shelfInnerWidth / slotCount;
        const bottleSize = Math.max(30, Math.min(52, slotPitch - 8));
        shelf.height = SHELF_PAD * 2 + bottleSize + SHELF_ROWS_GAP + bottleSize * 0.5 + safeBottom;
        shelf.top = height - shelf.height;

        const available = shelf.top - headerHeight - MARGIN;
        const maxWidth = width - safeLeft - safeRight - MARGIN * 2;
        const pageHeight = Math.min(available, (maxWidth * SIM_HEIGHT) / SIM_WIDTH);
        page.h = Math.max(120, pageHeight);
        page.w = (page.h * SIM_WIDTH) / SIM_HEIGHT;
        page.x = safeLeft + (width - safeLeft - safeRight - page.w) / 2;
        // Weighted upward: an even split leaves the header stranded in a
        // band of empty desk on tall phones.
        page.y = headerHeight + (available - page.h) * 0.42;

        paperSprite.position.set(page.x, page.y);
        paperSprite.width = page.w;
        paperSprite.height = page.h;
        for (const sprite of [bleedSprite, inkSprite]) {
            sprite.position.set(page.x, page.y);
            sprite.width = page.w;
            sprite.height = page.h;
        }
        tornSprite.position.set(page.x + page.w / 2, page.y + page.h / 2);
        tornSprite.width = page.w;
        tornSprite.height = page.h;

        pageShadow.clear();
        pageShadow.rect(page.x - 3, page.y - 2, page.w + 6, page.h + 10).fill({ color: 0x000000, alpha: 0.34 });
        pageShadow.rect(page.x - 8, page.y + 2, page.w + 16, page.h + 18).fill({ color: 0x000000, alpha: 0.16 });

        hintLine.anchor.set(0.5, 1);
        hintLine.position.set(page.x + page.w / 2, page.y + page.h - 16);
        hintLine.style.fontSize = Math.max(13, page.w * 0.031);

        layoutShelf(width, bottleSize, slotPitch, safeLeft, safeRight);
        layoutLockMarks();
        drawRule();
        drawDesk();
        rebuildPaperIfPageResized();
    }

    let lastPaperWidth = 0;
    function rebuildPaperIfPageResized(): void {
        // Regenerating a whole sheet on every resize frame would be wasteful;
        // only do it when the page has actually changed size meaningfully.
        if (Math.abs(page.w - lastPaperWidth) < 8 && paperTexture) return;
        lastPaperWidth = page.w;
        rebuildPaper();
    }

    function layoutShelf(
        width: number,
        bottleSize: number,
        slotPitch: number,
        safeLeft: number,
        safeRight: number,
    ): void {
        shelfItems = [];
        const rowOneY = shelf.top + SHELF_PAD + bottleSize * 0.62;
        const startX = safeLeft + SHELF_PAD + slotPitch / 2;
        for (let slot = 0; slot < INKS.length; slot++) {
            shelfItems.push({ kind: "ink", index: slot, x: startX + slot * slotPitch, y: rowOneY, size: bottleSize });
        }

        const tools: ShelfKind[] = mirror ? ["brush", "mirror", "tear"] : ["brush", "tear"];
        const toolSize = Math.min(52, bottleSize + 4);
        const toolPitch = toolSize * 2.5;
        const centre = safeLeft + (width - safeLeft - safeRight) / 2;
        const rowTwoY = rowOneY + SHELF_ROWS_GAP + toolSize * 0.2;
        tools.forEach((kind, position) => {
            const offset = (position - (tools.length - 1) / 2) * toolPitch;
            shelfItems.push({ kind, index: -1, x: centre + offset, y: rowTwoY, size: toolSize });
        });

        shelfLabel.anchor.set(0.5, 1);
        shelfLabel.position.set(centre, shelf.top + SHELF_PAD * 0.55);
        shelfLabel.style.fontSize = Math.max(14, bottleSize * 0.38);
    }

    // -------------------------------------------------------------- shelf draw

    function drawShelf(): void {
        const width = stage.designWidth();
        shelfGraphics.clear();
        shelfGraphics.rect(0, shelf.top, width, shelf.height).fill({ color: 0xffffff, alpha: 0.035 });
        shelfGraphics
            .moveTo(18, shelf.top + 1.5)
            .lineTo(width - 18, shelf.top + 1.5)
            .stroke({ width: 1.5, color: CREAM, alpha: 0.16 });

        const discoveries = store.get().discoveryCount;
        for (const item of shelfItems) {
            const wiggle = item.kind === "ink" ? (wiggles[item.index] ?? 0) : 0;
            const isSelected = item.kind === "ink" && item.index === selected;
            shelfGraphics.save();
            shelfGraphics.translateTransform(item.x, item.y + (isSelected ? -item.size * 0.1 : 0));
            if (wiggle > 0) shelfGraphics.rotateTransform(Math.sin(wiggle * 24) * 0.13 * wiggle);

            if (item.kind === "ink") {
                const ink = INKS[item.index];
                if (!ink) {
                    shelfGraphics.restore();
                    continue;
                }
                const locked = !isInkUnlocked(item.index, discoveries);
                if (item.index === ERASER_INDEX) drawEraser(shelfGraphics, item.size, true);
                else drawBottle(shelfGraphics, { size: item.size, colour: ink.colour, locked, onDesk: true });
                if (isSelected && !locked) {
                    shelfGraphics.ellipse(0, item.size * 0.5, item.size * 0.42, item.size * 0.12);
                    shelfGraphics.stroke({ width: Math.max(1.8, item.size * 0.07), color: ink.colour, alpha: 0.95 });
                }
            } else if (item.kind === "brush") {
                drawBrushIcon(shelfGraphics, item.size, largeBrush, INKS[selected]?.colour ?? GILT, true);
            } else if (item.kind === "mirror") {
                drawMirrorIcon(shelfGraphics, item.size);
            } else {
                drawTornSheetIcon(shelfGraphics, item.size, true);
            }
            shelfGraphics.restore();
        }

        // Locked bottles carry their requirement so the shelf explains itself.
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
                color: INKS[selected]?.colour ?? GILT,
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
            style: new TextStyle({ fontFamily: SERIF, fontSize: 16, fill: CREAM, align: "center" }),
        });
        mark.anchor.set(0.5);
        mark.alpha = 0.85;
        mark.visible = false;
        lockLayer.addChild(mark);
        return mark;
    });
    shelfGroup.addChild(lockLayer);

    function layoutLockMarks(): void {
        for (const mark of lockMarks) mark.visible = false;
        for (const item of shelfItems) {
            if (item.kind !== "ink") continue;
            const mark = lockMarks[item.index];
            if (!mark) continue;
            mark.style.fontSize = Math.max(11, item.size * 0.34);
            mark.position.set(item.x, item.y + item.size * 0.02);
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
        wiggles[slot] = 1;
        if (!isInkUnlocked(slot, store.get().discoveryCount)) {
            inkAudio.play("deny");
            store.patch({ toast: `${ink.unlockAt} discoveries to open this one` });
            return;
        }
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

    function tearOffSheet(): void {
        // Snapshot what is being torn away so it can fly off the desk, then
        // give the next sheet a genuinely different grain and border.
        tornTexture?.destroy(true);
        tornTexture = app.renderer.generateTexture({ target: pageGroup, resolution: 1 });
        tornSprite.texture = tornTexture;
        tornSprite.visible = true;
        tearProgress = 1;

        sim.clear();
        resetSheetReactions();
        sheetSeed = sheetRandom.nextUint();
        lastPaperWidth = 0;
        rebuildPaperIfPageResized();
        inkAudio.play("tear");
        void runtimeServices.haptic("medium");
        const current = store.get();
        store.patch({ pagesTorn: current.pagesTorn + 1, toast: t("ToastSheetTorn") });
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
        if (INKS[selected]?.name === "EMBER") inkAudio.fizz();
        else inkAudio.scratch(3);
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
                if (INKS[selected]?.name === "EMBER") inkAudio.fizz();
                else inkAudio.scratch(travelled);
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

    function burstAtCell(cell: number, colour: number, count: number): void {
        if (store.get().reducedMotion) return;
        const cx = page.x + ((cell % SIM_WIDTH) + 0.5) * (page.w / SIM_WIDTH);
        const cy = page.y + (Math.floor(cell / SIM_WIDTH) + 0.5) * (page.h / SIM_HEIGHT);
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
        for (const celebration of takeCelebrations()) {
            toasts.push({ ...celebration, age: 0 });
            if (celebration.kind === "unlock") inkAudio.play("unlock");
            if (celebration.cell !== null) burstAtCell(celebration.cell, celebration.colour, 14);
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

        const reduced = store.get().reducedMotion;
        const entered = Math.min(1, current.age / (MOTION.revealMs / 1_000));
        const eased = 1 - (1 - entered) ** 3;
        const fade = current.age > duration - 0.3 ? (duration - current.age) / 0.3 : Math.min(1, entered * 2.2);

        const label = current.ordinal === null ? current.title : `${current.title} · ${current.ordinal}/20`;
        toastTitle.text = label;
        toastNote.text = current.note;
        toastTitle.style.fontSize = Math.max(18, page.w * 0.052);
        toastNote.style.fontSize = Math.max(12, page.w * 0.031);

        const padding = 22;
        const cardWidth = Math.min(
            stage.designWidth() - 36,
            Math.max(toastTitle.width, toastNote.width) + padding * 2 + 34,
        );
        const cardHeight = toastTitle.height + toastNote.height + padding * 1.2;
        const centreX = stage.designWidth() / 2;
        const restY = page.y + 26;
        const y = reduced ? restY : -cardHeight + eased * (restY + cardHeight);

        toastGroup.visible = true;
        toastGroup.alpha = fade;
        toastGroup.position.set(centreX, y);
        toastGroup.rotation = reduced ? 0 : 0.012 - eased * 0.024;

        toastCard.clear();
        wobblyRect(toastCard, -cardWidth / 2, -cardHeight / 2, cardWidth, cardHeight, current.title.length * 31);
        toastCard.fill({ color: 0xfffdf6, alpha: 0.97 });
        toastCard.stroke({ width: 2, color: 0x2a2622, alpha: 0.8, join: "round" });
        starPath(toastCard, -cardWidth / 2 + 22, -cardHeight * 0.16, 9);
        toastCard.fill({ color: current.colour, alpha: 1 });

        toastTitle.anchor.set(0, 1);
        toastTitle.position.set(-cardWidth / 2 + 38, 1);
        toastNote.anchor.set(0, 0);
        toastNote.position.set(-cardWidth / 2 + 38, 3);
    }

    // ---------------------------------------------------------------- cursor

    function updateCursor(): void {
        const visible = hasHoverPointer && store.get().overlay === "none";
        cursor.visible = visible;
        if (!visible) return;
        cursorNib.clear();
        cursorNib.rotation = 0.62;
        drawNib(cursorNib, INKS[selected]?.colour ?? GILT);
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
    }

    function tick(): void {
        if (destroyed) return;
        const started = performance.now();
        const deltaMs = Math.min(100, app.ticker.deltaMS);
        const dt = deltaMs / 1_000;

        syncFromStore();

        accumulatorMs += deltaMs;
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

        for (let index = 0; index < wiggles.length; index++) {
            const value = wiggles[index] ?? 0;
            if (value > 0) wiggles[index] = Math.max(0, value - dt * 2.4);
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

    const unsubscribeResize = stage.onResize(layout);
    layout();
    rebuildPaper();
    simTexture.update(sim, bleedEnabled);
    app.ticker.add(tick);
    runtimeServices.funnel(2, "page_opened", "inkbloom_first_session", 1);

    return {
        destroy() {
            destroyed = true;
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
