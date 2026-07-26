/**
 * The twenty secrets the page is keeping.
 *
 * A discovery is not a quest and cannot be "completed" — it fires the first
 * time the simulation actually performs the reaction, wherever on the page that
 * happens. `hint` is deliberately a nudge rather than a recipe: it names the
 * two inks and leaves the arrangement to the player.
 *
 * Indices are the persisted save format. Append new entries; never reorder.
 */

export interface Discovery {
    /** Stable id for saves, analytics, and hint telemetry. */
    readonly id: string;
    /** Title shown on the toast and in Field Notes. */
    readonly name: string;
    /** The line written under the title once it is found. */
    readonly note: string;
    /** Bought or earned nudge shown while it is still unfound. */
    readonly hint: string;
    /** Accent colour for the toast star and journal entry. */
    readonly colour: number;
}

export const DISCOVERIES: readonly Discovery[] = [
    {
        id: "silt",
        name: "Silt",
        note: "rill soaks into grit",
        hint: "grit is thirsty. give it something to drink.",
        colour: 0xa9772e,
    },
    {
        id: "steam",
        name: "Steam",
        note: "ember meets rill",
        hint: "put fire and water in the same place and step back.",
        colour: 0x7fa8bc,
    },
    {
        id: "deep-drink",
        name: "Deep Drink",
        note: "the briar drinks deep",
        hint: "a briar planted beside water grows differently.",
        colour: 0x3f7d45,
    },
    {
        id: "blossom",
        name: "Blossom",
        note: "a briar tip opens",
        hint: "a well-watered briar, left alone, has something to show you.",
        colour: 0xd66a8e,
    },
    {
        id: "wildfire",
        name: "Wildfire",
        note: "fire races through the briar",
        hint: "briar is dry work. touch one end of a long one with ember.",
        colour: 0xe06a1f,
    },
    {
        id: "flashpoint",
        name: "Flashpoint",
        note: "pitch catches in an instant",
        hint: "pitch does not smoulder. it decides all at once.",
        colour: 0xf5a623,
    },
    {
        id: "slick",
        name: "Slick",
        note: "pitch floats up through rill",
        hint: "pour pitch underneath deep water and watch which way it goes.",
        colour: 0x6e3a5e,
    },
    {
        id: "fire-on-water",
        name: "Fire on the Water",
        note: "burning pitch rides the surface",
        hint: "water does not always put a fire out. float one first.",
        colour: 0xe04a12,
    },
    {
        id: "glass",
        name: "Glass",
        note: "ember fuses grit",
        hint: "grit held long enough in fire stops being grit.",
        colour: 0x79a89d,
    },
    {
        id: "dew",
        name: "Dew",
        note: "steam beads on cold basalt",
        hint: "steam has to land somewhere. give it a cold ceiling.",
        colour: 0x3e7cb8,
    },
    {
        id: "rain",
        name: "Rain",
        note: "a haze lets down rain",
        hint: "haze is patient. paint some and leave it be.",
        colour: 0x8d96b8,
    },
    {
        id: "sprout",
        name: "Sprout",
        note: "a spore takes root",
        hint: "a spore needs a floor to land on.",
        colour: 0x5e8c4a,
    },
    {
        id: "ashfall",
        name: "Ashfall",
        note: "the briar burns down to ash",
        hint: "let a wildfire finish instead of dousing it.",
        colour: 0x6b6459,
    },
    {
        id: "ice",
        name: "Ice",
        note: "frost stills the rill",
        hint: "frost has an opinion about running water.",
        colour: 0x9fc9d8,
    },
    {
        id: "thaw",
        name: "Thaw",
        note: "ember frees the ice",
        hint: "ice is only water that was talked out of it.",
        colour: 0x64a7c4,
    },
    {
        id: "brine",
        name: "Brine",
        note: "salt dissolves in rill",
        hint: "salt will not stay salt in water.",
        colour: 0xb9c4bf,
    },
    {
        id: "salt-flat",
        name: "Salt Flat",
        note: "brine dries back to crystal",
        hint: "take the water out of brine and see what is left.",
        colour: 0xe8e2d2,
    },
    {
        id: "withered",
        name: "Withered",
        note: "brine poisons the briar",
        hint: "briar drinks anything. that is not always lucky for it.",
        colour: 0x8a7a4e,
    },
    {
        id: "glowmote",
        name: "Glowmote",
        note: "an ember wakes a blossom",
        hint: "bring a small fire near an open blossom — small.",
        colour: 0xf2d17a,
    },
    {
        id: "rime",
        name: "Rime",
        note: "frost feathers out of steam",
        hint: "steam that meets frost does not become water.",
        colour: 0xd6ecf2,
    },
] as const;

export const DISCOVERY_COUNT = DISCOVERIES.length;

export function discoveryIndexById(id: string): number {
    return DISCOVERIES.findIndex((entry) => entry.id === id);
}
