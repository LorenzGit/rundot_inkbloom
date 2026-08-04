/**
 * The page.
 *
 * A cellular automaton over a portrait grid. It owns no canvas, no Pixi
 * objects, and no DOM — it is a pure state machine that can be stepped
 * headlessly, which is what makes `npm run simulate` an honest proof rather
 * than a screenshot.
 *
 * Update order is bottom row upward so falling material moves a full cell per
 * step instead of teleporting down a column; horizontal scan direction
 * alternates per row and per tick so piles do not lean.
 *
 * Discoveries are queued, not dispatched. The simulation never calls into
 * audio, UI, or analytics; the scene drains `takeDiscoveries()` each frame.
 */
import { SimRandom } from "./simRandom.ts";
import { DISCOVERY_COUNT } from "./discoveries.ts";
import {
    ACID,
    AMALGAM,
    AMBER,
    ASH,
    BASALT,
    BLOSSOM,
    BRIAR,
    BRINE,
    CRYSTAL,
    EMBER,
    EMPTY,
    FROST,
    FUME,
    GLASS,
    GRIT,
    HAZE,
    ICE,
    conducts,
    FULGURITE,
    GUST,
    isChilling,
    isCold,
    isFlammable,
    isFooting,
    isGas,
    isSinkable,
    MAGMA,
    MOLTEN,
    MOSS,
    MOTE,
    OBSIDIAN,
    PEAT,
    PITCH,
    QUICK,
    RESIN,
    RILL,
    RIME,
    SALT,
    SEALED,
    SILT,
    SMOKE,
    SPORE,
    STEAM,
    VOLT,
    WAX,
} from "./elements.ts";

/** Discovery indices, named so the reaction code reads as prose. */
const D_SILT = 0;
const D_STEAM = 1;
const D_DEEP_DRINK = 2;
const D_BLOSSOM = 3;
const D_WILDFIRE = 4;
const D_FLASHPOINT = 5;
const D_SLICK = 6;
const D_FIRE_ON_WATER = 7;
const D_GLASS = 8;
const D_DEW = 9;
const D_RAIN = 10;
const D_SPROUT = 11;
const D_ASHFALL = 12;
const D_ICE = 13;
const D_THAW = 14;
const D_BRINE = 15;
const D_SALT_FLAT = 16;
const D_WITHERED = 17;
const D_GLOWMOTE = 18;
const D_RIME = 19;
const D_MELT = 20;
const D_SEAL = 21;
const D_QUENCH = 22;
const D_TAPER = 23;
const D_WICK = 24;
const D_CREEP = 25;
const D_VERDANT = 26;
const D_SCORCH = 27;
const D_PEAT = 28;
const D_BOGFIRE = 29;
const D_FUME = 30;
const D_FIREDAMP = 31;
const D_ETCHED = 32;
const D_NEUTRAL = 33;
const D_SCOUR = 34;
const D_QUICKBEAD = 35;
const D_SINKHOLE = 36;
const D_QUICKSAND = 37;
const D_AMALGAM = 38;
const D_MIRRORSTONE = 39;
const D_KINDLE = 40;
const D_BASALTFLOW = 41;
const D_OBSIDIAN = 42;
const D_CRUCIBLE = 43;
const D_SMELT = 44;
const D_RESINSET = 45;
const D_INCLUSION = 46;
const D_SAPFIRE = 47;
const D_STUCK = 48;
const D_ARC = 49;
const D_BRINEARC = 50;
const D_FULGURITE = 51;
const D_ELECTROLYSIS = 52;
const D_SHOCKBLOOM = 53;
const D_WELDED = 54;
const D_SCATTER = 55;
const D_FANNED = 56;
const D_SNUFFED = 57;
const D_DRIFT = 58;
const D_DUSTDEVIL = 59;

/** A newly found secret and the cell it happened in, for the celebration burst. */
export interface DiscoveryEvent {
    index: number;
    cell: number;
}

export interface InkSimOptions {
    width: number;
    height: number;
    seed?: number;
    position?: number;
    /** Discoveries already found in earlier sessions, so they do not re-fire. */
    found?: readonly number[];
}

export class InkSim {
    readonly width: number;
    readonly height: number;
    readonly cellCount: number;

    /** Element id per cell. */
    readonly cells: Uint8Array;
    /** Element-specific counter: fuel, vigour, charge, or remaining lifetime. */
    readonly life: Uint8Array;
    /** Remaining burn ticks; non-zero means this cell is on fire. */
    readonly burn: Uint8Array;
    /** Static per-cell paper grain, used by the renderer for granulation. */
    readonly grain: Uint8Array;

    /** Which of the sixty secrets have been seen. Index-aligned to DISCOVERIES. */
    readonly found: Uint8Array;

    readonly random: SimRandom;

    /** Cells that are on fire this step — drives fire crackle density. */
    burningCount = 0;
    /** Non-empty cells, so an idle page can skip work and settle the audio bed. */
    liveCount = 0;
    /** Steps taken since construction; used for scan parity and shimmer phase. */
    tick = 0;

    /**
     * How many times each reaction fired since the counters were last taken.
     *
     * Distinct from `found`: the daily prompt asks the player to *reproduce*
     * something they already know, so it needs to see reactions that are no
     * longer discoveries.
     */
    readonly reactions: Uint16Array;

    private readonly moved: Uint8Array;
    private moveStamp = 1;
    private queued: DiscoveryEvent[] = [];

    constructor(options: InkSimOptions) {
        this.width = options.width;
        this.height = options.height;
        this.cellCount = options.width * options.height;
        this.cells = new Uint8Array(this.cellCount);
        this.life = new Uint8Array(this.cellCount);
        this.burn = new Uint8Array(this.cellCount);
        this.moved = new Uint8Array(this.cellCount);
        this.grain = new Uint8Array(this.cellCount);
        this.found = new Uint8Array(DISCOVERY_COUNT);
        this.reactions = new Uint16Array(DISCOVERY_COUNT);
        this.random = new SimRandom(options.seed ?? 0x1ac0_ffee, options.position ?? 0);

        // Grain is a fixed property of the sheet, drawn once from its own
        // stream so it never shifts when gameplay randomness advances.
        const grainSource = new SimRandom((options.seed ?? 0x1ac0_ffee) ^ 0x5eed_face, 0);
        for (let i = 0; i < this.cellCount; i++) this.grain[i] = grainSource.bits(8);

        for (const index of options.found ?? []) {
            if (index >= 0 && index < DISCOVERY_COUNT) this.found[index] = 1;
        }
    }

    /** How many secrets are known. */
    get discoveryCount(): number {
        let total = 0;
        for (let i = 0; i < this.found.length; i++) total += this.found[i] ?? 0;
        return total;
    }

    /**
     * Print one cell of a sheet's pre-set furniture.
     *
     * A plain bounds-checked write, distinct from `paint` on purpose: paint
     * is a brush with per-element pour density and randomness, and furniture
     * has to land exactly where the layout put it. Uses the same direct-write
     * contract as the verification scenarios.
     */
    etch(x: number, y: number, element: number): void {
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
        const i = y * this.width + x;
        this.cells[i] = element;
        this.life[i] = 0;
        this.burn[i] = 0;
    }

    /**
     * Fill `out[element]` with how many cells currently hold it.
     *
     * A read-only census for the "page stirs" tell. Burning cells also count
     * as EMBER: fire lit by magma or a charge is still fire, and a stir that
     * ignored it would go cold at exactly the moment things got interesting.
     */
    countElements(out: Uint32Array): void {
        out.fill(0);
        const { cells, burn } = this;
        for (let i = 0; i < this.cellCount; i++) {
            const element = cells[i] ?? EMPTY;
            if (element === EMPTY) continue;
            if (element < out.length) out[element] = (out[element] ?? 0) + 1;
            if ((burn[i] ?? 0) > 0) out[EMBER] = (out[EMBER] ?? 0) + 1;
        }
    }

    /** Hand the frame's new discoveries to the scene and reset the queue. */
    takeDiscoveries(): DiscoveryEvent[] {
        if (this.queued.length === 0) return [];
        const events = this.queued;
        this.queued = [];
        return events;
    }

    /** Wipe the page without touching progress or the random stream. */
    clear(): void {
        this.cells.fill(EMPTY);
        this.life.fill(0);
        this.burn.fill(0);
        this.moved.fill(0);
        this.reactions.fill(0);
        this.liveCount = 0;
        this.burningCount = 0;
    }

    /**
     * Stamp a round brush of `element` at a cell.
     *
     * `strength` scales the pour density so a released tap trails off instead
     * of stopping dead, and each ink has its own density: rill floods, ember
     * only speckles, spore lands one grain at a time.
     */
    paint(cx: number, cy: number, element: number, radius: number, strength: number): void {
        const { width, height, cells, life, burn, random } = this;
        const limit = radius * radius + 1;
        for (let dy = -radius; dy <= radius; dy++) {
            const y = cy + dy;
            if (y < 0 || y >= height) continue;
            const rowBase = y * width;
            for (let dx = -radius; dx <= radius; dx++) {
                if (dx * dx + dy * dy > limit) continue;
                const x = cx + dx;
                if (x < 0 || x >= width) continue;
                const i = rowBase + x;

                if (element === -1) {
                    cells[i] = EMPTY;
                    life[i] = 0;
                    burn[i] = 0;
                    continue;
                }
                // Basalt is drawn ON the page rather than poured into it, so it
                // is the one ink that overwrites whatever is already there.
                if (element === BASALT) {
                    cells[i] = BASALT;
                    life[i] = 0;
                    burn[i] = 0;
                    continue;
                }
                const existing = cells[i] ?? EMPTY;
                if (existing !== EMPTY && !isGas(existing)) continue;
                if (random.unit() >= pourDensity(element) * strength + 0.05) continue;

                cells[i] = element;
                burn[i] = 0;
                life[i] = initialLife(element, random);
            }
        }
    }

    /** Advance the page one frame. */
    step(): void {
        this.tick++;
        this.moveStamp = (this.tick % 254) + 1;
        this.burningCount = 0;
        this.liveCount = 0;

        const { width, height, cells } = this;
        for (let y = height - 1; y >= 0; y--) {
            const leftToRight = ((this.tick + y) & 1) === 0;
            const rowBase = y * width;
            for (let k = 0; k < width; k++) {
                const x = leftToRight ? k : width - 1 - k;
                const i = rowBase + x;
                const element = cells[i] ?? EMPTY;
                if (element === EMPTY) continue;
                this.liveCount++;
                if (element === BASALT || element === GLASS || element === CRYSTAL) continue;
                if (element === BLOSSOM && (this.burn[i] ?? 0) === 0) continue;
                if (this.moved[i] === this.moveStamp) continue;
                this.update(i, x, y, element);
            }
        }
    }

    // ---------------------------------------------------------------- helpers

    private discover(index: number, cell: number): void {
        // Counted every time, even long after it stopped being news.
        const seen = this.reactions[index] ?? 0;
        if (seen < 0xffff) this.reactions[index] = seen + 1;
        if (this.found[index]) return;
        this.found[index] = 1;
        this.queued.push({ index, cell });
    }

    private move(from: number, to: number): void {
        const { cells, life, burn } = this;
        cells[to] = cells[from] ?? EMPTY;
        life[to] = life[from] ?? 0;
        burn[to] = burn[from] ?? 0;
        cells[from] = EMPTY;
        life[from] = 0;
        burn[from] = 0;
        this.moved[to] = this.moveStamp;
    }

    private swap(a: number, b: number): void {
        const { cells, life, burn } = this;
        const element = cells[a] ?? EMPTY;
        const vigour = life[a] ?? 0;
        const fire = burn[a] ?? 0;
        cells[a] = cells[b] ?? EMPTY;
        life[a] = life[b] ?? 0;
        burn[a] = burn[b] ?? 0;
        cells[b] = element;
        life[b] = vigour;
        burn[b] = fire;
        this.moved[a] = this.moveStamp;
        this.moved[b] = this.moveStamp;
    }

    /** Index of one of the four orthogonal neighbours, or -1 at the edge. */
    private neighbour(i: number, x: number, y: number, which: number): number {
        if (which === 0) return x > 0 ? i - 1 : -1;
        if (which === 1) return x < this.width - 1 ? i + 1 : -1;
        if (which === 2) return y > 0 ? i - this.width : -1;
        return y < this.height - 1 ? i + this.width : -1;
    }

    /** Slide sideways up to `run` cells through empty space or gas. */
    private spread(i: number, x: number, run: number): boolean {
        const first = this.random.side();
        return this.slide(i, x, first, run) || this.slide(i, x, -first, run);
    }

    private slide(i: number, x: number, direction: number, run: number): boolean {
        let cursor = i;
        let column = x;
        for (let step = 0; step < run; step++) {
            const nextColumn = column + direction;
            if (nextColumn < 0 || nextColumn >= this.width) break;
            const next = cursor + direction;
            const occupant = this.cells[next] ?? EMPTY;
            if (occupant !== EMPTY && !isGas(occupant)) break;
            cursor = next;
            column = nextColumn;
        }
        if (cursor === i) return false;
        this.move(i, cursor);
        return true;
    }

    /**
     * Powder fall: straight down, then one diagonal. `slipChance` out of 16
     * controls how readily the pile collapses — dry grit slumps, wet silt
     * holds a bank, ash barely holds anything.
     */
    private fallAsPowder(i: number, x: number, y: number, slipChance: number, sinksThroughLiquid: boolean): boolean {
        if (y >= this.height - 1) return false;
        const below = this.cells[i + this.width] ?? EMPTY;
        if (below === EMPTY || isGas(below)) {
            this.move(i, i + this.width);
            return true;
        }
        if (sinksThroughLiquid && isSinkable(below)) {
            this.swap(i, i + this.width);
            return true;
        }
        if (this.random.bits(4) >= slipChance) return false;
        const first = this.random.side();
        for (let attempt = 0; attempt < 2; attempt++) {
            const direction = attempt === 0 ? first : -first;
            const column = x + direction;
            if (column < 0 || column >= this.width) continue;
            const target = i + this.width + direction;
            const occupant = this.cells[target] ?? EMPTY;
            if (occupant === EMPTY || isGas(occupant)) {
                this.move(i, target);
                return true;
            }
            if (sinksThroughLiquid && isSinkable(occupant)) {
                this.swap(i, target);
                return true;
            }
        }
        return false;
    }

    /** Gas rise: up, then up-diagonal, then sideways, fading as it goes. */
    private riseAsGas(i: number, x: number, y: number, driftBias: number): void {
        if (y === 0) {
            const remaining = this.life[i] ?? 0;
            this.life[i] = remaining > 4 ? remaining - 4 : 0;
            if ((this.life[i] ?? 0) === 0) this.cells[i] = EMPTY;
            return;
        }
        const above = this.cells[i - this.width] ?? EMPTY;
        if (above === EMPTY) {
            this.move(i, i - this.width);
            return;
        }
        if ((above === RILL || above === PITCH || above === BRINE) && this.random.chance(90, 8)) {
            this.swap(i, i - this.width);
            return;
        }
        const direction = this.random.side();
        const column = x + direction;
        if (column < 0 || column >= this.width) return;
        if ((this.cells[i - this.width + direction] ?? EMPTY) === EMPTY && this.random.chance(driftBias, 2)) {
            this.move(i, i - this.width + direction);
            return;
        }
        if ((this.cells[i + direction] ?? EMPTY) === EMPTY && this.random.chance(1, 2)) {
            this.move(i, i + direction);
        }
    }

    // ----------------------------------------------------------- the reactions

    private update(i: number, x: number, y: number, element: number): void {
        if ((this.burn[i] ?? 0) > 0 && this.updateBurning(i, x, y, element)) return;

        switch (element) {
            case GRIT:
                this.updateGrit(i, x, y);
                return;
            case SILT:
                this.updateSilt(i, x, y);
                return;
            case RILL:
                this.updateRill(i, x, y);
                return;
            case BRINE:
                this.updateBrine(i, x, y);
                return;
            case PITCH:
                this.updatePitch(i, x, y);
                return;
            case EMBER:
                this.updateEmber(i, x, y);
                return;
            case BRIAR:
                this.updateBriar(i, x, y);
                return;
            case SMOKE:
                this.updateSmoke(i, x, y);
                return;
            case STEAM:
                this.updateSteam(i, x, y);
                return;
            case MOTE:
                this.updateMote(i, x, y);
                return;
            case HAZE:
                this.updateHaze(i, x, y);
                return;
            case SPORE:
                this.updateSpore(i, x, y);
                return;
            case FROST:
                this.updateFrost(i, x, y);
                return;
            case ICE:
                this.updateIce(i, x, y);
                return;
            case SALT:
                this.updateSalt(i, x, y);
                return;
            case ASH:
                this.fallAsPowder(i, x, y, 11, true);
                return;
            case RIME:
                this.updateRime(i, x, y);
                return;
            case WAX:
            case SEALED:
                this.updateWax(i, x, y, element);
                return;
            case MOLTEN:
                this.updateMolten(i, x, y);
                return;
            case MOSS:
                this.updateMoss(i, x, y);
                return;
            case PEAT:
                this.fallAsPowder(i, x, y, 3, false);
                return;
            case ACID:
                this.updateAcid(i, x, y);
                return;
            case FUME:
                this.updateFume(i, x, y);
                return;
            case QUICK:
                this.updateQuick(i, x, y);
                return;
            case VOLT:
                this.updateVolt(i, x, y);
                return;
            case MAGMA:
                this.updateMagma(i, x, y);
                return;
            case RESIN:
                this.updateResin(i, x, y);
                return;
            case GUST:
                this.updateGust(i, x, y);
                return;
            default:
                return;
        }
    }

    /** Shared fire logic. Returns true when the cell no longer exists as it was. */
    private updateBurning(i: number, x: number, y: number, element: number): boolean {
        const { cells, life, burn, random } = this;
        this.burningCount++;
        burn[i] = (burn[i] ?? 1) - 1;

        // Checked before the water reaction below, because the whole point is
        // that this fire is sitting ON water and has not gone out.
        if (element === PITCH && y < this.height - 1 && (cells[i + this.width] ?? EMPTY) === RILL) {
            this.discover(D_FIRE_ON_WATER, i);
        }

        // Water thrown on a fire becomes steam, and sometimes wins.
        for (let which = 0; which < 4; which++) {
            const nb = this.neighbour(i, x, y, which);
            if (nb < 0) continue;
            const neighbourElement = cells[nb] ?? EMPTY;
            if ((neighbourElement === RILL || neighbourElement === BRINE) && random.chance(2, 2)) {
                cells[nb] = STEAM;
                life[nb] = 55 + random.bits(5);
                burn[nb] = 0;
                this.moved[nb] = this.moveStamp;
                this.discover(D_STEAM, nb);
                if (random.chance(1, 1)) {
                    burn[i] = 0;
                    return false;
                }
            }
        }

        // Spread to a neighbour that will take it.
        if (random.chance(3, 3)) {
            const nb = this.neighbour(i, x, y, random.bits(2));
            if (nb >= 0) {
                const fuel = cells[nb] ?? EMPTY;
                if (isFlammable(fuel) && (burn[nb] ?? 0) === 0) {
                    burn[nb] = fireDuration(fuel, random);
                    if (fuel === BRIAR || fuel === BLOSSOM) this.discover(D_WILDFIRE, nb);
                    else if (fuel === PITCH) this.discover(D_FLASHPOINT, nb);
                    else if (fuel === MOSS) this.discover(D_SCORCH, nb);
                    else if (fuel === PEAT) this.discover(D_BOGFIRE, nb);
                    else if (fuel === MOLTEN) this.discover(D_TAPER, nb);
                    else if (fuel === FUME) this.discover(D_FIREDAMP, nb);
                    else if (fuel === RESIN) this.discover(D_SAPFIRE, nb);
                }
            }
        }

        if (y > 0 && (cells[i - this.width] ?? EMPTY) === EMPTY && random.chance(2, 4)) {
            cells[i - this.width] = SMOKE;
            life[i - this.width] = 44 + random.bits(5);
            this.moved[i - this.width] = this.moveStamp;
        }

        if ((burn[i] ?? 0) > 0) return false;

        // Burnt out. What is left behind depends on what was burning.
        if (element === PITCH) {
            cells[i] = random.chance(1, 1) ? SMOKE : EMPTY;
            life[i] = (cells[i] ?? EMPTY) === SMOKE ? 36 : 0;
        } else if (element === FUME) {
            // The flash consumes itself. What is left is the flame, briefly.
            cells[i] = EMBER;
            life[i] = 14 + random.bits(4);
        } else if (element === MOLTEN) {
            cells[i] = random.chance(2, 2) ? EMPTY : SMOKE;
            life[i] = (cells[i] ?? EMPTY) === SMOKE ? 30 : 0;
        } else if (element === PEAT) {
            // Peat leaves a great deal of smoke and very little else.
            cells[i] = random.chance(3, 1) ? SMOKE : ASH;
            life[i] = (cells[i] ?? EMPTY) === SMOKE ? 70 + random.bits(6) : 0;
        } else if (element === RESIN) {
            // Sap burns dirty. What is left is smoke, and a lot of it.
            cells[i] = random.chance(3, 2) ? SMOKE : ASH;
            life[i] = (cells[i] ?? EMPTY) === SMOKE ? 80 + random.bits(6) : 0;
        } else if (element === SPORE) {
            cells[i] = EMPTY;
            life[i] = 0;
        } else if (random.chance(3, 2)) {
            cells[i] = ASH;
            life[i] = 0;
            this.discover(D_ASHFALL, i);
        } else {
            cells[i] = SMOKE;
            life[i] = 44 + random.bits(5);
        }
        return true;
    }

    private updateGrit(i: number, x: number, y: number): void {
        const { cells, life, random } = this;
        let wet = -1;
        for (let which = 0; which < 4 && wet < 0; which++) {
            const nb = this.neighbour(i, x, y, which);
            if (nb >= 0 && (cells[nb] ?? EMPTY) === RILL) wet = nb;
        }
        if (wet >= 0 && random.chance(2, 2)) {
            cells[wet] = EMPTY;
            life[wet] = 0;
            cells[i] = SILT;
            life[i] = 0;
            this.discover(D_SILT, i);
            return;
        }
        this.fallAsPowder(i, x, y, 16, true);
    }

    private updateSilt(i: number, x: number, y: number): void {
        const { cells, random } = this;
        for (let which = 0; which < 4; which++) {
            const nb = this.neighbour(i, x, y, which);
            if (nb < 0) continue;
            if (((cells[nb] ?? EMPTY) === EMBER || (this.burn[nb] ?? 0) > 0) && random.chance(3, 5)) {
                cells[i] = GRIT;
                return;
            }
        }
        // Moisture creeps down through a dry bank over time.
        if (random.chance(1, 8) && y < this.height - 1 && (cells[i + this.width] ?? EMPTY) === GRIT) {
            cells[i + this.width] = SILT;
            this.life[i + this.width] = 0;
        }
        this.fallAsPowder(i, x, y, 1, true);
    }

    private updateRill(i: number, x: number, y: number): void {
        const { cells, life, random } = this;
        for (let which = 0; which < 4; which++) {
            const nb = this.neighbour(i, x, y, which);
            if (nb < 0) continue;
            const neighbourElement = cells[nb] ?? EMPTY;
            if (neighbourElement === FROST && random.chance(3, 2)) {
                cells[nb] = EMPTY;
                life[nb] = 0;
                cells[i] = ICE;
                life[i] = 0;
                this.discover(D_ICE, i);
                return;
            }
            if (neighbourElement === SALT && random.chance(3, 2)) {
                cells[nb] = EMPTY;
                life[nb] = 0;
                cells[i] = BRINE;
                life[i] = 0;
                this.discover(D_BRINE, i);
                return;
            }
        }
        if (y < this.height - 1) {
            const below = cells[i + this.width] ?? EMPTY;
            if (below === EMPTY || isGas(below)) {
                this.move(i, i + this.width);
                return;
            }
            if (below === PITCH) {
                this.swap(i, i + this.width);
                this.discover(D_SLICK, i);
                return;
            }
            const first = random.side();
            for (let attempt = 0; attempt < 2; attempt++) {
                const direction = attempt === 0 ? first : -first;
                const column = x + direction;
                if (column < 0 || column >= this.width) continue;
                if ((cells[i + this.width + direction] ?? EMPTY) === EMPTY) {
                    this.move(i, i + this.width + direction);
                    return;
                }
            }
        }
        this.spread(i, x, 4);
    }

    private updateBrine(i: number, x: number, y: number): void {
        const { cells, life, random } = this;
        // Heat takes the water and leaves the salt behind.
        for (let which = 0; which < 4; which++) {
            const nb = this.neighbour(i, x, y, which);
            if (nb < 0) continue;
            if ((cells[nb] ?? EMPTY) === EMBER || (this.burn[nb] ?? 0) > 0) {
                if (random.chance(1, 3)) {
                    cells[i] = CRYSTAL;
                    life[i] = 0;
                    this.discover(D_SALT_FLAT, i);
                } else {
                    cells[i] = STEAM;
                    life[i] = 50 + random.bits(5);
                    this.discover(D_STEAM, i);
                }
                return;
            }
        }
        if (y < this.height - 1) {
            const below = cells[i + this.width] ?? EMPTY;
            if (below === EMPTY || isGas(below)) {
                this.move(i, i + this.width);
                return;
            }
            if (below === PITCH) {
                this.swap(i, i + this.width);
                return;
            }
            const first = random.side();
            for (let attempt = 0; attempt < 2; attempt++) {
                const direction = attempt === 0 ? first : -first;
                const column = x + direction;
                if (column < 0 || column >= this.width) continue;
                if ((cells[i + this.width + direction] ?? EMPTY) === EMPTY) {
                    this.move(i, i + this.width + direction);
                    return;
                }
            }
        }
        this.spread(i, x, 3);
    }

    private updatePitch(i: number, x: number, y: number): void {
        const { cells, random } = this;
        if (y < this.height - 1) {
            const below = cells[i + this.width] ?? EMPTY;
            if (below === EMPTY || isGas(below)) {
                this.move(i, i + this.width);
                return;
            }
            if (below !== RILL && below !== BRINE) {
                const first = random.side();
                for (let attempt = 0; attempt < 2; attempt++) {
                    const direction = attempt === 0 ? first : -first;
                    const column = x + direction;
                    if (column < 0 || column >= this.width) continue;
                    if ((cells[i + this.width + direction] ?? EMPTY) === EMPTY) {
                        this.move(i, i + this.width + direction);
                        return;
                    }
                }
            }
        }
        if (random.chance(1, 1)) this.spread(i, x, 2);
    }

    private updateEmber(i: number, x: number, y: number): void {
        const { cells, life, burn, random } = this;
        const remaining = life[i] ?? 0;
        if (remaining > 0) life[i] = remaining - 1;
        if ((life[i] ?? 0) === 0) {
            cells[i] = SMOKE;
            life[i] = 46 + random.bits(5);
            return;
        }

        for (let which = 0; which < 4; which++) {
            const nb = this.neighbour(i, x, y, which);
            if (nb < 0) continue;
            const neighbourElement = cells[nb] ?? EMPTY;

            if (neighbourElement === RILL || neighbourElement === BRINE) {
                cells[nb] = STEAM;
                life[nb] = 55 + random.bits(5);
                this.moved[nb] = this.moveStamp;
                cells[i] = SMOKE;
                life[i] = 22 + random.bits(4);
                this.discover(D_STEAM, i);
                return;
            }
            if (neighbourElement === ICE || neighbourElement === RIME) {
                cells[nb] = RILL;
                life[nb] = 0;
                this.moved[nb] = this.moveStamp;
                this.discover(D_THAW, nb);
                cells[i] = SMOKE;
                life[i] = 20 + random.bits(4);
                return;
            }
            if (neighbourElement === FROST) {
                cells[nb] = EMPTY;
                life[nb] = 0;
                continue;
            }
            if (neighbourElement === BLOSSOM && (burn[nb] ?? 0) === 0) {
                // A blossom brushed by fire usually catches — but now and then
                // it lets go of a mote of light instead.
                if (random.chance(1, 2)) {
                    cells[nb] = MOTE;
                    life[nb] = 120 + random.bits(6);
                    this.moved[nb] = this.moveStamp;
                    this.discover(D_GLOWMOTE, nb);
                } else {
                    burn[nb] = 34 + random.bits(4);
                    this.discover(D_WILDFIRE, nb);
                }
                continue;
            }
            if (neighbourElement === BRIAR && (burn[nb] ?? 0) === 0) {
                burn[nb] = 70 + random.bits(6);
                this.discover(D_WILDFIRE, nb);
                continue;
            }
            if (neighbourElement === PITCH && (burn[nb] ?? 0) === 0) {
                burn[nb] = 26 + random.bits(4);
                this.discover(D_FLASHPOINT, nb);
                continue;
            }
            if (neighbourElement === SPORE && (burn[nb] ?? 0) === 0) {
                burn[nb] = 30;
                continue;
            }
            // Everything else that will take a flame. The clauses above are the
            // ones with a reaction other than simply catching; this is the
            // general case, and it is what stops a new flammable ink from
            // silently being fireproof.
            if (isFlammable(neighbourElement) && (burn[nb] ?? 0) === 0) {
                // Wax is the exception: it should be usable as a material near
                // a flame, so it takes its time deciding to become a candle.
                if (neighbourElement === MOLTEN && !random.chance(1, 3)) continue;
                burn[nb] = fireDuration(neighbourElement, random);
                if (neighbourElement === MOSS) this.discover(D_SCORCH, nb);
                else if (neighbourElement === PEAT) this.discover(D_BOGFIRE, nb);
                else if (neighbourElement === MOLTEN) this.discover(D_TAPER, nb);
                else if (neighbourElement === FUME) this.discover(D_FIREDAMP, nb);
                else if (neighbourElement === RESIN) this.discover(D_SAPFIRE, nb);
                continue;
            }
            if (neighbourElement === GRIT) {
                // Grit does not melt at a touch; it has to sit in the fire.
                const heat = (life[nb] ?? 0) + 1;
                life[nb] = heat;
                if (heat > 28) {
                    cells[nb] = GLASS;
                    life[nb] = 0;
                    this.discover(D_GLASS, nb);
                }
            }
        }

        if (y < this.height - 1 && random.chance(150, 8)) {
            const below = cells[i + this.width] ?? EMPTY;
            if (below === EMPTY || isGas(below)) {
                this.move(i, i + this.width);
                return;
            }
            const direction = random.side();
            const column = x + direction;
            if (random.chance(1, 2) && column >= 0 && column < this.width) {
                if ((cells[i + this.width + direction] ?? EMPTY) === EMPTY) this.move(i, i + this.width + direction);
            }
        }
    }

    private updateBriar(i: number, x: number, y: number): void {
        const { cells, life, random } = this;

        if (random.chance(1, 5)) {
            const vigour = life[i] ?? 0;
            for (let which = 0; which < 4; which++) {
                const nb = this.neighbour(i, x, y, which);
                if (nb < 0) continue;
                const neighbourElement = cells[nb] ?? EMPTY;
                if (neighbourElement === BRINE) {
                    // The briar cannot tell brine from water. It drinks anyway.
                    cells[nb] = EMPTY;
                    life[nb] = 0;
                    cells[i] = ASH;
                    life[i] = 0;
                    this.discover(D_WITHERED, i);
                    return;
                }
                if (neighbourElement === RILL && vigour < 180) {
                    cells[nb] = EMPTY;
                    life[nb] = 0;
                    life[i] = Math.min(200, vigour + 50);
                    this.discover(D_DEEP_DRINK, i);
                    break;
                }
            }

            const grown = life[i] ?? 0;
            if (grown > 4 && y > 0) {
                let crowding = 0;
                if (x > 0 && (cells[i - 1] ?? EMPTY) === BRIAR) crowding++;
                if (x < this.width - 1 && (cells[i + 1] ?? EMPTY) === BRIAR) crowding++;
                if ((cells[i - this.width] ?? EMPTY) === BRIAR) crowding++;
                if (y < this.height - 1 && (cells[i + this.width] ?? EMPTY) === BRIAR) crowding++;
                if (crowding < 3) {
                    const lean = random.below(3) - 1;
                    const column = x + lean;
                    if (column >= 0 && column < this.width) {
                        const target = i - this.width + lean;
                        const occupant = cells[target] ?? EMPTY;
                        if (occupant === EMPTY || occupant === RILL) {
                            if (occupant === RILL) this.discover(D_DEEP_DRINK, i);
                            cells[target] = BRIAR;
                            life[target] = Math.max(4, grown - 16);
                            this.burn[target] = 0;
                            this.moved[target] = this.moveStamp;
                            life[i] = grown > 18 ? grown - 14 : 4;
                        }
                    }
                }
            }
        }

        if (y > 0 && (cells[i - this.width] ?? EMPTY) === EMPTY && (life[i] ?? 0) > 24 && random.chance(1, 9)) {
            cells[i - this.width] = BLOSSOM;
            life[i - this.width] = 0;
            this.moved[i - this.width] = this.moveStamp;
            life[i] = (life[i] ?? 0) - 18;
            this.discover(D_BLOSSOM, i - this.width);
        }
    }

    private updateSmoke(i: number, x: number, y: number): void {
        const current = this.life[i] ?? 0;
        if (current > 0) this.life[i] = current - 1;
        if ((this.life[i] ?? 0) === 0) {
            this.cells[i] = EMPTY;
            return;
        }
        this.riseAsGas(i, x, y, 3);
    }

    private updateSteam(i: number, x: number, y: number): void {
        const { cells, life, random } = this;
        const current = life[i] ?? 0;
        if (current > 0) life[i] = current - 1;
        if ((life[i] ?? 0) === 0) {
            cells[i] = EMPTY;
            return;
        }
        for (let which = 0; which < 4; which++) {
            const nb = this.neighbour(i, x, y, which);
            if (nb < 0) continue;
            if ((cells[nb] ?? EMPTY) === FROST && random.chance(40, 8)) {
                cells[i] = RIME;
                life[i] = 0;
                this.discover(D_RIME, i);
                return;
            }
        }
        // Vapour hitting a cold ceiling gives its water back.
        if (y > 0 && isCold(cells[i - this.width] ?? EMPTY) && random.chance(14, 8)) {
            cells[i] = RILL;
            life[i] = 0;
            this.discover(D_DEW, i);
            return;
        }
        this.riseAsGas(i, x, y, 2);
    }

    private updateMote(i: number, x: number, y: number): void {
        const { cells, life, random } = this;
        const current = life[i] ?? 0;
        if (current > 0) life[i] = current - 1;
        if ((life[i] ?? 0) === 0) {
            cells[i] = EMPTY;
            return;
        }
        // Motes are lighter than smoke and much less certain about direction.
        if (random.chance(3, 2)) this.riseAsGas(i, x, y, 3);
    }

    private updateHaze(i: number, x: number, y: number): void {
        const { cells, life, random } = this;
        if (random.chance(2, 8)) {
            const direction = random.side();
            const column = x + direction;
            if (column >= 0 && column < this.width && (cells[i + direction] ?? EMPTY) === EMPTY) {
                this.move(i, i + direction);
                return;
            }
        }
        if (y < this.height - 1 && (cells[i + this.width] ?? EMPTY) === EMPTY && random.chance(3, 9)) {
            cells[i + this.width] = RILL;
            life[i + this.width] = 0;
            this.moved[i + this.width] = this.moveStamp;
            this.discover(D_RAIN, i + this.width);
            const charge = life[i] ?? 0;
            if (charge > 14) life[i] = charge - 14;
            else {
                cells[i] = EMPTY;
                life[i] = 0;
            }
        }
    }

    private updateSpore(i: number, x: number, y: number): void {
        const { cells, life, random } = this;
        if (y >= this.height - 1) {
            cells[i] = BRIAR;
            life[i] = 150;
            this.discover(D_SPROUT, i);
            return;
        }
        const below = cells[i + this.width] ?? EMPTY;
        if (below === EMPTY || isGas(below)) {
            // A spore flutters rather than drops, so a handful scatters instead
            // of landing in one column and rooting into a hedge.
            if (random.chance(1, 3)) {
                const drift = random.side();
                const column = x + drift;
                if (column >= 0 && column < this.width && (cells[i + this.width + drift] ?? EMPTY) === EMPTY) {
                    this.move(i, i + this.width + drift);
                    return;
                }
            }
            if (random.chance(230, 8)) this.move(i, i + this.width);
            return;
        }
        if (below === RILL || below === BRINE || below === PITCH) {
            this.swap(i, i + this.width);
            return;
        }
        cells[i] = BRIAR;
        life[i] = 150;
        this.discover(D_SPROUT, i);
    }

    private updateFrost(i: number, x: number, y: number): void {
        const { cells, life, random } = this;
        for (let which = 0; which < 4; which++) {
            const nb = this.neighbour(i, x, y, which);
            if (nb < 0) continue;
            const neighbourElement = cells[nb] ?? EMPTY;
            if (neighbourElement === RILL && random.chance(3, 2)) {
                cells[nb] = ICE;
                life[nb] = 0;
                this.moved[nb] = this.moveStamp;
                cells[i] = EMPTY;
                life[i] = 0;
                this.discover(D_ICE, nb);
                return;
            }
            if (neighbourElement === STEAM && random.chance(60, 8)) {
                cells[nb] = RIME;
                life[nb] = 0;
                this.moved[nb] = this.moveStamp;
                this.discover(D_RIME, nb);
            }
            if (neighbourElement === EMBER || (this.burn[nb] ?? 0) > 0) {
                cells[i] = EMPTY;
                life[i] = 0;
                return;
            }
        }
        this.fallAsPowder(i, x, y, 13, false);
    }

    private updateIce(i: number, x: number, y: number): void {
        const { cells, life, random } = this;
        for (let which = 0; which < 4; which++) {
            const nb = this.neighbour(i, x, y, which);
            if (nb < 0) continue;
            if (((cells[nb] ?? EMPTY) === EMBER || (this.burn[nb] ?? 0) > 0) && random.chance(6, 5)) {
                cells[i] = RILL;
                life[i] = 0;
                this.discover(D_THAW, i);
                return;
            }
        }
        // Ice is held up by whatever it froze against, but not by thin air.
        if (y < this.height - 1 && (cells[i + this.width] ?? EMPTY) === EMPTY) this.move(i, i + this.width);
    }

    private updateSalt(i: number, x: number, y: number): void {
        const { cells, life, random } = this;
        for (let which = 0; which < 4; which++) {
            const nb = this.neighbour(i, x, y, which);
            if (nb < 0) continue;
            if ((cells[nb] ?? EMPTY) === RILL && random.chance(3, 2)) {
                cells[nb] = BRINE;
                life[nb] = 0;
                this.moved[nb] = this.moveStamp;
                cells[i] = EMPTY;
                life[i] = 0;
                this.discover(D_BRINE, nb);
                return;
            }
        }
        this.fallAsPowder(i, x, y, 15, false);
    }

    private updateRime(i: number, x: number, y: number): void {
        // Rime never moves; `x` only participates in neighbour lookups below.
        const { cells, life, random } = this;
        for (let which = 0; which < 4; which++) {
            const nb = this.neighbour(i, x, y, which);
            if (nb < 0) continue;
            if (((cells[nb] ?? EMPTY) === EMBER || (this.burn[nb] ?? 0) > 0) && random.chance(8, 5)) {
                cells[i] = RILL;
                life[i] = 0;
                this.discover(D_THAW, i);
                return;
            }
        }
    }

    /**
     * Wax, set or unset. Both are still blocks; the only question is heat.
     *
     * Melting keys off fire alone and never off neighbouring molten wax: a
     * block that melts its neighbour melts the whole bar in two steps, and the
     * ink stops being something you can build with.
     */
    private updateWax(i: number, x: number, y: number, element: number): void {
        const { cells, life, random } = this;
        for (let which = 0; which < 4; which++) {
            const nb = this.neighbour(i, x, y, which);
            if (nb < 0) continue;
            if (((cells[nb] ?? EMPTY) === EMBER || (this.burn[nb] ?? 0) > 0) && random.chance(3, 3)) {
                cells[i] = MOLTEN;
                life[i] = 0;
                this.discover(D_MELT, i);
                return;
            }
        }
        // Unset wax slumps straight down but never sideways, so a bar stays a
        // bar. Set wax has committed and does not move at all.
        if (element === WAX) this.fallAsPowder(i, x, y, 0, false);
    }

    private updateMolten(i: number, x: number, y: number): void {
        const { cells, life, random } = this;
        for (let which = 0; which < 4; which++) {
            const nb = this.neighbour(i, x, y, which);
            if (nb < 0) continue;
            const neighbourElement = cells[nb] ?? EMPTY;
            if (neighbourElement === RILL || neighbourElement === BRINE) {
                cells[nb] = STEAM;
                life[nb] = 38 + random.bits(4);
                this.burn[nb] = 0;
                this.moved[nb] = this.moveStamp;
                cells[i] = SEALED;
                life[i] = 0;
                this.discover(D_QUENCH, i);
                return;
            }
            // A stem already alight, fed wax: the flame stops being an event
            // and becomes a fixture. This is a candle.
            if (neighbourElement === BRIAR && (this.burn[nb] ?? 0) > 0) {
                cells[i] = EMBER;
                life[i] = 200 + random.bits(6);
                this.discover(D_WICK, i);
                return;
            }
            if (isChilling(neighbourElement) && random.chance(2, 2)) {
                cells[i] = SEALED;
                life[i] = 0;
                this.discover(D_SEAL, i);
                return;
            }
        }

        // Left alone it sets on its own, quietly and with no discovery — the
        // ink has to be usable as a material, not only as a reagent.
        const cooling = (life[i] ?? 0) + 1;
        life[i] = cooling > 250 ? 250 : cooling;
        if (cooling >= 190) {
            cells[i] = SEALED;
            life[i] = 0;
            return;
        }
        this.flowAsLiquid(i, x, y, 2);
    }

    /**
     * Moss creeps rather than grows: it walks sideways along whatever it is
     * standing on and will not climb, which is what makes it read as moss and
     * not as briar. `life` counts how far this patch has travelled from where
     * it was poured, so a bed stops rather than eating the sheet.
     */
    private updateMoss(i: number, x: number, y: number): void {
        const { cells, life, random } = this;
        if (y < this.height - 1) {
            const below = cells[i + this.width] ?? EMPTY;
            if (below === EMPTY || isGas(below)) {
                this.move(i, i + this.width);
                return;
            }
        }

        let watered = -1;
        for (let which = 0; which < 4; which++) {
            const nb = this.neighbour(i, x, y, which);
            if (nb < 0) continue;
            const neighbourElement = cells[nb] ?? EMPTY;
            if (neighbourElement === BRINE && random.chance(2, 3)) {
                cells[i] = ASH;
                life[i] = 0;
                this.discover(D_WITHERED, i);
                return;
            }
            if (neighbourElement === RILL) watered = nb;
            if (neighbourElement === SILT && random.chance(3, 4)) {
                cells[nb] = PEAT;
                life[nb] = 0;
                this.moved[nb] = this.moveStamp;
                cells[i] = PEAT;
                life[i] = 0;
                this.discover(D_PEAT, i);
                return;
            }
        }

        // Watered moss drinks and gets a fresh lease, which is what lets a bed
        // cross a sheet: without it a patch runs out of travel and stops. The
        // spread below cannot reach the water itself — the water is in the way.
        if (watered >= 0 && random.chance(2, 3)) {
            cells[watered] = EMPTY;
            life[watered] = 0;
            life[i] = 0;
            this.discover(D_VERDANT, i);
            return;
        }

        const travelled = life[i] ?? 0;
        if (travelled >= 14) return;
        if (!random.chance(2, 4)) return;
        const direction = random.side();
        const column = x + direction;
        if (column < 0 || column >= this.width) return;
        const target = i + direction;
        if ((cells[target] ?? EMPTY) !== EMPTY) return;
        // It needs a floor of its own to step onto, or it is climbing.
        const floor = y < this.height - 1 ? (cells[target + this.width] ?? EMPTY) : BASALT;
        if (!isFooting(floor) && floor !== MOSS) return;
        cells[target] = MOSS;
        life[target] = travelled + 1;
        this.moved[target] = this.moveStamp;
        life[i] = travelled + 1;
        if (watered >= 0) {
            cells[watered] = EMPTY;
            life[watered] = 0;
            this.discover(D_VERDANT, target);
        } else {
            this.discover(D_CREEP, target);
        }
    }

    private updateAcid(i: number, x: number, y: number): void {
        const { cells, life, random } = this;
        for (let which = 0; which < 4; which++) {
            const nb = this.neighbour(i, x, y, which);
            if (nb < 0) continue;
            const neighbourElement = cells[nb] ?? EMPTY;

            if (neighbourElement === BASALT && random.chance(1, 3)) {
                cells[nb] = FUME;
                life[nb] = 60 + random.bits(5);
                this.moved[nb] = this.moveStamp;
                cells[i] = EMPTY;
                life[i] = 0;
                this.discover(D_FUME, nb);
                return;
            }
            if (neighbourElement === GLASS && random.chance(1, 3)) {
                cells[nb] = SILT;
                life[nb] = 0;
                this.moved[nb] = this.moveStamp;
                cells[i] = EMPTY;
                life[i] = 0;
                this.discover(D_ETCHED, nb);
                return;
            }
            if (neighbourElement === AMALGAM && random.chance(2, 3)) {
                cells[nb] = CRYSTAL;
                life[nb] = 0;
                this.moved[nb] = this.moveStamp;
                cells[i] = EMPTY;
                life[i] = 0;
                this.discover(D_MIRRORSTONE, nb);
                return;
            }
            if (neighbourElement === SALT && random.chance(2, 2)) {
                cells[nb] = CRYSTAL;
                life[nb] = 0;
                this.moved[nb] = this.moveStamp;
                cells[i] = EMPTY;
                life[i] = 0;
                this.discover(D_NEUTRAL, nb);
                return;
            }
            if (
                (neighbourElement === BRIAR ||
                    neighbourElement === BLOSSOM ||
                    neighbourElement === MOSS ||
                    neighbourElement === SPORE) &&
                random.chance(2, 2)
            ) {
                cells[nb] = ASH;
                life[nb] = 0;
                this.burn[nb] = 0;
                this.moved[nb] = this.moveStamp;
                this.discover(D_SCOUR, nb);
                return;
            }
        }
        this.flowAsLiquid(i, x, y, 4);
    }

    private updateFume(i: number, x: number, y: number): void {
        const { cells, life, burn, random } = this;
        const remaining = life[i] ?? 0;
        if (remaining === 0) {
            cells[i] = EMPTY;
            return;
        }
        life[i] = remaining - 1;
        for (let which = 0; which < 4; which++) {
            const nb = this.neighbour(i, x, y, which);
            if (nb < 0) continue;
            if ((cells[nb] ?? EMPTY) === EMBER || (burn[nb] ?? 0) > 0) {
                burn[i] = fireDuration(FUME, random);
                this.discover(D_FIREDAMP, i);
                return;
            }
        }
        this.riseAsGas(i, x, y, 1);
    }

    /**
     * Quicksilver. Heavier than every other liquid and than loose powder, so
     * it does not pour over a pile — it goes through it. That single property
     * is why it is the last ink the shelf hands over.
     */
    private updateQuick(i: number, x: number, y: number): void {
        const { cells, life, random } = this;
        for (let which = 0; which < 4; which++) {
            const nb = this.neighbour(i, x, y, which);
            if (nb < 0) continue;
            const neighbourElement = cells[nb] ?? EMPTY;
            if (neighbourElement === GRIT && random.chance(1, 4)) {
                cells[nb] = AMALGAM;
                life[nb] = 0;
                this.moved[nb] = this.moveStamp;
                cells[i] = AMALGAM;
                life[i] = 0;
                this.discover(D_AMALGAM, i);
                return;
            }
            // Wet ground stops being ground: the silt loosens and runs.
            if (neighbourElement === SILT && random.chance(1, 5)) {
                cells[nb] = BRINE;
                life[nb] = 0;
                this.moved[nb] = this.moveStamp;
                this.discover(D_QUICKSAND, nb);
            }
        }

        if (y < this.height - 1) {
            const below = cells[i + this.width] ?? EMPTY;
            if (below === EMPTY || isGas(below)) {
                this.move(i, i + this.width);
                return;
            }
            if (isSinkable(below)) {
                this.swap(i, i + this.width);
                if (below === RILL || below === BRINE) this.discover(D_QUICKBEAD, i);
                return;
            }
            if (below === GRIT || below === SILT || below === ASH || below === PEAT || below === SALT) {
                this.swap(i, i + this.width);
                this.discover(D_SINKHOLE, i);
                return;
            }
            const first = random.side();
            for (let attempt = 0; attempt < 2; attempt++) {
                const direction = attempt === 0 ? first : -first;
                const column = x + direction;
                if (column < 0 || column >= this.width) continue;
                if ((cells[i + this.width + direction] ?? EMPTY) === EMPTY) {
                    this.move(i, i + this.width + direction);
                    return;
                }
            }
        }
        // It beads rather than levelling, so its run is short.
        this.spread(i, x, 1);
    }

    /**
     * A travelling charge.
     *
     * It does not flow and it does not rise; it falls fast, dies fast, and
     * while it lives it takes any conduction path it is offered. Everything
     * interesting about the ink is in what counts as a path.
     */
    private updateVolt(i: number, x: number, y: number): void {
        const { cells, life, random } = this;
        const remaining = life[i] ?? 0;
        if (remaining === 0) {
            cells[i] = EMPTY;
            return;
        }
        life[i] = remaining - 1;

        const first = random.bits(2);
        for (let step = 0; step < 4; step++) {
            const nb = this.neighbour(i, x, y, (first + step) & 3);
            if (nb < 0) continue;
            const neighbourElement = cells[nb] ?? EMPTY;

            if (neighbourElement === GRIT && random.chance(2, 2)) {
                cells[nb] = FULGURITE;
                life[nb] = 0;
                this.moved[nb] = this.moveStamp;
                this.discover(D_FULGURITE, nb);
                cells[i] = EMPTY;
                life[i] = 0;
                return;
            }
            if (neighbourElement === AMALGAM && random.chance(2, 2)) {
                cells[nb] = CRYSTAL;
                life[nb] = 0;
                this.moved[nb] = this.moveStamp;
                this.discover(D_WELDED, nb);
                cells[i] = EMPTY;
                life[i] = 0;
                return;
            }
            if (neighbourElement === RILL && random.chance(2, 2)) {
                cells[nb] = FUME;
                life[nb] = 50 + random.bits(5);
                this.moved[nb] = this.moveStamp;
                this.discover(D_ELECTROLYSIS, nb);
                cells[i] = EMPTY;
                life[i] = 0;
                return;
            }
            if (neighbourElement === BRIAR && random.chance(2, 2)) {
                cells[nb] = BLOSSOM;
                life[nb] = 0;
                this.moved[nb] = this.moveStamp;
                this.discover(D_SHOCKBLOOM, nb);
                cells[i] = EMPTY;
                life[i] = 0;
                return;
            }
            if (isFlammable(neighbourElement) && (this.burn[nb] ?? 0) === 0) {
                this.burn[nb] = fireDuration(neighbourElement, random);
                if (neighbourElement === FUME) this.discover(D_FIREDAMP, nb);
                cells[i] = EMPTY;
                life[i] = 0;
                return;
            }
            // A conductor carries it rather than consuming it: the charge and
            // the conductor change places, and the charge lives a little
            // longer for having somewhere to be.
            if (conducts(neighbourElement)) {
                this.swap(i, nb);
                const carried = life[nb] ?? 0;
                life[nb] = carried < 240 ? carried + 3 : 240;
                this.discover(neighbourElement === QUICK ? D_ARC : D_BRINEARC, nb);
                return;
            }
        }
        this.fallAsPowder(i, x, y, 14, true);
    }

    /**
     * Liquid stone. A heat source that is also a material: it lights what it
     * touches, and then it stops moving and becomes the floor.
     */
    private updateMagma(i: number, x: number, y: number): void {
        const { cells, life, random } = this;
        for (let which = 0; which < 4; which++) {
            const nb = this.neighbour(i, x, y, which);
            if (nb < 0) continue;
            const neighbourElement = cells[nb] ?? EMPTY;

            if (neighbourElement === RILL || neighbourElement === BRINE) {
                cells[nb] = STEAM;
                life[nb] = 60 + random.bits(5);
                this.moved[nb] = this.moveStamp;
                cells[i] = OBSIDIAN;
                life[i] = 0;
                this.discover(D_OBSIDIAN, i);
                return;
            }
            if (neighbourElement === ICE || neighbourElement === RIME || neighbourElement === FROST) {
                cells[nb] = RILL;
                life[nb] = 0;
                this.moved[nb] = this.moveStamp;
                this.discover(D_THAW, nb);
                continue;
            }
            if (neighbourElement === AMALGAM && random.chance(1, 3)) {
                cells[nb] = QUICK;
                life[nb] = 0;
                this.moved[nb] = this.moveStamp;
                this.discover(D_SMELT, nb);
                continue;
            }
            if (neighbourElement === GRIT) {
                // Grit has to sit in the heat, exactly as it does in a fire.
                const heat = (life[nb] ?? 0) + 2;
                life[nb] = heat > 250 ? 250 : heat;
                if (heat > 24) {
                    cells[nb] = GLASS;
                    life[nb] = 0;
                    this.moved[nb] = this.moveStamp;
                    this.discover(D_CRUCIBLE, nb);
                }
                continue;
            }
            if (neighbourElement === WAX && random.chance(2, 2)) {
                cells[nb] = MOLTEN;
                life[nb] = 0;
                this.moved[nb] = this.moveStamp;
                this.discover(D_MELT, nb);
                continue;
            }
            if (isFlammable(neighbourElement) && (this.burn[nb] ?? 0) === 0 && random.chance(2, 2)) {
                this.burn[nb] = fireDuration(neighbourElement, random);
                this.discover(D_KINDLE, nb);
            }
        }

        // `life` is the cooling counter here, not fuel.
        const cooling = (life[i] ?? 0) + 1;
        life[i] = cooling > 250 ? 250 : cooling;
        if (cooling >= 220) {
            cells[i] = BASALT;
            life[i] = 0;
            this.discover(D_BASALTFLOW, i);
            return;
        }
        if (random.chance(2, 2)) this.flowAsLiquid(i, x, y, 1);
    }

    /**
     * Sap. A liquid with a deadline: everything it is touching when the
     * deadline arrives is in the amber with it.
     */
    private updateResin(i: number, x: number, y: number): void {
        const { cells, life, random } = this;
        const setting = (life[i] ?? 0) + 1;
        life[i] = setting > 250 ? 250 : setting;

        for (let which = 0; which < 4; which++) {
            const nb = this.neighbour(i, x, y, which);
            if (nb < 0) continue;
            const neighbourElement = cells[nb] ?? EMPTY;
            if (
                (neighbourElement === BLOSSOM || neighbourElement === SPORE || neighbourElement === MOTE) &&
                random.chance(2, 3)
            ) {
                cells[nb] = AMBER;
                life[nb] = 0;
                this.moved[nb] = this.moveStamp;
                cells[i] = AMBER;
                life[i] = 0;
                this.discover(D_INCLUSION, nb);
                return;
            }
            // Only once it has begun to thicken, or a pour would set solid the
            // instant it landed on anything at all.
            if (setting > 70 && (neighbourElement === GRIT || neighbourElement === SILT) && random.chance(1, 3)) {
                cells[nb] = AMBER;
                life[nb] = 0;
                this.moved[nb] = this.moveStamp;
                cells[i] = AMBER;
                life[i] = 0;
                this.discover(D_STUCK, nb);
                return;
            }
        }

        if (setting >= 200) {
            cells[i] = AMBER;
            life[i] = 0;
            this.discover(D_RESINSET, i);
            return;
        }
        // It thickens as it sets, so it stops levelling out long before it
        // stops being a liquid.
        if (random.chance(setting > 120 ? 1 : 2, 2)) this.flowAsLiquid(i, x, y, 1);
    }

    /**
     * Moving air.
     *
     * The only ink that acts on other cells without becoming anything. Its
     * drift direction comes from the fixed paper grain rather than from a
     * fresh coin flip each step, so a gust travels in a line instead of
     * shivering in place.
     */
    private updateGust(i: number, x: number, y: number): void {
        const { cells, life, burn, random } = this;
        const remaining = life[i] ?? 0;
        if (remaining === 0) {
            cells[i] = EMPTY;
            return;
        }
        life[i] = remaining - 1;
        const direction = (this.grain[i] ?? 0) & 1 ? 1 : -1;
        const strong = remaining > 18;

        for (let which = 0; which < 4; which++) {
            const nb = this.neighbour(i, x, y, which);
            if (nb < 0) continue;
            const neighbourElement = cells[nb] ?? EMPTY;

            if (neighbourElement === EMBER || (burn[nb] ?? 0) > 0) {
                if (strong) {
                    // Air feeds a fire long before it kills one.
                    if (neighbourElement === EMBER) {
                        const fuel = life[nb] ?? 0;
                        life[nb] = fuel < 200 ? fuel + 30 : 250;
                    } else {
                        const left = burn[nb] ?? 0;
                        burn[nb] = left < 200 ? left + 20 : 250;
                    }
                    this.discover(D_FANNED, nb);
                } else if (random.chance(2, 2)) {
                    cells[nb] = neighbourElement === EMBER ? SMOKE : (cells[nb] ?? EMPTY);
                    burn[nb] = 0;
                    if (neighbourElement === EMBER) life[nb] = 30 + random.bits(4);
                    this.moved[nb] = this.moveStamp;
                    this.discover(D_SNUFFED, nb);
                }
                continue;
            }
            if (neighbourElement === SILT && strong && random.chance(1, 4)) {
                cells[nb] = HAZE;
                life[nb] = 160 + random.bits(6);
                this.moved[nb] = this.moveStamp;
                this.discover(D_DUSTDEVIL, nb);
                continue;
            }
            if (neighbourElement === SPORE || neighbourElement === MOTE) {
                if (this.shove(nb, direction, 4)) this.discover(D_DRIFT, nb);
                continue;
            }
            if (
                (neighbourElement === GRIT || neighbourElement === ASH || neighbourElement === SALT) &&
                random.chance(strong ? 3 : 1, 2)
            ) {
                if (this.shove(nb, direction, strong ? 3 : 1)) this.discover(D_SCATTER, nb);
            }
        }

        // Air moves along and slightly up.
        const column = x + direction;
        if (column >= 0 && column < this.width && (cells[i + direction] ?? EMPTY) === EMPTY) {
            this.move(i, i + direction);
            return;
        }
        if (y > 0 && (cells[i - this.width] ?? EMPTY) === EMPTY) this.move(i, i - this.width);
    }

    /** Push one cell sideways through empty space. Returns true if it moved. */
    private shove(from: number, direction: number, run: number): boolean {
        const column = from % this.width;
        let cursor = from;
        let at = column;
        for (let step = 0; step < run; step++) {
            const next = at + direction;
            if (next < 0 || next >= this.width) break;
            const target = cursor + direction;
            const occupant = this.cells[target] ?? EMPTY;
            if (occupant !== EMPTY && !isGas(occupant)) break;
            cursor = target;
            at = next;
        }
        if (cursor === from) return false;
        this.move(from, cursor);
        return true;
    }

    /** Down, then one diagonal, then level out over `run` cells. */
    private flowAsLiquid(i: number, x: number, y: number, run: number): void {
        const { cells, random } = this;
        if (y < this.height - 1) {
            const below = cells[i + this.width] ?? EMPTY;
            if (below === EMPTY || isGas(below)) {
                this.move(i, i + this.width);
                return;
            }
            const first = random.side();
            for (let attempt = 0; attempt < 2; attempt++) {
                const direction = attempt === 0 ? first : -first;
                const column = x + direction;
                if (column < 0 || column >= this.width) continue;
                if ((cells[i + this.width + direction] ?? EMPTY) === EMPTY) {
                    this.move(i, i + this.width + direction);
                    return;
                }
            }
        }
        this.spread(i, x, run);
    }
}

/** How thickly each ink lands under the brush, before the pour taper. */
function pourDensity(element: number): number {
    switch (element) {
        case RILL:
            return 0.92;
        case PITCH:
            return 0.7;
        case GRIT:
            return 0.62;
        case HAZE:
            return 0.5;
        case EMBER:
        case BRIAR:
            return 0.22;
        case FROST:
            return 0.34;
        case SALT:
            return 0.3;
        case SPORE:
            return 0.05;
        case ACID:
            return 0.55;
        case QUICK:
            return 0.85;
        case MOSS:
            return 0.34;
        case VOLT:
            return 0.14;
        case MAGMA:
            return 0.72;
        case RESIN:
            return 0.8;
        case GUST:
            return 0.4;
        case WAX:
            return 0.95;
        default:
            return 0.6;
    }
}

/** Fuel, vigour, charge, or lifetime, depending on what the ink is. */
function initialLife(element: number, random: SimRandom): number {
    switch (element) {
        case EMBER:
            return 70 + random.bits(7);
        case BRIAR:
            return 60;
        case HAZE:
            return 240;
        case SMOKE:
            return 60;
        case FUME:
            return 60 + random.bits(5);
        case VOLT:
            return 26 + random.bits(4);
        case GUST:
            return 44 + random.bits(5);
        default:
            return 0;
    }
}

/**
 * How long a given fuel burns once it catches.
 *
 * Pulled out of the fire loop because the burn time *is* the character of an
 * ink: pitch flashes, briar sustains, wax is a taper, peat will not stop.
 */
function fireDuration(fuel: number, random: SimRandom): number {
    switch (fuel) {
        case PITCH:
            return 26 + random.bits(4);
        case BRIAR:
            return 70 + random.bits(6);
        case FUME:
            return 6 + random.bits(3);
        case MOSS:
            return 18 + random.bits(4);
        case MOLTEN:
            return 120 + random.bits(6);
        case PEAT:
            return 200 + random.bits(7);
        case RESIN:
            return 90 + random.bits(5);
        default:
            return 34 + random.bits(4);
    }
}
