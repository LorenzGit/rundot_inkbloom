/**
 * Settings.
 *
 * Notifications are the one row here that can fail: the host owns the actual
 * permission, so the toggle reflects what the host reported back rather than
 * what the player tapped. Everything else is local, persisted immediately, and
 * applied to the running game without a restart.
 */
import { LOCALES, selectLocale, t } from "../systems/localization.ts";
import { getRunCapabilities, setNotificationPreference } from "../sdk/runSdk.ts";
import { store, useStore } from "../state/store.ts";
import { returnReminders } from "../systems/retention/retentionConfig.ts";
import { saveSystem } from "../systems/save.ts";
import { runtimeServices } from "../systems/runtimeServices.ts";
import { inkAudio } from "../audio/inkAudio.ts";
import Panel from "./Panel.tsx";

function Toggle({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
    return (
        <button
            type="button"
            className="toggle"
            data-on={on}
            role="switch"
            aria-checked={on}
            aria-label={label}
            onClick={onChange}
        />
    );
}

export default function SettingsScreen({ onClose }: { onClose: () => void }) {
    const state = useStore((value) => value);
    const capabilities = getRunCapabilities();

    const commit = (partial: Parameters<typeof store.patch>[0]) => {
        store.patch(partial);
        void saveSystem.flush();
    };

    const toggleNotifications = async () => {
        inkAudio.play("tap");
        const next = !state.notificationsEnabled;
        if (!next) {
            // Opt out of INKBLOOM only. The host preference belongs to the RUN
            // app and every game shares it, so revoking it here would silence
            // reminders in all of them.
            commit({ notificationsOptOut: true, notificationsEnabled: false });
            void returnReminders.cancelAll();
            return;
        }
        const result = await setNotificationPreference(next);
        if (result === "unavailable") {
            store.patch({ toast: t("SettingsUnavailable") });
            return;
        }
        if (result === "failed") {
            store.patch({ toast: t("ToastAdFailed"), notificationsConsent: "denied", notificationsEnabled: false });
            void saveSystem.flush();
            return;
        }
        commit({ notificationsEnabled: result === "enabled", notificationsConsent: "granted" });
        if (result === "enabled") runtimeServices.rearmNotifications();
    };

    const setReducedMotion = () => {
        inkAudio.play("tap");
        const reducedMotion = !state.reducedMotion;
        document.documentElement.dataset.reducedMotion = String(reducedMotion);
        commit({ reducedMotion });
    };

    const setQuality = (quality: "high" | "low") => () => {
        inkAudio.play("tap");
        document.documentElement.dataset.quality = quality;
        commit({ quality });
    };

    return (
        <Panel title={t("MenuSettings")} onClose={onClose}>
            <div className="setting-row">
                <span>{t("SettingsMusic")}</span>
                <Toggle
                    on={state.musicEnabled}
                    label={t("SettingsMusic")}
                    onChange={() => {
                        inkAudio.play("tap");
                        commit({ musicEnabled: !state.musicEnabled });
                    }}
                />
            </div>
            <div className="setting-row">
                <span>{t("SettingsMusicVolume")}</span>
                <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(state.musicVolume * 100)}
                    aria-label={t("SettingsMusicVolume")}
                    onChange={(event) => commit({ musicVolume: Number(event.target.value) / 100 })}
                />
            </div>
            <div className="setting-row">
                <span>{t("SettingsSfx")}</span>
                <Toggle
                    on={state.sfxEnabled}
                    label={t("SettingsSfx")}
                    onChange={() => {
                        inkAudio.play("tap");
                        commit({ sfxEnabled: !state.sfxEnabled });
                    }}
                />
            </div>
            <div className="setting-row">
                <span>{t("SettingsSfxVolume")}</span>
                <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(state.sfxVolume * 100)}
                    aria-label={t("SettingsSfxVolume")}
                    onChange={(event) => commit({ sfxVolume: Number(event.target.value) / 100 })}
                />
            </div>
            <div className="setting-row">
                <span>{t("SettingsHaptics")}</span>
                <Toggle
                    on={state.hapticsEnabled}
                    label={t("SettingsHaptics")}
                    onChange={() => {
                        inkAudio.play("tap");
                        void runtimeServices.haptic("light");
                        commit({ hapticsEnabled: !state.hapticsEnabled });
                    }}
                />
            </div>
            <div className="setting-row">
                <span>{t("SettingsReducedMotion")}</span>
                <Toggle on={state.reducedMotion} label={t("SettingsReducedMotion")} onChange={setReducedMotion} />
            </div>
            <div className="setting-row">
                <span>{t("SettingsQuality")}</span>
                <div className="segmented">
                    <button type="button" data-active={state.quality === "high"} onClick={setQuality("high")}>
                        {t("SettingsHigh")}
                    </button>
                    <button type="button" data-active={state.quality === "low"} onClick={setQuality("low")}>
                        {t("SettingsLow")}
                    </button>
                </div>
            </div>
            <div className="setting-row">
                <span>{t("SettingsNotifications")}</span>
                {capabilities.notifications ? (
                    <Toggle
                        on={state.notificationsEnabled}
                        label={t("SettingsNotifications")}
                        onChange={() => void toggleNotifications()}
                    />
                ) : (
                    <span className="eyebrow">{t("SettingsUnavailable")}</span>
                )}
            </div>
            <div className="setting-row">
                <span>{t("SettingsLanguage")}</span>
                <div className="segmented">
                    {LOCALES.map((locale) => (
                        <button
                            key={locale.id}
                            type="button"
                            data-active={state.locale === locale.id}
                            onClick={() => {
                                inkAudio.play("tap");
                                selectLocale(locale.id);
                            }}
                        >
                            {locale.label}
                        </button>
                    ))}
                </div>
            </div>
        </Panel>
    );
}
