/**
 * End-to-end checks over the real generation pipeline, with a mocked API.
 * Run with: node --test test/
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installMockSillyTavern, stageOf, requestedKeys } from './harness.mjs';

const REFERENCE_DIR = process.env.PF_REFERENCE_DIR ?? '';

/** A plausible blueprint response, including a deliberately malformed edge. */
function blueprintResponse() {
    return '```json\n' + JSON.stringify({
        name: 'Ashfall',
        summary: 'Grimdark low-fantasy roleplay.',
        settings: { temperature: 0.92, top_p: 0.95, openai_max_context: 60000, bogus_key: 'ignored' },
        modules: [
            { key: 'main', label: '✒ role.', kind: 'core', core: 'main', enabled: true, brief: 'identity' },
            { key: 'axioms', label: '✒ axioms.', kind: 'rule', enabled: true, brief: 'core rules' },
            { key: 'grp_open', label: '╭===[bias.]===╮', kind: 'group_open', enabled: true, brief: '' },
            { key: 'bias_neutral', label: '⚖ neutral.', kind: 'option', group: 'bias', enabled: true, brief: 'neutral bias' },
            { key: 'bias_dark', label: '⚖ dark.', kind: 'option', group: 'bias', enabled: true, brief: 'dark bias' },
            { key: 'grp_close', label: '╰===[bias.]===╯', kind: 'group_close', enabled: true, brief: '' },
            { key: 'len_long', label: '⚖ long.', kind: 'option', group: 'length', enabled: false, brief: 'long replies' },
            { key: 'len_short', label: '⚖ short.', kind: 'option', group: 'length', enabled: false, brief: 'short replies' },
            { key: 'hud', label: '𝚿 hud.', kind: 'feature', enabled: false, brief: 'status line' },
            { key: 'charDescription', label: 'char', kind: 'marker', enabled: true },
            { key: 'chatHistory', label: 'history', kind: 'marker', enabled: true },
        ],
    }) + '\n```';
}

/** Answer a content/rewrite batch with one entry per requested key. */
function contentResponse(user, prefix) {
    const keys = requestedKeys(user);
    return JSON.stringify({
        modules: keys.map(key => ({ key, content: `${prefix} ${key}\nSecond line for {{char}}.` })),
    });
}

function mockAll() {
    return installMockSillyTavern({
        respond: ({ system, user }) => {
            const stage = stageOf(system);
            if (stage === 'blueprint') return blueprintResponse();
            if (stage === 'rewrite') return contentResponse(user, 'REWRITTEN');
            return contentResponse(user, 'CONTENT FOR');
        },
    });
}

test('forgePreset builds a structurally valid preset', async () => {
    mockAll();
    const { forgePreset } = await import('../src/generator.js');
    const { getSettings } = await import('../src/settings.js');
    Object.assign(getSettings(), { batchSize: 3, moduleCount: 12 });

    const { preset, blueprint, missing } = await forgePreset({ brief: 'grimdark fantasy', presetName: '' });

    assert.equal(blueprint.name, 'Ashfall');
    assert.equal(missing, 0, 'every writable module should have content');

    // Shape matches what SillyTavern expects.
    assert.ok(Array.isArray(preset.prompts));
    assert.ok(Array.isArray(preset.prompt_order));
    assert.equal(preset.prompt_order.length, 2);
    assert.deepEqual(preset.prompt_order.map(e => e.character_id), [100000, 100001]);

    // All twelve app-owned prompts survive.
    const identifiers = new Set(preset.prompts.map(p => p.identifier));
    for (const required of ['main', 'nsfw', 'jailbreak', 'enhanceDefinitions', 'worldInfoBefore',
        'worldInfoAfter', 'charDescription', 'charPersonality', 'scenario', 'personaDescription',
        'dialogueExamples', 'chatHistory']) {
        assert.ok(identifiers.has(required), `missing app prompt: ${required}`);
    }

    // Only whitelisted sampler settings come through.
    assert.equal(preset.temperature, 0.92);
    assert.equal(preset.openai_max_context, 60000);
    assert.equal(preset.bogus_key, undefined, 'unknown settings keys must be dropped');

    // Every order entry points at a real prompt, and vice versa for markers.
    const order = preset.prompt_order.find(e => e.character_id === 100001).order;
    for (const entry of order) {
        assert.ok(identifiers.has(entry.identifier), `dangling order entry: ${entry.identifier}`);
    }
    assert.equal(new Set(order.map(e => e.identifier)).size, order.length, 'order has duplicates');

    // Markers stay empty; custom modules got prose.
    const byId = new Map(preset.prompts.map(p => [p.identifier, p]));
    assert.equal(byId.get('chatHistory').content, undefined);
    assert.ok(byId.get('main').content.startsWith('CONTENT FOR main'));

    const axioms = preset.prompts.find(p => p.name === '✒ axioms.');
    assert.ok(axioms, 'custom module should exist');
    assert.ok(axioms.content.includes('{{char}}'));
    assert.match(axioms.identifier, /^[0-9a-f-]{36}$/, 'custom modules get uuid identifiers');
});

test('exclusive option groups end up with exactly one enabled member', async () => {
    mockAll();
    const { forgePreset } = await import('../src/generator.js');
    const { preset } = await forgePreset({ brief: 'x', presetName: 'T' });

    const order = preset.prompt_order.find(e => e.character_id === 100001).order;
    const enabledByName = new Map(preset.prompts.map(p => [p.identifier, p.name]));
    const state = name => order.find(e => enabledByName.get(e.identifier) === name)?.enabled;

    // The blueprint enabled both bias options; one must have been turned off.
    assert.equal(state('⚖ neutral.'), true);
    assert.equal(state('⚖ dark.'), false);

    // The blueprint enabled neither length option; the first must be on.
    assert.equal(state('⚖ long.'), true);
    assert.equal(state('⚖ short.'), false);
});

test('rewrite touches only the selected modules', async () => {
    mockAll();
    const { forgePreset, rewriteModules } = await import('../src/generator.js');
    const { listModules } = await import('../src/schema.js');

    const { preset } = await forgePreset({ brief: 'x', presetName: 'T' });
    const modules = listModules(preset).filter(m => !m.marker && m.content.trim());
    const chosen = modules.slice(0, 2);
    const untouched = modules.slice(2);
    const before = new Map(preset.prompts.map(p => [p.identifier, p.content]));

    const result = await rewriteModules({
        preset,
        modules: chosen,
        brief: 'move it to hard sci-fi',
        keepNames: true,
    });

    assert.equal(result.applied, chosen.length);
    assert.equal(result.empty, 0);

    const after = new Map(result.preset.prompts.map(p => [p.identifier, p.content]));
    for (const module of chosen) {
        assert.ok(after.get(module.identifier).startsWith('REWRITTEN'), `${module.name} should be rewritten`);
    }
    for (const module of untouched) {
        assert.equal(after.get(module.identifier), before.get(module.identifier), `${module.name} must be untouched`);
    }

    // The original object is not mutated.
    assert.equal(preset.prompts.find(p => p.identifier === chosen[0].identifier).content,
        before.get(chosen[0].identifier), 'rewrite must work on a copy');
});

test('keepNames=false lets labels change, keepNames=true does not', async () => {
    installMockSillyTavern({
        respond: ({ system, user }) => {
            if (stageOf(system) === 'blueprint') return blueprintResponse();
            const keys = requestedKeys(user);
            return JSON.stringify({
                modules: keys.map(key => ({ key, label: `NEW ${key}`, content: `body ${key}` })),
            });
        },
    });
    const { forgePreset, rewriteModules } = await import('../src/generator.js');
    const { listModules } = await import('../src/schema.js');

    const { preset } = await forgePreset({ brief: 'x', presetName: 'T' });
    const target = listModules(preset).filter(m => !m.marker && m.content.trim()).slice(0, 1);
    const originalName = target[0].name;

    const kept = await rewriteModules({ preset, modules: target, brief: 'b', keepNames: true });
    assert.equal(kept.preset.prompts.find(p => p.identifier === target[0].identifier).name, originalName);

    const renamed = await rewriteModules({ preset, modules: target, brief: 'b', keepNames: false });
    assert.equal(renamed.preset.prompts.find(p => p.identifier === target[0].identifier).name, `NEW ${target[0].identifier}`);
});

test('a batch that returns garbage costs only its own modules', async () => {
    let batch = 0;
    installMockSillyTavern({
        respond: ({ system, user }) => {
            if (stageOf(system) === 'blueprint') return blueprintResponse();
            batch++;
            // Poison the second batch.
            if (batch === 2) return 'I cannot help with that request.';
            return contentResponse(user, 'OK');
        },
    });
    const { forgePreset } = await import('../src/generator.js');
    const { getSettings } = await import('../src/settings.js');
    Object.assign(getSettings(), { batchSize: 2 });

    const { preset, missing } = await forgePreset({ brief: 'x', presetName: 'T' });
    assert.ok(missing > 0, 'the poisoned batch should be reported as missing');
    assert.ok(missing <= 2, 'only the poisoned batch should be lost');
    // The preset is still valid and saveable.
    assert.ok(preset.prompts.length > 12);
    assert.equal(preset.prompt_order.length, 2);
});

test('blueprint normalisation survives a hostile response', async () => {
    mockAll();
    const { normaliseBlueprint } = await import('../src/generator.js');

    const blueprint = normaliseBlueprint({
        modules: [
            { key: 'a b/c!', kind: 'nonsense', label: 'x' },
            { key: 'a b/c!', kind: 'rule', label: 'duplicate key' },
            null,
            'garbage',
            { kind: 'rule' },
        ],
    });

    assert.equal(blueprint.name, 'Forged Preset');
    const keys = blueprint.modules.map(m => m.key);
    assert.equal(new Set(keys).size, keys.length, 'keys must be unique');
    assert.ok(keys.every(k => /^[\w.-]+$/.test(k)), 'keys must be sanitised');
    assert.equal(blueprint.modules.find(m => m.key === 'a_b_c_').kind, 'rule', 'unknown kinds fall back to rule');
    // All eight markers get appended even though none were supplied.
    for (const marker of ['worldInfoBefore', 'worldInfoAfter', 'charDescription', 'charPersonality',
        'scenario', 'personaDescription', 'dialogueExamples', 'chatHistory']) {
        assert.ok(blueprint.modules.some(m => m.key === marker), `marker ${marker} should be added`);
    }
});

test('abort stops the run', async () => {
    mockAll();
    const { forgePreset } = await import('../src/generator.js');
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
        () => forgePreset({ brief: 'x', presetName: 'T', signal: controller.signal }),
        err => err.name === 'AbortError',
    );
});

/* The reference presets are the contract: whatever we emit must round-trip
   through the same code paths they do. */
test('real presets round-trip through listModules and normalisePreset', async (t) => {
    if (!REFERENCE_DIR || !fs.existsSync(REFERENCE_DIR)) {
        return t.skip('PF_REFERENCE_DIR not set');
    }
    mockAll();
    const { listModules, normalisePreset, isChatCompletionPreset, setEnabled } = await import('../src/schema.js');

    const files = fs.readdirSync(REFERENCE_DIR).filter(f => f.endsWith('.json'));
    assert.ok(files.length, 'expected reference presets');

    for (const file of files) {
        const original = JSON.parse(fs.readFileSync(`${REFERENCE_DIR}/${file}`, 'utf8'));
        assert.ok(isChatCompletionPreset(original), `${file} should be recognised`);

        const modules = listModules(original);
        assert.ok(modules.length > 10, `${file}: expected a real module list`);
        assert.ok(modules.some(m => m.marker), `${file}: markers should be flagged`);
        assert.ok(modules.some(m => m.reserved), `${file}: reserved prompts should be flagged`);

        const copy = structuredClone(original);
        const normalised = normalisePreset(copy);

        // Normalising must not drop or reorder anything in a valid preset.
        assert.equal(normalised.prompts.length, original.prompts.length, `${file}: prompt count changed`);
        const originalOrder = original.prompt_order.find(e => e.character_id === 100001).order;
        const newOrder = normalised.prompt_order.find(e => e.character_id === 100001).order;
        assert.deepEqual(
            newOrder.map(e => e.identifier),
            originalOrder.map(e => e.identifier),
            `${file}: order changed`,
        );
        assert.deepEqual(
            newOrder.map(e => e.enabled !== false),
            originalOrder.map(e => e.enabled !== false),
            `${file}: enabled flags changed`,
        );

        // Toggling a module is reflected in the order, not the prompt body.
        const toggleable = modules.find(m => !m.marker && !m.reserved);
        setEnabled(normalised, toggleable.identifier, !toggleable.enabled);
        const entry = newOrder.find(e => e.identifier === toggleable.identifier);
        assert.equal(entry.enabled, !toggleable.enabled, `${file}: toggle did not stick`);
    }
});

test('rewriting a real preset preserves every unselected module verbatim', async (t) => {
    if (!REFERENCE_DIR || !fs.existsSync(REFERENCE_DIR)) {
        return t.skip('PF_REFERENCE_DIR not set');
    }
    installMockSillyTavern({
        respond: ({ user }) => contentResponse(user, 'REWRITTEN'),
    });
    const { rewriteModules } = await import('../src/generator.js');
    const { listModules } = await import('../src/schema.js');
    const { getSettings } = await import('../src/settings.js');
    Object.assign(getSettings(), { batchSize: 5 });

    const file = fs.readdirSync(REFERENCE_DIR).filter(f => f.endsWith('.json'))[0];
    const original = JSON.parse(fs.readFileSync(`${REFERENCE_DIR}/${file}`, 'utf8'));

    const modules = listModules(original).filter(m => !m.marker && m.content.trim());
    const chosen = modules.filter((_, i) => i % 7 === 0);

    const { preset, applied } = await rewriteModules({
        preset: original, modules: chosen, brief: 'sci-fi reskin', keepNames: true,
    });

    assert.equal(applied, chosen.length);

    const chosenIds = new Set(chosen.map(m => m.identifier));
    const before = new Map(original.prompts.map(p => [p.identifier, p.content]));
    let untouchedChecked = 0;
    for (const prompt of preset.prompts) {
        if (chosenIds.has(prompt.identifier)) {
            assert.ok(prompt.content.startsWith('REWRITTEN'));
        } else if (before.has(prompt.identifier)) {
            assert.equal(prompt.content, before.get(prompt.identifier), `${prompt.name} must be untouched`);
            untouchedChecked++;
        }
    }
    assert.ok(untouchedChecked > 50, 'expected many untouched modules');
});

test('generated presets are shape-identical to real ones', async (t) => {
    if (!REFERENCE_DIR || !fs.existsSync(REFERENCE_DIR)) {
        return t.skip('PF_REFERENCE_DIR not set');
    }
    mockAll();
    const { forgePreset } = await import('../src/generator.js');
    const { preset } = await forgePreset({ brief: 'x', presetName: 'Shape' });

    const file = fs.readdirSync(REFERENCE_DIR).filter(f => f.endsWith('.json'))[0];
    const reference = JSON.parse(fs.readFileSync(`${REFERENCE_DIR}/${file}`, 'utf8'));

    // Top-level keys must match, or SillyTavern silently falls back to defaults
    // for whatever we left out.
    const missing = Object.keys(reference).filter(k => !Object.hasOwn(preset, k));
    assert.deepEqual(missing, [], 'generated preset is missing top-level keys');

    // Every prompt we emit must use a field layout real presets also use.
    const shape = p => Object.keys(p).sort().join(',');
    const known = new Set(reference.prompts.map(shape));
    const unknown = [...new Set(preset.prompts.map(shape))].filter(s => !known.has(s));
    assert.deepEqual(unknown, [], 'generated prompts use unknown field layouts');

    // The result must survive a JSON round trip unchanged — it is written to disk.
    assert.deepEqual(JSON.parse(JSON.stringify(preset)), preset);
});

test('no raw macro ever reaches the API, and macros survive the round trip', async () => {
    const sent = [];
    installMockSillyTavern({
        respond: ({ system, user }) => {
            sent.push(system, user);
            if (stageOf(system) === 'blueprint') return blueprintResponse();
            // Answer in the shielded notation, as the model is told to.
            return JSON.stringify({
                modules: requestedKeys(user).map(key => ({
                    key,
                    content: `Rule for {%char%}.\n{%setvar::check::did {%user%} act?%}{%trim%}`,
                })),
            });
        },
    });
    const { forgePreset } = await import('../src/generator.js');
    const { preset } = await forgePreset({ brief: 'brief mentioning {{char}} directly', presetName: 'M' });

    // SillyTavern would expand or execute any of these on the way out.
    for (const text of sent) {
        assert.ok(!text.includes('{{'), 'a raw {{ macro was sent to the API');
        assert.ok(!text.includes('}}'), 'a raw }} macro was sent to the API');
    }

    // ...but the saved preset must contain real macros.
    const written = preset.prompts.find(p => p.identifier === 'main');
    assert.ok(written.content.includes('{{char}}'), 'macros were not restored');
    assert.ok(written.content.includes('{{setvar::check::did {{user}} act?}}{{trim}}'),
        'nested macros were not restored intact');
    assert.ok(!written.content.includes('{%'), 'shielded delimiters leaked into the preset');
});

test('rewriting a real preset does not leak its macros to the API', async (t) => {
    if (!REFERENCE_DIR || !fs.existsSync(REFERENCE_DIR)) {
        return t.skip('PF_REFERENCE_DIR not set');
    }
    const sent = [];
    installMockSillyTavern({
        respond: ({ system, user }) => {
            sent.push(system, user);
            return JSON.stringify({
                modules: requestedKeys(user).map(key => ({ key, content: 'New body for {%char%}.' })),
            });
        },
    });
    const { rewriteModules } = await import('../src/generator.js');
    const { listModules } = await import('../src/schema.js');

    const file = fs.readdirSync(REFERENCE_DIR).filter(f => f.endsWith('.json'))[0];
    const original = JSON.parse(fs.readFileSync(`${REFERENCE_DIR}/${file}`, 'utf8'));
    const modules = listModules(original).filter(m => !m.marker && m.content.includes('{{')).slice(0, 6);
    assert.ok(modules.length, 'expected reference modules containing macros');

    const { preset } = await rewriteModules({
        preset: original, modules, brief: 'sci-fi', keepNames: true,
    });

    for (const text of sent) {
        assert.ok(!text.includes('{{'), 'a preset macro leaked to the API unshielded');
    }
    const rewritten = preset.prompts.find(p => p.identifier === modules[0].identifier);
    assert.equal(rewritten.content, 'New body for {{char}}.');
});
