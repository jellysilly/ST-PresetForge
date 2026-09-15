/**
 * Minimal SillyTavern stand-in, so the real generation pipeline can be driven
 * from Node without a browser. Mocks only what the extension actually calls.
 */

import crypto from 'node:crypto';

export function installMockSillyTavern({ respond }) {
    const extensionSettings = { disabledExtensions: [], connectionManager: { profiles: [] } };
    const calls = [];

    globalThis.SillyTavern = {
        getContext: () => ({
            extensionSettings,
            saveSettingsDebounced: () => {},
            uuidv4: () => crypto.randomUUID(),
            generateRaw: async ({ prompt, systemPrompt }) => {
                const user = Array.isArray(prompt) ? prompt.map(p => p.content).join('\n') : String(prompt);
                calls.push({ system: systemPrompt, user });
                return respond({ system: systemPrompt, user });
            },
            getPresetManager: () => null,
            ConnectionManagerRequestService: null,
        }),
    };

    return { extensionSettings, calls };
}

/** Classify a request by the task line in its system prompt. */
export function stageOf(system) {
    if (system.includes('design the architecture only')) return 'blueprint';
    if (system.includes('rewrite existing prompt modules')) return 'rewrite';
    return 'content';
}

/**
 * Pull the module list out of the user turn of a content/rewrite request.
 * Anchored on the header line, because the context overview above it also
 * contains bracket characters.
 */
export function requestedKeys(user) {
    const header = /(?:WRITE CONTENT FOR EXACTLY THESE MODULES|REWRITE EXACTLY THESE MODULES)\n/.exec(user);
    if (!header) return [];
    const from = user.indexOf('[', header.index + header[0].length);
    const end = user.lastIndexOf(']');
    if (from === -1 || end <= from) return [];
    try {
        return JSON.parse(user.slice(from, end + 1)).map(m => m.key);
    } catch {
        return [];
    }
}
