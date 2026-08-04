/**
 * The sixty secrets the page is keeping.
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
    {
        id: "melt",
        name: "Melt",
        note: "wax gives up its shape",
        hint: "wax holds still. it will not hold still near a fire.",
        colour: 0xf0c86a,
    },
    {
        id: "seal",
        name: "Seal",
        note: "running wax sets against cold",
        hint: "let melted wax find something cold to lean on.",
        colour: 0xe6d3a4,
    },
    {
        id: "quench",
        name: "Quench",
        note: "molten wax hits water and skins over",
        hint: "pour something molten into a pool.",
        colour: 0xbfd8d2,
    },
    {
        id: "taper",
        name: "Taper",
        note: "wax burns slowly, and keeps burning",
        hint: "wax does not catch quickly. it catches for a long time.",
        colour: 0xffb24a,
    },
    {
        id: "wick",
        name: "Wick",
        note: "a briar drinks molten wax",
        hint: "give melted wax a dry stem to soak into.",
        colour: 0xd8a24c,
    },
    {
        id: "creep",
        name: "Creep",
        note: "moss walks sideways across stone",
        hint: "moss will not climb. give it a floor instead.",
        colour: 0x74b243,
    },
    {
        id: "verdant",
        name: "Verdant",
        note: "moss finds water and thrives",
        hint: "moss is patient until it is watered.",
        colour: 0x4fd06a,
    },
    {
        id: "scorch",
        name: "Scorch",
        note: "a moss bed goes up all at once",
        hint: "dry green burns faster than you expect.",
        colour: 0xff7a3c,
    },
    {
        id: "peat",
        name: "Peat",
        note: "moss presses down into silt",
        hint: "bury moss in wet ground and wait.",
        colour: 0x6b4a2a,
    },
    {
        id: "bogfire",
        name: "Bogfire",
        note: "peat smoulders and will not stop",
        hint: "set light to buried ground. then leave it.",
        colour: 0x8c5a22,
    },
    {
        id: "fume",
        name: "Fume",
        note: "acid opens stone and something escapes",
        hint: "acid has opinions about stone.",
        colour: 0xc8e85a,
    },
    {
        id: "firedamp",
        name: "Firedamp",
        note: "the fume finds a flame",
        hint: "whatever came off the stone is not safe near fire.",
        colour: 0xfff05a,
    },
    {
        id: "etched",
        name: "Etched",
        note: "acid takes the polish off glass",
        hint: "glass is not as finished as it looks.",
        colour: 0xa8e6d8,
    },
    {
        id: "neutral",
        name: "Neutral",
        note: "acid and salt cancel into crystal",
        hint: "salt argues acid to a standstill.",
        colour: 0xe4f0d0,
    },
    {
        id: "scour",
        name: "Scour",
        note: "acid strips a living thing to ash",
        hint: "nothing green survives a meeting with acid.",
        colour: 0x9aa858,
    },
    {
        id: "quickbead",
        name: "Quickbead",
        note: "quick falls straight through water",
        hint: "quick is heavier than water. much heavier.",
        colour: 0xcdd8e8,
    },
    {
        id: "sinkhole",
        name: "Sinkhole",
        note: "quick sinks through a pile of grit",
        hint: "even dry ground will not hold quick up.",
        colour: 0x9aa6b8,
    },
    {
        id: "quicksand",
        name: "Quicksand",
        note: "quick loosens silt until it runs",
        hint: "wet ground stops being ground when quick gets into it.",
        colour: 0x8f7a54,
    },
    {
        id: "amalgam",
        name: "Amalgam",
        note: "quick takes grit into itself and stops",
        hint: "quick will swallow dry grains and then hold still.",
        colour: 0xd4dae4,
    },
    {
        id: "mirrorstone",
        name: "Mirrorstone",
        note: "amalgam under acid turns to bright crystal",
        hint: "there is one thing acid makes more beautiful.",
        colour: 0xeaf6ff,
    },
    {
        id: "kindle",
        name: "Kindle",
        note: "liquid stone sets a living thing alight",
        hint: "magma does not need a spark to start a fire.",
        colour: 0xff7a2e,
    },
    {
        id: "basaltflow",
        name: "Basaltflow",
        note: "magma left alone becomes stone",
        hint: "pour magma and then do nothing at all.",
        colour: 0x6b6158,
    },
    {
        id: "obsidian",
        name: "Obsidian",
        note: "magma quenched too fast to become stone",
        hint: "magma cools slowly. do not let it.",
        colour: 0x2a2438,
    },
    {
        id: "crucible",
        name: "Crucible",
        note: "magma melts a bed of grit clear through",
        hint: "there is a hotter way to make glass than a fire.",
        colour: 0xbfe6e0,
    },
    {
        id: "smelt",
        name: "Smelt",
        note: "magma frees the quick from an amalgam",
        hint: "what quick swallowed can be taken back out of it.",
        colour: 0xd8dee8,
    },
    {
        id: "resinset",
        name: "Resinset",
        note: "resin stops being a liquid",
        hint: "resin is a liquid. give it a minute.",
        colour: 0xe0a63a,
    },
    {
        id: "inclusion",
        name: "Inclusion",
        note: "resin sets around something that was alive",
        hint: "pour resin over a flower and wait.",
        colour: 0xf0c05a,
    },
    {
        id: "sapfire",
        name: "Sapfire",
        note: "resin burns hard and black",
        hint: "sap is not shy of a flame.",
        colour: 0x8a5a1e,
    },
    {
        id: "stuck",
        name: "Stuck",
        note: "resin catches falling grit and keeps it",
        hint: "drop something loose into resin before it sets.",
        colour: 0xc98f2e,
    },
    {
        id: "arc",
        name: "Arc",
        note: "a charge runs the length of the quick",
        hint: "a charge needs somewhere to go. quick is somewhere.",
        colour: 0x9ee8ff,
    },
    {
        id: "brinearc",
        name: "Brinearc",
        note: "a charge crosses salt water",
        hint: "plain water will not carry it. salted water will.",
        colour: 0x7ad4e8,
    },
    {
        id: "fulgurite",
        name: "Fulgurite",
        note: "a charge fuses grit into branching glass",
        hint: "strike dry ground and see what is left in it.",
        colour: 0xc6bcd8,
    },
    {
        id: "electrolysis",
        name: "Electrolysis",
        note: "a charge takes water apart",
        hint: "water is two things. a charge can tell them apart.",
        colour: 0xd8f04a,
    },
    {
        id: "shockbloom",
        name: "Shockbloom",
        note: "a charge makes a briar flower at once",
        hint: "a briar flowers in its own time — unless it is hurried.",
        colour: 0xff9ad0,
    },
    {
        id: "welded",
        name: "Welded",
        note: "a charge fuses an amalgam solid",
        hint: "run a charge into the silvered stone.",
        colour: 0xeaf2ff,
    },
    {
        id: "scatter",
        name: "Scatter",
        note: "a gust throws a pile of powder sideways",
        hint: "loose ground does not stay where you put it.",
        colour: 0xdcc98a,
    },
    {
        id: "fanned",
        name: "Fanned",
        note: "a gust drives a fire instead of killing it",
        hint: "air is a fire's friend before it is its enemy.",
        colour: 0xff9c2e,
    },
    {
        id: "snuffed",
        name: "Snuffed",
        note: "a dying gust puts a fire out",
        hint: "the same wind that fed it will finish it.",
        colour: 0x9aa8b4,
    },
    {
        id: "drift",
        name: "Drift",
        note: "a gust carries spores clean across the page",
        hint: "seeds do not have to fall where they were dropped.",
        colour: 0xb08a58,
    },
    {
        id: "dustdevil",
        name: "Dustdevil",
        note: "a gust lifts silt into the air as haze",
        hint: "hit wet ground with enough moving air.",
        colour: 0xa89a80,
    },
] as const;

export const DISCOVERY_COUNT = DISCOVERIES.length;

export function discoveryIndexById(id: string): number {
    return DISCOVERIES.findIndex((entry) => entry.id === id);
}
