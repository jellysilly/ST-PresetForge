/**
 * Two generation paths:
 *   main    — the connection SillyTavern is currently using (context.generateRaw)
 *   profile — an independent Connection Manager profile, so a preset can be
 *             forged on a cheap model while chatting on an expensive one.
 */

import { getSettings } from './settings.js';
import { t } from './i18n.js';
import { shieldMacros, unshieldMacros } from './macros.js';

/** Is the Connection Manager loaded and usable? */
export function isConnectionManagerAvailable() {
    try {
        const ctx = SillyTavern.getContext();
        if (!ctx.ConnectionManagerRequestService) return false;
        if (ctx.extensionSettings?.disabledExtensions?.includes('connection-manager')) return false;
        return Array.isArray(ctx.extensionSettings?.connectionManager?.profiles);
    } catch {
        return false;
    }
}

/** @returns {Array<{id:string,name:string}>} profiles that can actually serve a request */
export function listProfiles() {
    if (!isConnectionManagerAvailable()) return [];
    try {
        return SillyTavern.getContext().ConnectionManagerRequestService
            .getSupportedProfiles()
            .map(p => ({ id: p.id, name: p.name }))
            .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
        return [];
    }
}

/** Pull the text out of whatever shape the backend returned. */
function extractText(result) {
    if (typeof result === 'string') return result;
    if (result && typeof result === 'object') {
        if (typeof result.content === 'string') return result.content;
        if (typeof result.text === 'string') return result.text;
    }
    return '';
}

/**
 * Run one generation.
 * @param {object} req
 * @param {string} req.system      system instruction
 * @param {string} req.user        user turn
 * @param {number} [req.maxTokens]
 * @param {AbortSignal} [req.signal]
 * @returns {Promise<string>}
 */
export async function generate({ system, user, maxTokens, signal }) {
    const ctx = SillyTavern.getContext();
    const settings = getSettings();
    const tokens = Number(maxTokens) || Number(settings.maxTokens) || 4096;

    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    // Shield on every path, so the model sees one consistent notation and no
    // macro can ever be expanded or executed on its way out.
    system = shieldMacros(system);
    user = shieldMacros(user);

    if (settings.apiSource === 'profile') {
        if (!isConnectionManagerAvailable()) throw new Error(t('profileMissing'));
        if (!settings.profileId) throw new Error(t('errNoProfile'));

        const overridePayload = {};
        if (settings.temperature !== null && settings.temperature !== undefined) {
            overridePayload.temperature = Number(settings.temperature);
        }

        const result = await ctx.ConnectionManagerRequestService.sendRequest(
            settings.profileId,
            [
                { role: 'system', content: system },
                { role: 'user', content: user },
            ],
            tokens,
            { stream: false, signal, extractData: true, includePreset: false, includeInstruct: false },
            overridePayload,
        );
        return unshieldMacros(extractText(result));
    }

    // Main API. generateRaw honours the active connection, preset and instruct
    // template, and returns a plain string.
    const result = await ctx.generateRaw({
        prompt: [{ role: 'user', content: user }],
        systemPrompt: system,
        responseLength: tokens,
        trimNames: false,
    });

    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return unshieldMacros(extractText(result));
}

/**
 * Generate with retries. Transient API hiccups are common on long batches, and
 * losing a whole run to one 503 is worse than waiting a couple of seconds.
 * @param {object} req see generate()
 * @param {number} [attempts]
 */
export async function generateWithRetry(req, attempts = 2) {
    let lastError;
    for (let attempt = 0; attempt <= attempts; attempt++) {
        try {
            const text = await generate(req);
            if (text && text.trim()) return text;
            lastError = new Error('Empty response');
        } catch (error) {
            if (error?.name === 'AbortError' || req.signal?.aborted) throw error;
            lastError = error;
        }
        if (attempt < attempts) {
            await new Promise(resolve => setTimeout(resolve, 800 * (attempt + 1)));
        }
    }
    throw lastError ?? new Error('Generation failed');
}
