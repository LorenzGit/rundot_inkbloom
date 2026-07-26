import CSV_TEXT from "../assets/strings.csv?raw";
import { store } from "../state/store.ts";
import { saveSystem } from "./save.ts";

export const LOCALES = [
    { id: "English", label: "English", htmlLang: "en" },
    { id: "PortugueseBR", label: "Português", htmlLang: "pt-BR" },
    { id: "SpanishLA", label: "Español", htmlLang: "es-419" },
] as const;

export type Locale = (typeof LOCALES)[number]["id"];

const localeIds = new Set<string>(LOCALES.map(({ id }) => id));
const rows = parseCsv(CSV_TEXT);
const headers = rows[0]?.slice(1) ?? [];
const messages = new Map(
    rows
        .slice(1)
        .filter((row) => row[0])
        .map((row) => [row[0] ?? "", row.slice(1)]),
);

let selectedLocale: Locale = "English";

export function isLocale(value: unknown): value is Locale {
    return typeof value === "string" && localeIds.has(value);
}

export function restoreLocale(): void {
    const saved = store.get().locale;
    selectedLocale = isLocale(saved) ? saved : "English";
    store.patch({ locale: selectedLocale });
    document.documentElement.lang = localeInfo(selectedLocale).htmlLang;
}

export function selectLocale(locale: string): boolean {
    if (!isLocale(locale)) return false;
    selectedLocale = locale;
    store.patch({ locale });
    document.documentElement.lang = localeInfo(locale).htmlLang;
    void saveSystem.flush();
    return true;
}

export function t(key: string, params: Record<string, unknown> = {}): string {
    const translations = messages.get(key);
    const localeIndex = headers.indexOf(selectedLocale);
    let value = translations?.[localeIndex] || translations?.[0] || `[[${key}]]`;
    for (const [name, replacement] of Object.entries(params)) {
        value = value.replaceAll(`[${name}]`, String(replacement));
    }
    return value.replaceAll("\\n", "\n");
}

function localeInfo(locale: Locale): (typeof LOCALES)[number] {
    return LOCALES.find(({ id }) => id === locale) ?? LOCALES[0];
}

/** Minimal RFC-4180 parser: quoted commas, quotes, and newlines are supported. */
function parseCsv(input: string): string[][] {
    const result: string[][] = [];
    let row: string[] = [];
    let value = "";
    let quoted = false;

    for (let index = 0; index < input.length; index++) {
        const character = input[index];
        if (quoted) {
            if (character === '"' && input[index + 1] === '"') {
                value += '"';
                index++;
            } else if (character === '"') {
                quoted = false;
            } else {
                value += character;
            }
        } else if (character === '"') {
            quoted = true;
        } else if (character === ",") {
            row.push(value);
            value = "";
        } else if (character === "\n" || character === "\r") {
            if (character === "\r" && input[index + 1] === "\n") index++;
            row.push(value);
            result.push(row);
            row = [];
            value = "";
        } else {
            value += character;
        }
    }

    if (value || row.length > 0) {
        row.push(value);
        result.push(row);
    }
    return result;
}
