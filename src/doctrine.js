/**
 * The domain knowledge PresetForge hands to the model.
 *
 * Distilled from the structure of production SillyTavern Chat Completion
 * presets: what a prompt module is, how modules are grouped into exclusive
 * option sets, which macros exist, and what the house prose style looks like.
 */

import { LENGTH_PRESETS, RESERVED_IDENTIFIERS } from './constants.js';
import { macroNotationNote } from './macros.js';

/** Reserved keys the blueprint must place, in the order they usually appear. */
export const RESERVED_KEYS = RESERVED_IDENTIFIERS;

const MODULE_KINDS = `
MODULE KINDS
- "rule"        always-on directive. Enabled by default. The backbone of the preset.
- "option"      one of several mutually exclusive choices sharing a "group" name.
                Exactly ONE member of each group is enabled; the rest are off.
- "feature"     an optional subsystem the user switches on (status HUD, dice,
                memory ledger, in-world social feed, tarot draw, glitch persona).
                Usually off by default unless the brief asks for it.
- "group_open"  a delimiter that opens a visual/structural section. Content is
                either empty or a single opening tag such as <formatting>.
- "group_close" the matching closer. Content is empty or </formatting>.
- "core"        binds to a SillyTavern-owned prompt. Set "core" to one of
                main / nsfw / jailbreak / enhanceDefinitions.
- "marker"      a SillyTavern injection point. Set "key" to one of:
                worldInfoBefore, worldInfoAfter, charDescription,
                charPersonality, scenario, personaDescription,
                dialogueExamples, chatHistory. Content is always empty —
                SillyTavern fills these in. Each must appear exactly once.
`.trim();

const MACROS = `
MACROS (write them literally; SillyTavern expands them at runtime)
  {{char}}  {{user}}  {{persona}}  {{scenario}}  {{group}}  {{description}}
  {{setvar::name::value}}{{trim}}   store a value for later modules
  {{getvar::name}}                  read a value another module stored
  {{random::a,b,c}}   {{roll::d20}}   {{newline}}
Use {{setvar::…}}{{trim}} to publish a fact other modules depend on — a length
target, a chosen language, a style label, a self-check question. Use
{{getvar::…}} to consume it. Never invent macros outside this list.
`.trim();

const STYLE_RULES = `
HOUSE STYLE FOR MODULE CONTENT
- Address the model that will run the chat. Imperative, second person, present.
- Open with a short ALL-CAPS label naming the rule, then the directives.
- Declarative and absolute. "Never", "always", "stop at". No hedging, no
  "try to", no "you should consider". No apologies, no meta-talk about being
  an AI, no praise of the user.
- One idea per line. Line breaks instead of paragraphs. No markdown headers,
  no bullet characters, no numbered lists inside content.
- Be concrete. "Cut adverbs from dialogue tags" beats "write good dialogue".
- Anti-pattern rules name the failure they forbid and give the correct move
  instead: forbid the echo, then say react directly.
- Where a module defines an output format, give the template on one line and
  a single worked example on the next.
- Close a substantial rule with a {{setvar::…}}{{trim}} that stores either a
  compact restatement or a yes/no self-check question.
- Never mention PresetForge, JSON, modules, toggles or this instruction set
  inside the content. The content is the prompt, not a description of it.
`.trim();

const EXAMPLES = `
WORKED EXAMPLES OF MODULE CONTENT

kind=rule, label "✒ anti-echo."
ANTI-ECHO RULE: {{char}} reacts directly as a real person. NEVER repeat, quote,
paraphrase, or mirror {{user}}'s words, phrasing, or sentence structures. Skip
analytical echoing and respond immediately. Zero exceptions, even for emphasis.
{{setvar::anti_echo_check::Is my response free of {{user}}'s words and structure, and am I reacting instead of echoing?}}{{trim}}

kind=option, group "bias", label "⚖ neutral."
BIAS NEUTRAL: Never default to artificial warmth or forced drama. Resolve all
ambiguity strictly through the character's established psychology and the
immediate facts of the situation.
{{setvar::bias_correction::What would this character actually feel right now, given their psychology and the facts? Do not lean positive or negative.}}{{trim}}

kind=option, group "length", label "⚖ long."
{{setvar::length::800-900 words}}{{trim}}

kind=feature, label "𝚿 clock."
HEADS-UP DISPLAY PROTOCOL:
{{setvar::hud_active::True - before narrative}}{{trim}}
Immediately before the narrative, emit one HUD line:
[HUD: HH:MM | Weekday | DD.MM.YYYY | Location | Weather | Moon phase + symbol | Relationship | {{user}} clothing | {{char}} clothing]
Example: [HUD: 21:45 | Friday | 12.04.2024 | Kabukicho, Tokyo | +18°C Rainy | Full Moon 🌕 | Wary allies | Black leather jacket, dark jeans | Silk kimono, wooden sandals]
Rules: 24-hour clock, never AM/PM. Time advances logically from the last message.
List every clothing item currently worn by both.

kind=group_open, label "╭===[format.]===╮"
<formatting>

kind=group_close, label "╰===[format.]===╯"
</formatting>
`.trim();

/**
 * Naming guidance for the three label styles the UI offers.
 * @param {'minimal'|'ornate'|'plain'} style
 */
function namingGuide(style) {
    switch (style) {
        case 'ornate':
            return 'LABELS: wrap every label as ◊►Name◄◊. Title Case inside. Keep them under 32 characters.';
        case 'plain':
            return 'LABELS: plain lowercase words, no decoration, no emoji. Group delimiters look like [format] and [/format]. Keep them under 32 characters.';
        case 'minimal':
        default:
            return [
                'LABELS: use a leading sigil that encodes the kind.',
                '  rule    -> "✒ name."        option -> "⚖ name."',
                '  feature -> "𝚿 name."        core   -> "✒ name."',
                '  group_open  -> "╭===[name.]===╮"',
                '  group_close -> "╰===[name.]===╯"',
                'Lowercase names, trailing period, under 32 characters.',
            ].join('\n');
    }
}

/** The purpose blurb steering what kind of preset gets designed. */
function purposeGuide(purpose) {
    switch (purpose) {
        case 'adventure':
            return 'PURPOSE: a game-master preset. Prioritise world simulation, consequence tracking, NPC autonomy, scene pacing, fair failure, and player agency. {{char}} is the narrator and every NPC, never the player.';
        case 'writing':
            return 'PURPOSE: a creative-writing preset. Prioritise prose craft, voice consistency, scene construction, subtext, and revision discipline. Chat roles matter less than the quality of the passage produced.';
        case 'assistant':
            return 'PURPOSE: a task/assistant preset. Prioritise accuracy, structure, refusal of invented facts, explicit reasoning discipline, output formatting, and following the user\'s instructions exactly. Do NOT add roleplay, persona-embodiment, or narrative-prose modules.';
        case 'custom':
            return 'PURPOSE: follow the user brief exactly. Do not assume roleplay conventions unless the brief asks for them.';
        case 'roleplay':
        default:
            return 'PURPOSE: a roleplay preset. Prioritise character embodiment, psychological realism, prose quality, pacing, anti-cliche discipline, and never writing for {{user}}.';
    }
}

/** Target words per module for the chosen length setting. */
export function targetWords(settings) {
    if (settings.lengthPreset === 'custom') {
        return Math.max(20, Math.min(1200, Number(settings.customWords) || 200));
    }
    return (LENGTH_PRESETS[settings.lengthPreset] ?? LENGTH_PRESETS.normal).words;
}

function lengthGuide(words) {
    const low = Math.max(15, Math.round(words * 0.7));
    const high = Math.round(words * 1.3);
    return [
        `LENGTH: aim for about ${words} words of content per module (${low}-${high} is fine).`,
        'Group delimiters and markers are exempt — they stay empty or hold a single tag.',
        'Pure setvar modules (a length choice, a language choice) are exempt too.',
        'Never pad to hit the target. If a rule is complete in three lines, leave it at three lines.',
    ].join('\n');
}

/** Which language the generated prompt text is written in. */
function languageGuide(lang) {
    return lang === 'ru'
        ? 'OUTPUT LANGUAGE: write all label text and all module content in Russian. Keep macros, tags and identifier keys in ASCII.'
        : 'OUTPUT LANGUAGE: write all label text and all module content in English.';
}

/** Shared preamble used by every stage. */
function preamble() {
    return [
        'You are PresetForge, an engine that designs SillyTavern Chat Completion presets.',
        'A preset is an ordered stack of prompt modules injected ahead of the chat.',
        'You reply with JSON only — no prose, no code fences, no commentary.',
    ].join('\n');
}

/**
 * System prompt for stage one: design the module architecture.
 * @param {object} opts
 */
export function blueprintSystemPrompt(opts) {
    const { settings, moduleCount } = opts;
    return [
        preamble(),
        '',
        'TASK: design the architecture only. Write no module content yet.',
        '',
        purposeGuide(settings.purpose),
        '',
        macroNotationNote(),
        '',
        MODULE_KINDS,
        '',
        namingGuide(settings.namingStyle),
        '',
        languageGuide(settings.promptLanguage),
        '',
        'ARCHITECTURE RULES',
        `- Design about ${moduleCount} non-marker modules. Order them the way they should be injected.`,
        '- Lead with the identity/role rule, then behavioural rules, then style rules,',
        '  then exclusive option groups, then optional features.',
        '- Every "option" module must carry a "group" name shared with its siblings.',
        '  Mark exactly one member of each group enabled:true, the rest enabled:false.',
        '- Give any group of three or more related modules a group_open/group_close pair.',
        '- Include an exclusive "length" option group controlling reply size via setvar.',
        '- Include an exclusive "language" option group when the brief implies more than one.',
        '- Include anti-pattern rules appropriate to the purpose.',
        '- Place ALL of these marker keys exactly once, as kind:"marker", near the end,',
        '  after the rule modules and before any final reasoning/prefill module:',
        `  ${RESERVED_KEYS.filter(k => !['main', 'nsfw', 'jailbreak', 'enhanceDefinitions'].includes(k)).join(', ')}.`,
        '- Include one kind:"core" module with core:"main" holding the identity rule.',
        '  Add core:"nsfw" and core:"jailbreak" modules only if the brief needs them.',
        '- "brief" must state, in one or two sentences, exactly what that module will',
        '  instruct. Be specific — it is the only thing the writing stage will see.',
        '- Keys are short ASCII snake_case and unique. Marker and core modules use their',
        '  reserved key names.',
        '',
        'OUTPUT SHAPE',
        '{',
        '  "name": "preset name, under 40 characters",',
        '  "summary": "one sentence describing the preset",',
        '  "settings": {"temperature": 0.9, "top_p": 0.95, "frequency_penalty": 0.1, "presence_penalty": 0.1, "openai_max_context": 64000, "openai_max_tokens": 2048, "squash_system_messages": true},',
        '  "modules": [',
        '    {"key": "role", "label": "✒ role.", "kind": "core", "core": "main", "enabled": true, "role": "system", "brief": "..."},',
        '    {"key": "bias_neutral", "label": "⚖ neutral.", "kind": "option", "group": "bias", "enabled": true, "role": "system", "brief": "..."},',
        '    {"key": "chatHistory", "label": "chat history", "kind": "marker", "enabled": true}',
        '  ]',
        '}',
        '',
        'Reply with that JSON object and nothing else.',
    ].join('\n');
}

/**
 * System prompt for stage two: write the content of a batch of modules.
 * @param {object} opts
 */
export function contentSystemPrompt(opts) {
    const { settings, words } = opts;
    return [
        preamble(),
        '',
        'TASK: write the finished content for the modules you are given.',
        '',
        purposeGuide(settings.purpose),
        '',
        macroNotationNote(),
        '',
        MACROS,
        '',
        STYLE_RULES,
        '',
        lengthGuide(words),
        '',
        languageGuide(settings.promptLanguage),
        '',
        EXAMPLES,
        '',
        'OUTPUT SHAPE',
        '{"modules": [{"key": "<key you were given>", "content": "<the finished prompt text>"}]}',
        '',
        'Return one entry for every key you were given, in the same order. Newlines',
        'inside content must be escaped as \\n. Reply with that JSON object and nothing else.',
    ].join('\n');
}

/**
 * System prompt for the rewrite stage.
 * @param {object} opts
 */
export function rewriteSystemPrompt(opts) {
    const { settings, words, keepNames } = opts;
    return [
        preamble(),
        '',
        'TASK: rewrite existing prompt modules against a change request.',
        '',
        macroNotationNote(),
        '',
        MACROS,
        '',
        STYLE_RULES,
        '',
        lengthGuide(words),
        '',
        languageGuide(settings.promptLanguage),
        '',
        'REWRITE RULES',
        '- Preserve each module\'s job. A pacing rule stays a pacing rule; only its',
        '  vocabulary, examples and framing move to the requested setting.',
        '- Keep every {{macro}} that still applies. Keep setvar names identical so',
        '  other modules that read them keep working. Their values may change.',
        '- Keep the original structural shape: same kind of headline, same use of',
        '  templates and examples, comparable density.',
        '- If a module is already correct for the request, return it unchanged.',
        '- Rewrite only what you are given. Never invent extra modules.',
        keepNames
            ? '- Keep labels exactly as supplied. Do not return a "label" field.'
            : '- You may return an updated "label" when the old one no longer fits.',
        '',
        'OUTPUT SHAPE',
        keepNames
            ? '{"modules": [{"key": "<key>", "content": "<rewritten text>"}]}'
            : '{"modules": [{"key": "<key>", "label": "<label>", "content": "<rewritten text>"}]}',
        '',
        'Return one entry for every key you were given, in the same order. Newlines',
        'inside content must be escaped as \\n. Reply with that JSON object and nothing else.',
    ].join('\n');
}
