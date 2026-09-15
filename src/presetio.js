/** Reading presets out of SillyTavern, writing them back, and file exchange. */

import { isChatCompletionPreset, normalisePreset } from './schema.js';
import { t } from './i18n.js';

/** The Chat Completion preset manager, or null if the API is not active. */
function manager() {
    try {
        return SillyTavern.getContext().getPresetManager('openai');
    } catch {
        return null;
    }
}

/** @returns {string[]} names of every saved Chat Completion preset */
export function listPresetNames() {
    const pm = manager();
    if (!pm) return [];
    try {
        return pm.getAllPresets().filter(Boolean).sort((a, b) => a.localeCompare(b));
    } catch {
        return [];
    }
}

/**
 * Load a saved preset by name.
 * @param {string} name
 * @returns {object|null} a deep copy, safe to mutate
 */
export function loadPreset(name) {
    const pm = manager();
    if (!pm) return null;
    try {
        const value = pm.findPreset(name);
        const { presets, preset_names } = pm.getPresetList();

        // Keyed APIs map name -> index; others store the object directly.
        let preset = null;
        if (Array.isArray(presets)) {
            const index = typeof value === 'number' ? value : preset_names?.[name];
            preset = typeof index === 'number' ? presets[index] : null;
            if (!preset && typeof value === 'object') preset = value;
        } else if (value && typeof value === 'object') {
            preset = value;
        }

        return isChatCompletionPreset(preset) ? structuredClone(preset) : null;
    } catch (error) {
        console.error('[PresetForge] loadPreset failed', error);
        return null;
    }
}

/**
 * Save a preset into SillyTavern.
 * @param {string} name
 * @param {object} preset
 * @param {boolean} [select] also switch to it
 */
export async function savePreset(name, preset, select = false) {
    const pm = manager();
    if (!pm) throw new Error('Chat Completion preset manager is unavailable. Switch the API to Chat Completion first.');

    const payload = normalisePreset(structuredClone(preset));
    await pm.savePreset(name, payload);

    if (select) {
        try {
            const ctx = SillyTavern.getContext();
            await ctx.executeSlashCommandsWithOptions(`/preset ${name.replace(/[|\\]/g, '')}`, { handleExecutionErrors: true });
        } catch (error) {
            console.warn('[PresetForge] could not select the new preset', error);
        }
    }
    return name;
}

/** Does a preset with this name already exist? */
export function presetExists(name) {
    return listPresetNames().some(existing => existing.toLowerCase() === String(name).toLowerCase());
}

/**
 * Offer the preset as a .json download.
 * @param {string} name
 * @param {object} preset
 */
export function downloadPreset(name, preset) {
    const safe = String(name).replace(/[^\w\-. ]+/g, '_').trim() || 'preset';
    const blob = new Blob([JSON.stringify(preset, null, 4)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safe}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Read a preset from a user-picked file.
 * @param {File} file
 * @returns {Promise<{name:string, preset:object}>}
 */
export async function readPresetFile(file) {
    const text = await file.text();
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error(t('errBadFile'));
    }
    if (!isChatCompletionPreset(parsed)) throw new Error(t('errBadFile'));
    return {
        name: file.name.replace(/\.json$/i, ''),
        preset: parsed,
    };
}

/** Open a file picker and return the chosen preset. */
export function pickPresetFile() {
    return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';
        input.style.display = 'none';
        input.addEventListener('change', async () => {
            const file = input.files?.[0];
            input.remove();
            if (!file) return resolve(null);
            try {
                resolve(await readPresetFile(file));
            } catch (error) {
                reject(error);
            }
        });
        document.body.append(input);
        input.click();
    });
}
