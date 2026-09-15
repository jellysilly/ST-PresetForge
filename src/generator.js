/**
 * Orchestration.
 *
 * A full preset is far too large for one response, so generation runs in two
 * stages: design the architecture, then write module content in batches. The
 * same batched writer backs selective rewriting, which is why rewriting "only
 * these toggles" costs nothing extra.
 */

import { parseModelJson } from './json.js';
import { generateWithRetry } from './backend.js';
import { getSettings } from './settings.js';
import { t } from './i18n.js';
import {
    blueprintSystemPrompt,
    contentSystemPrompt,
    rewriteSystemPrompt,
    targetWords,
} from './doctrine.js';
import {
    createSkeleton,
    makePrompt,
    getActiveOrder,
    normalisePreset,
    applyContent,
    TUNABLE_KEYS,
} from './schema.js';
import { MARKER_IDENTIFIERS, RESERVED_IDENTIFIERS } from './constants.js';

const CORE_KEYS = ['main', 'nsfw', 'jailbreak', 'enhanceDefinitions'];

/** Tokens to request for a batch, scaled by how much prose we asked for. */
function batchTokens(words, count, settings) {
    const estimate = Math.ceil(words * 1.6 * count) + 400;
    return Math.min(Number(settings.maxTokens) || 4096, Math.max(768, estimate));
}

/** Split an array into fixed-size chunks. */
function chunk(items, size) {
    const out = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

/* ------------------------------------------------------------------ *
 * Stage 1: blueprint
 * ------------------------------------------------------------------ */

/**
 * @param {object} opts
 * @param {string} opts.brief
 * @param {string} [opts.presetName]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<object>} normalised blueprint
 */
export async function generateBlueprint({ brief, presetName, signal }) {
    const settings = getSettings();
    const moduleCount = Math.max(6, Math.min(80, Number(settings.moduleCount) || 24));

    const system = blueprintSystemPrompt({ settings, moduleCount });
    const user = [
        'USER BRIEF',
        brief.trim(),
        '',
        presetName?.trim()
            ? `The preset must be named exactly: ${presetName.trim()}`
            : 'Choose a fitting name for the preset.',
        '',
        `Design about ${moduleCount} non-marker modules, plus the required markers.`,
        'Return the blueprint JSON now.',
    ].join('\n');

    const raw = await generateWithRetry({
        system,
        user,
        maxTokens: Math.min(Number(settings.maxTokens) || 4096, 300 + moduleCount * 110),
        signal,
    });

    let parsed;
    try {
        parsed = parseModelJson(raw);
    } catch {
        throw new Error(t('errParse'));
    }
    return normaliseBlueprint(parsed, presetName);
}

/** Coerce whatever the model produced into a blueprint we can build from. */
export function normaliseBlueprint(parsed, presetName) {
    const rawModules = Array.isArray(parsed?.modules)
        ? parsed.modules
        : Array.isArray(parsed?.prompts) ? parsed.prompts : [];
    if (!rawModules.length) throw new Error(t('errParse'));

    const seen = new Set();
    const modules = [];

    for (const entry of rawModules) {
        if (!entry || typeof entry !== 'object') continue;

        let key = String(entry.key ?? entry.identifier ?? '').trim();
        let kind = String(entry.kind ?? 'rule').trim().toLowerCase();
        const core = String(entry.core ?? '').trim();

        // A module claiming a reserved key is a marker or a core prompt.
        if (MARKER_IDENTIFIERS.includes(key)) kind = 'marker';
        else if (CORE_KEYS.includes(key) && kind !== 'marker') kind = 'core';
        if (kind === 'core' && CORE_KEYS.includes(core)) key = core;

        if (!key) key = `mod_${modules.length + 1}`;
        key = key.replace(/[^\w.-]/g, '_').slice(0, 64);
        if (seen.has(key)) continue;
        seen.add(key);

        modules.push({
            key,
            label: String(entry.label ?? entry.name ?? key).trim().slice(0, 80) || key,
            kind: ['rule', 'option', 'feature', 'group_open', 'group_close', 'core', 'marker'].includes(kind) ? kind : 'rule',
            group: entry.group ? String(entry.group).trim().slice(0, 40) : '',
            core: CORE_KEYS.includes(core) ? core : '',
            role: ['system', 'user', 'assistant'].includes(entry.role) ? entry.role : 'system',
            enabled: entry.enabled !== false,
            brief: String(entry.brief ?? entry.description ?? '').trim(),
        });
    }

    // Exactly one enabled member per exclusive group.
    const groups = new Map();
    for (const module of modules) {
        if (module.kind !== 'option' || !module.group) continue;
        if (!groups.has(module.group)) groups.set(module.group, []);
        groups.get(module.group).push(module);
    }
    for (const members of groups.values()) {
        const enabled = members.filter(m => m.enabled);
        if (enabled.length === 0) {
            members[0].enabled = true;
        } else if (enabled.length > 1) {
            enabled.slice(1).forEach(m => { m.enabled = false; });
        }
    }

    // Append any marker the model forgot, so the preset stays valid.
    for (const identifier of MARKER_IDENTIFIERS) {
        if (seen.has(identifier)) continue;
        modules.push({
            key: identifier,
            label: identifier,
            kind: 'marker',
            group: '',
            core: '',
            role: 'system',
            enabled: true,
            brief: '',
        });
        seen.add(identifier);
    }

    const settings = {};
    for (const key of TUNABLE_KEYS) {
        const value = parsed?.settings?.[key];
        if (value !== undefined && value !== null && value !== '') settings[key] = value;
    }

    return {
        name: (presetName?.trim() || String(parsed?.name ?? '').trim() || 'Forged Preset').slice(0, 64),
        summary: String(parsed?.summary ?? '').trim(),
        settings,
        modules,
    };
}

/* ------------------------------------------------------------------ *
 * Stage 2: content
 * ------------------------------------------------------------------ */

/** Modules that need prose written for them. */
function writableModules(modules) {
    return modules.filter(m => m.kind !== 'marker');
}

/** A short map of the whole preset, so each batch knows its neighbours. */
function architectureSummary(blueprint) {
    return blueprint.modules
        .filter(m => m.kind !== 'marker')
        .map(m => {
            const tag = m.kind === 'option' && m.group ? `option:${m.group}` : m.kind;
            return `- ${m.key} [${tag}] ${m.label}`;
        })
        .join('\n');
}

/**
 * Write content for a blueprint, in batches.
 * @param {object} opts
 * @param {object} opts.blueprint
 * @param {string} opts.brief
 * @param {AbortSignal} [opts.signal]
 * @param {(info:{phase:string,done:number,total:number,from:number,to:number})=>void} [opts.onProgress]
 * @returns {Promise<Map<string,{content:string,label?:string}>>}
 */
export async function generateContent({ blueprint, brief, signal, onProgress }) {
    const settings = getSettings();
    const words = targetWords(settings);
    const size = Math.max(1, Math.min(12, Number(settings.batchSize) || 4));
    const targets = writableModules(blueprint.modules);
    const batches = chunk(targets, size);
    const results = new Map();
    const overview = architectureSummary(blueprint);

    let done = 0;
    for (const batch of batches) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

        onProgress?.({
            phase: 'content',
            done,
            total: targets.length,
            from: done + 1,
            to: Math.min(done + batch.length, targets.length),
        });

        const user = [
            'PRESET', `Name: ${blueprint.name}`,
            blueprint.summary ? `Summary: ${blueprint.summary}` : '',
            '',
            'USER BRIEF', brief.trim(),
            '',
            'FULL MODULE STACK (for context — do NOT write these)',
            overview,
            '',
            'WRITE CONTENT FOR EXACTLY THESE MODULES',
            JSON.stringify(batch.map(m => ({
                key: m.key,
                label: m.label,
                kind: m.kind,
                group: m.group || undefined,
                brief: m.brief,
            })), null, 1),
            '',
            'Return the JSON object now.',
        ].filter(Boolean).join('\n');

        const raw = await generateWithRetry({
            system: contentSystemPrompt({ settings, words }),
            user,
            maxTokens: batchTokens(words, batch.length, settings),
            signal,
        });

        mergeBatch(raw, batch, results);
        done += batch.length;
    }

    onProgress?.({ phase: 'content', done, total: targets.length, from: targets.length, to: targets.length });
    return results;
}

/**
 * Fold one batch response into the result map. A batch that fails to parse
 * costs only its own modules, never the run.
 */
function mergeBatch(raw, batch, results) {
    let entries = [];
    try {
        const parsed = parseModelJson(raw);
        entries = Array.isArray(parsed) ? parsed
            : Array.isArray(parsed?.modules) ? parsed.modules
                : Array.isArray(parsed?.prompts) ? parsed.prompts : [];
    } catch {
        return;
    }

    const byKey = new Map(batch.map(m => [m.key, m]));
    entries.forEach((entry, index) => {
        if (!entry || typeof entry !== 'object') return;
        const content = typeof entry.content === 'string' ? entry.content
            : typeof entry.text === 'string' ? entry.text : '';
        if (!content.trim()) return;

        // Match by key, falling back to position when the model renamed things.
        const key = String(entry.key ?? entry.identifier ?? '').trim();
        const target = byKey.get(key) ?? batch[index];
        if (!target) return;

        const record = { content: content.trim() };
        const label = typeof entry.label === 'string' ? entry.label.trim() : '';
        if (label) record.label = label.slice(0, 80);
        results.set(target.key, record);
    });
}

/* ------------------------------------------------------------------ *
 * Assembly
 * ------------------------------------------------------------------ */

/**
 * Turn a blueprint plus its written content into a SillyTavern preset.
 * @param {object} blueprint
 * @param {Map<string,{content:string,label?:string}>} content
 */
export function assemblePreset(blueprint, content) {
    const preset = createSkeleton(blueprint.settings);
    const byIdentifier = new Map(preset.prompts.map(p => [p.identifier, p]));
    const order = getActiveOrder(preset);
    order.length = 0;

    for (const module of blueprint.modules) {
        const written = content.get(module.key);
        const label = written?.label ?? module.label;
        const body = written?.content ?? '';

        if (module.kind === 'marker' || RESERVED_IDENTIFIERS.includes(module.key)) {
            // Reuse the prompt the skeleton already created.
            const existing = byIdentifier.get(module.key);
            if (!existing) continue;
            if (label && label !== module.key) existing.name = label;
            if (module.kind !== 'marker' && body) existing.content = body;
            // Chat History and Chat Examples are pure markers: giving them a
            // role would add a field stock presets do not have.
            if (Object.hasOwn(existing, 'role')) existing.role = module.role ?? existing.role;
            order.push({ identifier: module.key, enabled: module.enabled !== false });
            continue;
        }

        const prompt = makePrompt({
            name: label,
            role: module.role,
            content: body,
            system_prompt: false,
        });
        preset.prompts.push(prompt);
        order.push({ identifier: prompt.identifier, enabled: module.enabled !== false });
    }

    return normalisePreset(preset);
}

/**
 * Full create flow.
 * @param {object} opts
 * @returns {Promise<{preset:object, blueprint:object, missing:number}>}
 */
export async function forgePreset({ brief, presetName, signal, onProgress }) {
    onProgress?.({ phase: 'blueprint' });
    const blueprint = await generateBlueprint({ brief, presetName, signal });

    const content = await generateContent({ blueprint, brief, signal, onProgress });

    onProgress?.({ phase: 'assemble' });
    const preset = assemblePreset(blueprint, content);
    const writable = writableModules(blueprint.modules).length;

    return { preset, blueprint, missing: writable - content.size };
}

/* ------------------------------------------------------------------ *
 * Rewrite
 * ------------------------------------------------------------------ */

/**
 * Rewrite selected modules of an existing preset, leaving everything else
 * byte-for-byte intact.
 *
 * @param {object} opts
 * @param {object} opts.preset      parsed preset (mutated on a copy)
 * @param {Array} opts.modules      modules to rewrite, from schema.listModules
 * @param {string} opts.brief       the change request
 * @param {boolean} opts.keepNames
 * @param {AbortSignal} [opts.signal]
 * @param {Function} [opts.onProgress]
 * @returns {Promise<{preset:object, applied:number, empty:number}>}
 */
export async function rewriteModules({ preset, modules, brief, keepNames, signal, onProgress }) {
    const settings = getSettings();
    const words = targetWords(settings);
    const size = Math.max(1, Math.min(12, Number(settings.batchSize) || 4));
    const draft = structuredClone(preset);

    const targets = modules.filter(m => !m.marker);
    const batches = chunk(targets, size);

    // Give the model the shape of the whole preset so rewrites stay coherent.
    const overview = modules
        .filter(m => !m.marker)
        .map(m => `- ${m.name}${m.enabled ? '' : ' (disabled)'}`)
        .join('\n')
        .slice(0, 4000);

    const updates = [];
    let done = 0;

    for (const batch of batches) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

        onProgress?.({
            phase: 'rewrite',
            done,
            total: targets.length,
            from: done + 1,
            to: Math.min(done + batch.length, targets.length),
        });

        const user = [
            'CHANGE REQUEST', brief.trim(),
            '',
            'THE PRESET AS A WHOLE (context — do NOT rewrite these)',
            overview,
            '',
            'REWRITE EXACTLY THESE MODULES',
            JSON.stringify(batch.map(m => ({
                key: m.identifier,
                label: m.name,
                content: m.content,
            })), null, 1),
            '',
            'Return the JSON object now.',
        ].join('\n');

        const raw = await generateWithRetry({
            system: rewriteSystemPrompt({ settings, words, keepNames }),
            user,
            maxTokens: batchTokens(words, batch.length, settings),
            signal,
        });

        const results = new Map();
        mergeBatch(raw, batch.map(m => ({ key: m.identifier })), results);
        for (const [identifier, record] of results) {
            updates.push({
                identifier,
                content: record.content,
                name: keepNames ? undefined : record.label,
            });
        }
        done += batch.length;
    }

    onProgress?.({ phase: 'rewrite', done, total: targets.length, from: targets.length, to: targets.length });

    const { applied } = applyContent(draft, updates);
    // Anything the model skipped keeps its original content.
    return { preset: normalisePreset(draft), applied, empty: targets.length - applied };
}
