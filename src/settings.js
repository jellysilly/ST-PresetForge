/** Persisted extension settings, stored inside SillyTavern's own settings blob. */

import { SETTINGS_KEY } from './constants.js';
import { setLanguage } from './i18n.js';

const DEFAULTS = Object.freeze({
    /** Interface language. English by default, per spec. */
    uiLanguage: 'en',
    /** Language the generated prompts are written in. */
    promptLanguage: 'en',

    /** 'main' uses the active connection, 'profile' uses a Connection Manager profile. */
    apiSource: 'main',
    profileId: '',

    /** compact | normal | detailed | extensive | custom */
    lengthPreset: 'normal',
    customWords: 200,
    maxTokens: 4096,
    batchSize: 4,
    /** null means "leave it to the API preset". */
    temperature: null,

    moduleCount: 24,
    namingStyle: 'minimal',
    purpose: 'roleplay',

    autoSave: true,

    buttonVisible: true,
    /** Percentages of the viewport so the button survives rotation and resizes. */
    buttonX: null,
    buttonY: null,

    panelWidth: 0,
    panelHeight: 0,
});

/** @returns {Record<string, any>} */
export function getSettings() {
    const ctx = SillyTavern.getContext();
    const store = ctx.extensionSettings;
    if (!store[SETTINGS_KEY] || typeof store[SETTINGS_KEY] !== 'object') {
        store[SETTINGS_KEY] = structuredClone(DEFAULTS);
    }
    const settings = store[SETTINGS_KEY];
    for (const [key, value] of Object.entries(DEFAULTS)) {
        if (!Object.hasOwn(settings, key)) {
            settings[key] = value;
        }
    }
    return settings;
}

/**
 * Write one or more settings and persist them.
 * @param {Record<string, any>} patch
 */
export function updateSettings(patch) {
    const settings = getSettings();
    Object.assign(settings, patch);
    if (Object.hasOwn(patch, 'uiLanguage')) {
        setLanguage(settings.uiLanguage);
    }
    SillyTavern.getContext().saveSettingsDebounced();
    return settings;
}

export function resetSettings() {
    const ctx = SillyTavern.getContext();
    ctx.extensionSettings[SETTINGS_KEY] = structuredClone(DEFAULTS);
    setLanguage(DEFAULTS.uiLanguage);
    ctx.saveSettingsDebounced();
    return ctx.extensionSettings[SETTINGS_KEY];
}

export { DEFAULTS };
