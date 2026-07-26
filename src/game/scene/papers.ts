/**
 * The sheets you can work on.
 *
 * Paper is not a skin here — it changes how ink reads. On rag and vellum the
 * ink layer *multiplies* into the sheet, the way pigment darkens paper. On the
 * two dark sheets it *screens*, so the same inks stop being stains and start
 * being light: an ember on nocturne is a lamp, not a scorch.
 *
 * `rag` ships with the game. The other three arrive with the Illuminator's Kit
 * and change nothing about which secrets are reachable.
 */
import type { PaperId } from "../constants.ts";

export interface PaperStyle {
    readonly id: PaperId;
    readonly name: string;
    readonly blurb: string;
    /** Base sheet colour. */
    readonly base: string;
    /** Fibre speckle, dark and light. */
    readonly speckleDark: string;
    readonly speckleLight: string;
    /** Long pressed fibres. */
    readonly fibre: string;
    /** Age blooms, or null for a sheet too new to have any. */
    readonly foxing: string | null;
    /** Lamp falloff toward the sheet's corners. */
    readonly vignette: string;
    /** Faint drafting grid, in sheet-relative cell size. */
    readonly grid: { colour: string; cells: number } | null;
    /** How pigment meets the sheet. */
    readonly inkBlend: "multiply" | "screen";
    /** Ruled border and hand-written labels drawn onto the sheet. */
    readonly rule: number;
    readonly label: number;
    /** Shell tone behind this sheet, so the whole frame shifts with it. */
    readonly desk: number;
    readonly deskLamp: number;
    /** True when the sheet is dark and on-page text must invert. */
    readonly dark: boolean;
}

export const PAPER_STYLES: Readonly<Record<PaperId, PaperStyle>> = {
    rag: {
        id: "rag",
        name: "Rag",
        blurb: "warm cotton stock, foxed at the edges",
        base: "#fcf9f0",
        speckleDark: "203,188,152",
        speckleLight: "255,255,255",
        fibre: "180,164,128",
        foxing: "166,124,62",
        vignette: "120,100,60",
        grid: null,
        inkBlend: "multiply",
        rule: 0x2a2622,
        label: 0x2a2622,
        desk: 0x0e7276,
        deskLamp: 0x2bb3ad,
        dark: false,
    },
    vellum: {
        id: "vellum",
        name: "Vellum",
        blurb: "translucent, faintly green, holds a wet edge",
        base: "#f1ead0",
        speckleDark: "176,168,120",
        speckleLight: "255,253,236",
        fibre: "158,152,104",
        foxing: "142,120,58",
        vignette: "96,92,44",
        grid: null,
        inkBlend: "multiply",
        rule: 0x3a3626,
        label: 0x3a3626,
        desk: 0x107070,
        deskLamp: 0x35b8a8,
        dark: false,
    },
    nocturne: {
        id: "nocturne",
        name: "Nocturne",
        blurb: "indigo stock — every ink becomes a light",
        base: "#171b2e",
        speckleDark: "10,12,24",
        speckleLight: "126,140,192",
        fibre: "94,108,164",
        foxing: null,
        vignette: "4,5,12",
        grid: null,
        inkBlend: "screen",
        rule: 0xd7ddf2,
        label: 0xe8ecfa,
        desk: 0x0a4f5c,
        deskLamp: 0x1d8ea0,
        dark: true,
    },
    blueprint: {
        id: "blueprint",
        name: "Blueprint",
        blurb: "drafting cyan, ruled to a grid",
        base: "#0f3350",
        speckleDark: "8,28,46",
        speckleLight: "120,178,214",
        fibre: "86,150,190",
        foxing: null,
        vignette: "3,16,28",
        grid: { colour: "rgba(196,228,246,0.14)", cells: 24 },
        inkBlend: "screen",
        rule: 0xcfe7f6,
        label: 0xe4f2fb,
        desk: 0x08505f,
        deskLamp: 0x1590a6,
        dark: true,
    },
};

export function paperStyle(id: PaperId): PaperStyle {
    return PAPER_STYLES[id] ?? PAPER_STYLES.rag;
}
