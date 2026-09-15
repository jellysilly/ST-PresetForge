/**
 * Construction and validation of SillyTavern Chat Completion presets.
 *
 * A preset is a flat `prompts[]` array plus a `prompt_order[]` that decides
 * which of them are active and in what order. Order entry 100000 carries
 * SillyTavern's built-in default; 100001 carries the preset's own order.
 */

import {
    DEFAULT_ORDER_ID,
    PRESET_ORDER_ID,
    MARKER_IDENTIFIERS,
    RESERVED_IDENTIFIERS,
} from './constants.js';

const uuid = () => SillyTavern.getContext().uuidv4();

/** Sampler and behaviour defaults, matching a stock Chat Completion preset. */
export const SAMPLER_DEFAULTS = Object.freeze({
    temperature: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    top_p: 1,
    top_k: 0,
    top_a: 0,
    min_p: 0,
    repetition_penalty: 1,
    max_context_unlocked: true,
    openai_max_context: 64000,
    openai_max_tokens: 2048,
    names_behavior: 0,
    send_if_empty: '',
    wi_format: '{0}',
    scenario_format: '{{scenario}}',
    personality_format: '{{personality}}',
    group_nudge_prompt: '[Write the next reply only as {{char}}.]',
    new_chat_prompt: '[Start a new Chat]',
    new_group_chat_prompt: '[Start a new group chat. Group members: {{group}}]',
    new_example_chat_prompt: '[Example Chat]',
    continue_nudge_prompt: '[Continue your last message without repeating its original content.]',
    impersonation_prompt: '[Write your next reply from the point of view of {{user}}, using the chat history so far as a guideline for the writing style.]',
    bias_preset_selected: 'Default (none)',
    stream_openai: true,
    assistant_prefill: '',
    assistant_impersonation: '',
    use_sysprompt: false,
    squash_system_messages: true,
    media_inlining: false,
    inline_image_quality: 'auto',
    continue_prefill: false,
    continue_postfix: ' ',
    function_calling: false,
    tool_call_recurse_limit: 5,
    show_thoughts: true,
    reasoning_effort: 'medium',
    verbosity: 'auto',
    enable_web_search: false,
    seed: -1,
    n: 1,
    tool_reasoning_mode: 'disabled',
    request_images: false,
    request_image_aspect_ratio: '',
    request_image_resolution: '',
    extensions: { regex_scripts: [] },
});

/** Sampler keys a generated blueprint is allowed to set. */
export const TUNABLE_KEYS = Object.freeze([
    'temperature', 'frequency_penalty', 'presence_penalty', 'top_p', 'top_k',
    'top_a', 'min_p', 'repetition_penalty', 'openai_max_context',
    'openai_max_tokens', 'squash_system_messages', 'stream_openai',
    'assistant_prefill', 'reasoning_effort',
]);

/** Human-readable labels for the app-owned prompts. */
const MARKER_LABELS = {
    worldInfoBefore: 'World Info (before)',
    worldInfoAfter: 'World Info (after)',
    charDescription: 'Char Description',
    charPersonality: 'Char Personality',
    scenario: 'Scenario',
    personaDescription: 'Persona Description',
    dialogueExamples: 'Chat Examples',
    chatHistory: 'Chat History',
};

/**
 * Build one prompt entry.
 * @param {object} spec
 * @returns {object}
 */
export function makePrompt(spec) {
    const identifier = spec.identifier ?? uuid();
    const base = {
        identifier,
        name: spec.name ?? 'Untitled',
        system_prompt: spec.system_prompt ?? RESERVED_IDENTIFIERS.includes(identifier),
        role: spec.role ?? 'system',
        content: spec.content ?? '',
        injection_position: spec.injection_position ?? 0,
        injection_depth: spec.injection_depth ?? 4,
        injection_order: spec.injection_order ?? 100,
        injection_trigger: Array.isArray(spec.injection_trigger) ? spec.injection_trigger : [],
        forbid_overrides: spec.forbid_overrides ?? false,
    };
    if (spec.marker) base.marker = true;
    return base;
}

/** The eight prompts SillyTavern fills in itself. */
function markerPrompts(labels = {}) {
    return MARKER_IDENTIFIERS.map(identifier => {
        const entry = {
            identifier,
            name: labels[identifier] ?? MARKER_LABELS[identifier],
            system_prompt: true,
            marker: true,
        };
        // Chat History and Chat Examples are pure markers with no fields.
        if (identifier !== 'chatHistory' && identifier !== 'dialogueExamples') {
            Object.assign(entry, {
                role: 'system',
                content: '',
                injection_position: 0,
                injection_depth: 4,
                injection_order: 100,
                injection_trigger: [],
                forbid_overrides: false,
            });
        }
        return entry;
    });
}

/** The four editable prompts that keep a fixed identifier. */
function corePrompts(labels = {}, contents = {}) {
    return [
        ['main', 'Main Prompt', "Write {{char}}'s next reply in a fictional chat between {{char}} and {{user}}."],
        ['nsfw', 'Auxiliary Prompt', ''],
        ['jailbreak', 'Post-History Instructions', ''],
        ['enhanceDefinitions', 'Enhance Definitions', ''],
    ].map(([identifier, label, fallback]) => makePrompt({
        identifier,
        name: labels[identifier] ?? label,
        system_prompt: true,
        role: 'system',
        content: contents[identifier] ?? fallback,
    }));
}

/** SillyTavern's stock ordering, stored under character id 100000. */
function defaultOrder() {
    return [
        { identifier: 'main', enabled: true },
        { identifier: 'worldInfoBefore', enabled: true },
        { identifier: 'charDescription', enabled: true },
        { identifier: 'charPersonality', enabled: true },
        { identifier: 'scenario', enabled: true },
        { identifier: 'enhanceDefinitions', enabled: false },
        { identifier: 'nsfw', enabled: true },
        { identifier: 'worldInfoAfter', enabled: true },
        { identifier: 'dialogueExamples', enabled: true },
        { identifier: 'chatHistory', enabled: true },
        { identifier: 'jailbreak', enabled: true },
    ];
}

/**
 * Create an empty but valid preset skeleton.
 * @param {Record<string, any>} [settings] sampler overrides
 */
export function createSkeleton(settings = {}) {
    const clean = {};
    for (const key of TUNABLE_KEYS) {
        if (settings[key] !== undefined && settings[key] !== null) clean[key] = settings[key];
    }
    const prompts = [...corePrompts(), ...markerPrompts()];
    return {
        ...structuredClone(SAMPLER_DEFAULTS),
        ...clean,
        prompts,
        prompt_order: [
            { character_id: DEFAULT_ORDER_ID, order: defaultOrder() },
            { character_id: PRESET_ORDER_ID, order: [] },
        ],
    };
}

/**
 * Does this object look like a Chat Completion preset?
 * @param {any} data
 */
export function isChatCompletionPreset(data) {
    return !!data
        && typeof data === 'object'
        && Array.isArray(data.prompts)
        && Array.isArray(data.prompt_order);
}

/**
 * Return the order array the preset actually uses, creating it if missing.
 * @param {object} preset
 */
export function getActiveOrder(preset) {
    if (!Array.isArray(preset.prompt_order)) preset.prompt_order = [];
    let entry = preset.prompt_order.find(e => Number(e.character_id) === PRESET_ORDER_ID);
    if (!entry) {
        // Some presets only ship the default order; promote the richest one.
        const richest = [...preset.prompt_order].sort((a, b) => (b.order?.length ?? 0) - (a.order?.length ?? 0))[0];
        entry = { character_id: PRESET_ORDER_ID, order: structuredClone(richest?.order ?? defaultOrder()) };
        preset.prompt_order.push(entry);
    }
    if (!Array.isArray(entry.order)) entry.order = [];
    return entry.order;
}

/**
 * Flatten a preset into the module list the UI works with.
 * @param {object} preset
 * @returns {Array<{identifier:string,name:string,content:string,role:string,enabled:boolean,marker:boolean,reserved:boolean,index:number}>}
 */
export function listModules(preset) {
    const byId = new Map(preset.prompts.map(p => [p.identifier, p]));
    const order = getActiveOrder(preset);
    const seen = new Set();
    const modules = [];

    order.forEach((entry, index) => {
        const prompt = byId.get(entry.identifier);
        if (!prompt) return;
        seen.add(entry.identifier);
        modules.push(toModule(prompt, entry.enabled !== false, index));
    });

    // Prompts that exist but are not in the order are still editable.
    for (const prompt of preset.prompts) {
        if (seen.has(prompt.identifier)) continue;
        modules.push(toModule(prompt, false, modules.length));
    }
    return modules;
}

function toModule(prompt, enabled, index) {
    return {
        identifier: prompt.identifier,
        name: prompt.name ?? '',
        content: prompt.content ?? '',
        role: prompt.role ?? 'system',
        enabled,
        marker: !!prompt.marker,
        reserved: RESERVED_IDENTIFIERS.includes(prompt.identifier),
        index,
    };
}

/**
 * Apply generated content back onto a preset, in place.
 * @param {object} preset
 * @param {Array<{identifier:string,content?:string,name?:string}>} updates
 * @returns {{applied:number, empty:number}}
 */
export function applyContent(preset, updates) {
    const byId = new Map(preset.prompts.map(p => [p.identifier, p]));
    let applied = 0;
    let empty = 0;

    for (const update of updates) {
        const prompt = byId.get(update.identifier);
        if (!prompt) continue;
        const content = typeof update.content === 'string' ? update.content.trim() : '';
        if (!content) { empty++; continue; }
        prompt.content = content;
        if (typeof update.name === 'string' && update.name.trim()) {
            prompt.name = update.name.trim();
        }
        applied++;
    }
    return { applied, empty };
}

/**
 * Insert a new module into the preset and its order.
 * @param {object} preset
 * @param {object} spec
 * @param {number} [position] index in the order; appended when omitted
 */
export function addModule(preset, spec, position) {
    const prompt = makePrompt(spec);
    preset.prompts.push(prompt);
    const order = getActiveOrder(preset);
    const entry = { identifier: prompt.identifier, enabled: spec.enabled !== false };
    if (Number.isInteger(position) && position >= 0 && position < order.length) {
        order.splice(position, 0, entry);
    } else {
        order.push(entry);
    }
    return prompt;
}

/**
 * Remove a module. App-owned prompts are protected.
 * @param {object} preset
 * @param {string} identifier
 */
export function removeModule(preset, identifier) {
    if (RESERVED_IDENTIFIERS.includes(identifier)) return false;
    preset.prompts = preset.prompts.filter(p => p.identifier !== identifier);
    const order = getActiveOrder(preset);
    const index = order.findIndex(e => e.identifier === identifier);
    if (index !== -1) order.splice(index, 1);
    return true;
}

/**
 * Toggle a module on or off in the prompt order.
 * @param {object} preset
 * @param {string} identifier
 * @param {boolean} enabled
 */
export function setEnabled(preset, identifier, enabled) {
    const order = getActiveOrder(preset);
    const entry = order.find(e => e.identifier === identifier);
    if (entry) entry.enabled = !!enabled;
}

/**
 * Repair anything a generated preset got wrong: missing app prompts, order
 * entries pointing at nothing, duplicate identifiers, absent order rows.
 * @param {object} preset
 * @returns {object} the same object, mutated
 */
export function normalisePreset(preset) {
    if (!Array.isArray(preset.prompts)) preset.prompts = [];

    // Drop duplicates, keeping the first occurrence.
    const seen = new Set();
    preset.prompts = preset.prompts.filter(p => {
        if (!p?.identifier || seen.has(p.identifier)) return false;
        seen.add(p.identifier);
        return true;
    });

    // Re-add anything SillyTavern requires.
    const existing = new Set(preset.prompts.map(p => p.identifier));
    const required = [...corePrompts(), ...markerPrompts()];
    for (const prompt of required) {
        if (!existing.has(prompt.identifier)) preset.prompts.push(prompt);
    }

    const valid = new Set(preset.prompts.map(p => p.identifier));
    const order = getActiveOrder(preset);

    // Prune order entries with no prompt behind them.
    const pruned = order.filter(e => valid.has(e.identifier));
    const inOrder = new Set(pruned.map(e => e.identifier));

    // Every app-owned prompt must appear somewhere in the order.
    for (const identifier of [...MARKER_IDENTIFIERS, 'main', 'nsfw', 'jailbreak', 'enhanceDefinitions']) {
        if (!inOrder.has(identifier)) {
            pruned.push({ identifier, enabled: identifier !== 'enhanceDefinitions' });
            inOrder.add(identifier);
        }
    }
    order.length = 0;
    order.push(...pruned);

    // Guarantee the default order row exists.
    if (!preset.prompt_order.some(e => Number(e.character_id) === DEFAULT_ORDER_ID)) {
        preset.prompt_order.unshift({ character_id: DEFAULT_ORDER_ID, order: defaultOrder() });
    }

    return preset;
}
