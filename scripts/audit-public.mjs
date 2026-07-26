import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const failures = [];
const requiredFiles = [
    ".gitignore",
    "CONTRIBUTING.md",
    "LICENSE.md",
    "README.md",
    "SECURITY.md",
    "THIRD_PARTY_NOTICES.md",
];
const forbiddenNames = [
    /^\.env(?:\..+)?$/i,
    /^game\.config\.playground\.json$/i,
    /\.(?:key|p12|pem)$/i,
    /^rundot-session/i,
    /^player-snapshot/i,
    /^campaign-state/i,
];
const textExtensions = new Set([
    "",
    ".css",
    ".csv",
    ".html",
    ".js",
    ".json",
    ".jsx",
    ".md",
    ".mjs",
    ".ts",
    ".tsx",
    ".txt",
    ".yaml",
    ".yml",
]);
const contentChecks = [
    {
        label: "developer-specific absolute path",
        pattern: /(?:\/Users\/[^/\s]+\/|\/root\/|[A-Za-z]:\\Users\\[^\\\s]+\\)/,
    },
    {
        label: "workspace-relative dependency",
        pattern: /["'](?:workspace:|file:\.\.\/)/,
    },
    {
        label: "private key material",
        pattern: /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/,
    },
    {
        label: "GitHub access token",
        pattern: /\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/,
    },
    {
        label: "Slack access token",
        pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
    },
    {
        label: "AWS access key",
        pattern: /\bAKIA[A-Z0-9]{16}\b/,
    },
    {
        label: "RUN credential-shaped value",
        pattern: /\b(?:pk|rk)_[A-Za-z0-9_-]{24,}\b/,
    },
];

function repositoryFiles() {
    const output = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
        cwd: root,
        encoding: "utf8",
    });
    return output.split("\0").filter(Boolean);
}

function isTextFile(relativePath, buffer) {
    if (buffer.includes(0)) return false;
    const basename = path.basename(relativePath);
    const extension = path.extname(relativePath).toLowerCase();
    return basename.startsWith(".") || textExtensions.has(extension);
}

for (const required of requiredFiles) {
    if (!fs.existsSync(path.join(root, required))) failures.push(`missing public repository file: ${required}`);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (packageJson.private !== true) failures.push("package.json must prevent accidental npm publication");
if (packageJson.license !== "SEE LICENSE IN LICENSE.md") {
    failures.push("package.json must point readers to LICENSE.md");
}

let scannedTextFiles = 0;
let placeholderCount = 0;
for (const relativePath of repositoryFiles()) {
    const basename = path.basename(relativePath);
    if (relativePath !== ".env.example" && forbiddenNames.some((pattern) => pattern.test(basename))) {
        failures.push(`sensitive or machine-owned file must not be public: ${relativePath}`);
    }

    const absolutePath = path.join(root, relativePath);
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink()) {
        const resolved = fs.realpathSync(absolutePath);
        const relativeTarget = path.relative(root, resolved);
        if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
            failures.push(`symlink escapes the repository: ${relativePath}`);
        }
        continue;
    }
    if (!stat.isFile() || stat.size > 2_000_000) continue;

    const buffer = fs.readFileSync(absolutePath);
    if (!isTextFile(relativePath, buffer)) continue;
    scannedTextFiles += 1;
    const contents = buffer.toString("utf8");
    placeholderCount += contents.match(/\bREPLACE_WITH_[A-Z0-9_]+\b/g)?.length ?? 0;

    // The audit implementation necessarily contains the patterns it detects.
    if (relativePath === "scripts/audit-public.mjs") continue;
    for (const check of contentChecks) {
        if (check.pattern.test(contents)) failures.push(`${relativePath} contains ${check.label}`);
    }
}

if (failures.length > 0) {
    console.error(`Public repository audit failed (${failures.length}):`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
} else {
    console.log(
        `Public repository audit passed: ${scannedTextFiles} text files scanned; ${placeholderCount} intentional template placeholder references found.`,
    );
}
