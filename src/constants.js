/** Static identifiers and schema constants for ST-PresetForge. */

export const EXT_ID = 'ST-PresetForge';
export const SETTINGS_KEY = 'presetForge';
export const VERSION = '1.0.0';

/**
 * SillyTavern uses a dummy character id for the per-character prompt order that
 * a Chat Completion preset ships with. 100000 holds the built-in default order,
 * 100001 holds the order actually used by the preset.
 */
export const DEFAULT_ORDER_ID = 100000;
export const PRESET_ORDER_ID = 100001;

/**
 * Prompts SillyTavern injects itself. They must exist in every preset, they may
 * never be renamed away, and their content is owned by the app (except for the
 * three that double as editable system prompts: main / nsfw / jailbreak).
 */
export const MARKER_IDENTIFIERS = Object.freeze([
    'worldInfoBefore',
    'worldInfoAfter',
    'charDescription',
    'charPersonality',
    'scenario',
    'personaDescription',
    'dialogueExamples',
    'chatHistory',
]);

/** Core prompts that carry editable content but keep a fixed identifier. */
export const CORE_IDENTIFIERS = Object.freeze(['main', 'nsfw', 'jailbreak', 'enhanceDefinitions']);

/** Every identifier the app owns. Generated modules must never reuse these. */
export const RESERVED_IDENTIFIERS = Object.freeze([...MARKER_IDENTIFIERS, ...CORE_IDENTIFIERS]);

/** Per-module content length targets, in words. */
export const LENGTH_PRESETS = Object.freeze({
    compact: { words: 60, tokens: 2048 },
    normal: { words: 140, tokens: 3072 },
    detailed: { words: 260, tokens: 4096 },
    extensive: { words: 420, tokens: 6144 },
});
