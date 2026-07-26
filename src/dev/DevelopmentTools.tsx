import { useEffect, useRef, useState } from "react";
import { applyRunSafeArea } from "../sdk/runSdk.ts";
import { store, useStore } from "../state/store.ts";

interface Diagnostics {
    fps: number;
    viewport: string;
    orientation: "portrait" | "landscape";
    pixelRatio: number;
    renderer: string;
    safeArea: string;
    safeAreaRefreshes: number;
}

interface InlineSafeArea {
    top: string;
    right: string;
    bottom: string;
    left: string;
}

function readDiagnostics(fps: number): Diagnostics {
    const root = document.documentElement;
    const style = getComputedStyle(root);
    const safeArea = ["top", "right", "bottom", "left"]
        .map((edge) => style.getPropertyValue(`--safe-${edge}`).trim() || "0px")
        .join(" / ");
    return {
        fps,
        viewport: `${window.innerWidth} × ${window.innerHeight}`,
        orientation: window.innerWidth >= window.innerHeight ? "landscape" : "portrait",
        pixelRatio: Number(window.devicePixelRatio.toFixed(2)),
        renderer: root.dataset.renderer ?? "pending",
        safeArea,
        safeAreaRefreshes: Number(root.dataset.safeAreaRefreshCount ?? 0),
    };
}

function captureInlineSafeArea(): InlineSafeArea {
    const style = document.documentElement.style;
    return {
        top: style.getPropertyValue("--safe-top"),
        right: style.getPropertyValue("--safe-right"),
        bottom: style.getPropertyValue("--safe-bottom"),
        left: style.getPropertyValue("--safe-left"),
    };
}

function restoreInlineSafeArea(values: InlineSafeArea): void {
    const style = document.documentElement.style;
    for (const edge of ["top", "right", "bottom", "left"] as const) {
        const value = values[edge];
        if (value) style.setProperty(`--safe-${edge}`, value);
        else style.removeProperty(`--safe-${edge}`);
    }
    applyRunSafeArea();
}

export default function DevelopmentTools() {
    const originalState = useRef({
        quality: store.get().quality,
        reducedMotion: store.get().reducedMotion,
        safeArea: captureInlineSafeArea(),
    });
    const quality = useStore((state) => state.quality);
    const reducedMotion = useStore((state) => state.reducedMotion);
    const menuScreen = useStore((state) => state.menuScreen);
    const phase = useStore((state) => state.phase);
    const [expanded, setExpanded] = useState(true);
    const [showSafeArea, setShowSafeArea] = useState(false);
    const [simulatedInset, setSimulatedInset] = useState(0);
    const [diagnostics, setDiagnostics] = useState(() => readDiagnostics(0));

    useEffect(() => {
        let animationFrame = 0;
        let sampleStartedAt = performance.now();
        let frames = 0;
        let sampledFps = 0;

        const update = (now: number) => {
            frames += 1;
            const elapsed = now - sampleStartedAt;
            if (elapsed >= 500) {
                sampledFps = Math.round((frames * 1_000) / elapsed);
                frames = 0;
                sampleStartedAt = now;
                setDiagnostics(readDiagnostics(sampledFps));
            }
            animationFrame = requestAnimationFrame(update);
        };
        animationFrame = requestAnimationFrame(update);

        const refresh = () => setDiagnostics(readDiagnostics(sampledFps));
        window.addEventListener("resize", refresh);
        window.addEventListener("orientationchange", refresh);
        return () => {
            cancelAnimationFrame(animationFrame);
            window.removeEventListener("resize", refresh);
            window.removeEventListener("orientationchange", refresh);
        };
    }, []);

    const changeQuality = (value: "high" | "low") => {
        document.documentElement.dataset.quality = value;
        store.patch({ quality: value });
    };

    const changeReducedMotion = (value: boolean) => {
        document.documentElement.dataset.reducedMotion = String(value);
        store.patch({ reducedMotion: value });
    };

    const changeSimulatedInset = (value: number) => {
        setSimulatedInset(value);
        const root = document.documentElement;
        for (const edge of ["top", "right", "bottom", "left"]) {
            root.style.setProperty(`--safe-${edge}`, `${value}px`);
        }
        setDiagnostics(readDiagnostics(diagnostics.fps));
    };

    const reset = () => {
        const original = originalState.current;
        changeQuality(original.quality);
        changeReducedMotion(original.reducedMotion);
        restoreInlineSafeArea(original.safeArea);
        setSimulatedInset(0);
        setShowSafeArea(false);
        setDiagnostics(readDiagnostics(diagnostics.fps));
    };

    return (
        <>
            {showSafeArea && <div className="development-safe-area" data-testid="safe-area-guide" aria-hidden="true" />}
            <aside className="development-tools" data-testid="development-tools" aria-label="Development diagnostics">
                <button
                    type="button"
                    className="development-tools-toggle"
                    aria-expanded={expanded}
                    onClick={() => setExpanded((value) => !value)}
                >
                    DEV · {diagnostics.fps} FPS
                </button>
                {expanded && (
                    <div className="development-tools-body">
                        <dl>
                            <div>
                                <dt>VIEW</dt>
                                <dd>{diagnostics.viewport}</dd>
                            </div>
                            <div>
                                <dt>MODE</dt>
                                <dd>{diagnostics.orientation}</dd>
                            </div>
                            <div>
                                <dt>DPR</dt>
                                <dd>{diagnostics.pixelRatio}</dd>
                            </div>
                            <div>
                                <dt>RENDERER</dt>
                                <dd>{diagnostics.renderer}</dd>
                            </div>
                            <div>
                                <dt>ROUTE</dt>
                                <dd>{phase === "menu" ? menuScreen : phase}</dd>
                            </div>
                            <div>
                                <dt>SAFE T/R/B/L</dt>
                                <dd>{diagnostics.safeArea}</dd>
                            </div>
                            <div>
                                <dt>SAFE REFRESH</dt>
                                <dd>{diagnostics.safeAreaRefreshes}</dd>
                            </div>
                        </dl>

                        <label>
                            <span>QUALITY</span>
                            <select
                                value={quality}
                                onChange={(event) => changeQuality(event.target.value as "high" | "low")}
                            >
                                <option value="high">HIGH</option>
                                <option value="low">LOW</option>
                            </select>
                        </label>
                        <label className="development-check">
                            <span>REDUCED MOTION</span>
                            <input
                                type="checkbox"
                                checked={reducedMotion}
                                onChange={(event) => changeReducedMotion(event.target.checked)}
                            />
                        </label>
                        <label className="development-check">
                            <span>SAFE-AREA GUIDE</span>
                            <input
                                type="checkbox"
                                checked={showSafeArea}
                                onChange={(event) => setShowSafeArea(event.target.checked)}
                            />
                        </label>
                        <label>
                            <span>SIMULATED INSET · {simulatedInset}px</span>
                            <input
                                type="range"
                                min="0"
                                max="48"
                                step="4"
                                value={simulatedInset}
                                onChange={(event) => changeSimulatedInset(Number(event.target.value))}
                            />
                        </label>
                        <button type="button" className="development-reset" onClick={reset}>
                            RESET SESSION TUNING
                        </button>
                        <p>Development only. Tuning changes are not persisted.</p>
                    </div>
                )}
            </aside>
        </>
    );
}
