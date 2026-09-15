/**
 * The PresetForge panel: four tabs over a single piece of state.
 *
 * On a phone it is a full-height sheet; on a desktop it is a floating window
 * that can be dragged by its header. Both use the same markup.
 */

import { el, field, select, checkbox, clear, toast, confirm } from './dom.js';
import { t, LANGUAGES, setLanguage } from './../i18n.js';
import { getSettings, updateSettings, resetSettings } from './../settings.js';
import { listProfiles, isConnectionManagerAvailable } from './../backend.js';
import { forgePreset, rewriteModules } from './../generator.js';
import { listModules, addModule, removeModule, setEnabled } from './../schema.js';
import {
    listPresetNames, loadPreset, savePreset, presetExists,
    downloadPreset, pickPresetFile,
} from './../presetio.js';
import { setAnvilVisible, resetAnvilPosition, setAnvilBusy } from './anvil.js';
import { LENGTH_PRESETS } from './../constants.js';

/** Panel-local state. Survives closing the panel, resets on reload. */
const state = {
    tab: 'create',
    brief: '',
    presetName: '',
    /** The preset currently being worked on, if any. */
    preset: null,
    presetLabel: '',
    /** identifiers selected for rewriting */
    selection: new Set(),
    rewriteBrief: '',
    rewriteScope: 'selected',
    keepNames: true,
    saveAs: '',
    filter: '',
    busy: false,
    controller: null,
};

let root = null;
let bodyNode = null;

/* ------------------------------------------------------------------ *
 * Shell
 * ------------------------------------------------------------------ */

export function isOpen() {
    return !!root && root.classList.contains('pf-panel--open');
}

export function togglePanel() {
    isOpen() ? closePanel() : openPanel();
}

export function openPanel() {
    if (!root) mount();
    root.classList.add('pf-panel--open');
    root.setAttribute('aria-hidden', 'false');
    render();
}

export function closePanel() {
    if (!root) return;
    root.classList.remove('pf-panel--open');
    root.setAttribute('aria-hidden', 'true');
}

function mount() {
    root = el('div', { id: 'pf-panel', class: 'pf-panel', role: 'dialog', 'aria-modal': 'false', 'aria-hidden': 'true' });

    const header = el('header', { class: 'pf-panel__header' }, [
        el('div', { class: 'pf-panel__title' }, [
            el('span', { class: 'pf-panel__name', text: t('appName') }),
            el('small', { class: 'pf-panel__tagline', text: t('tagline') }),
        ]),
        el('button', {
            class: 'pf-iconbtn', type: 'button', title: t('close'),
            'aria-label': t('close'), onClick: closePanel, html: '&times;',
        }),
    ]);

    makeDraggable(root, header);

    bodyNode = el('div', { class: 'pf-panel__body' });
    root.append(header, tabBar(), bodyNode);
    document.body.append(root);

    // Close on Escape, but never while a generation is running.
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && isOpen() && !state.busy) closePanel();
    });

    // A panel dragged on a wide screen must not keep those coordinates once the
    // window narrows and it becomes a bottom sheet.
    window.addEventListener('resize', () => {
        if (window.innerWidth > 720 || !root?.classList.contains('pf-panel--placed')) return;
        root.classList.remove('pf-panel--placed');
        for (const side of ['left', 'top', 'right', 'bottom']) root.style[side] = '';
    });
}

function tabBar() {
    const bar = el('nav', { class: 'pf-tabs', role: 'tablist' });
    const tabs = [
        ['create', 'tabCreate'],
        ['rewrite', 'tabRewrite'],
        ['modules', 'tabModules'],
        ['settings', 'tabSettings'],
    ];
    for (const [id, key] of tabs) {
        bar.append(el('button', {
            class: 'pf-tab', type: 'button', role: 'tab', dataset: { tab: id },
            text: t(key),
            onClick: () => { state.tab = id; render(); },
        }));
    }
    return bar;
}

/** Drag the panel by its header on pointer devices. */
function makeDraggable(panel, handle) {
    const start = event => {
        // Buttons inside the header keep their own behaviour, and on narrow
        // screens the panel is a fixed sheet that should not move.
        if (event.button !== 0) return;
        if (event.target.closest('button') || window.innerWidth <= 720) return;

        const rect = panel.getBoundingClientRect();
        const offsetX = event.clientX - rect.left;
        const offsetY = event.clientY - rect.top;

        // Pin the card to where it currently is, in plain viewport pixels, and
        // drop the anchor offset the stylesheet applies.
        panel.classList.add('pf-panel--dragging', 'pf-panel--placed');
        panel.style.left = `${rect.left}px`;
        panel.style.top = `${rect.top}px`;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        try {
            handle.setPointerCapture(event.pointerId);
        } catch {
            // Capture is a nicety; the listeners below still work without it.
        }

        const move = moveEvent => {
            if (moveEvent.pointerId !== event.pointerId) return;
            if (moveEvent.cancelable) moveEvent.preventDefault();
            const x = Math.min(Math.max(moveEvent.clientX - offsetX, 0), window.innerWidth - rect.width);
            const y = Math.min(Math.max(moveEvent.clientY - offsetY, 0), window.innerHeight - 60);
            panel.style.left = `${x}px`;
            panel.style.top = `${y}px`;
        };
        const end = endEvent => {
            if (endEvent.pointerId !== event.pointerId) return;
            panel.classList.remove('pf-panel--dragging');
            handle.removeEventListener('pointermove', move);
            handle.removeEventListener('pointerup', end);
            handle.removeEventListener('pointercancel', end);
            try {
                handle.releasePointerCapture(event.pointerId);
            } catch {
                // Already released, or never captured.
            }
        };
        handle.addEventListener('pointermove', move, { passive: false });
        handle.addEventListener('pointerup', end);
        handle.addEventListener('pointercancel', end);
    };

    // One pointer stream only: listening for mouse and touch separately runs
    // the same gesture twice on touch-capable machines.
    handle.addEventListener('pointerdown', start);
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

function render() {
    if (!root) return;
    for (const tab of root.querySelectorAll('.pf-tab')) {
        tab.classList.toggle('pf-tab--active', tab.dataset.tab === state.tab);
        tab.setAttribute('aria-selected', String(tab.dataset.tab === state.tab));
    }
    clear(bodyNode);
    const view = {
        create: renderCreate,
        rewrite: renderRewrite,
        modules: renderModules,
        settings: renderSettings,
    }[state.tab] ?? renderCreate;

    bodyNode.append(view());
    bodyNode.scrollTop = 0;
}

/** Re-render after a language change, rebuilding the static chrome too. */
function rerenderAll() {
    if (!root) return;
    const wasOpen = isOpen();
    root.remove();
    root = null;
    bodyNode = null;
    mount();
    if (wasOpen) openPanel();
    else render();
}

/* ------------------------------------------------------------------ *
 * Create tab
 * ------------------------------------------------------------------ */

function renderCreate() {
    const settings = getSettings();
    const page = el('div', { class: 'pf-page' });

    const brief = el('textarea', {
        class: 'pf-input pf-textarea', rows: 6,
        placeholder: t('briefPlaceholder'), value: state.brief,
    });
    brief.addEventListener('input', () => { state.brief = brief.value; });

    const name = el('input', {
        class: 'pf-input', type: 'text',
        placeholder: t('presetNamePlaceholder'), value: state.presetName,
    });
    name.addEventListener('input', () => { state.presetName = name.value; });

    const count = el('input', {
        class: 'pf-input pf-input--number', type: 'number', min: 6, max: 80, step: 1,
        value: settings.moduleCount,
    });
    count.addEventListener('change', () => updateSettings({ moduleCount: Number(count.value) || 24 }));

    page.append(
        field(t('briefLabel'), brief),
        field(t('presetNameLabel'), name),
        el('div', { class: 'pf-grid' }, [
            field(t('purposeLabel'), select([
                { value: 'roleplay', label: t('purposeRoleplay') },
                { value: 'adventure', label: t('purposeAdventure') },
                { value: 'writing', label: t('purposeWriting') },
                { value: 'assistant', label: t('purposeAssistant') },
                { value: 'custom', label: t('purposeCustom') },
            ], settings.purpose, value => updateSettings({ purpose: value }))),
            field(t('moduleCountLabel'), count, t('moduleCountHint')),
            field(t('namingLabel'), select([
                { value: 'minimal', label: t('namingMinimal') },
                { value: 'ornate', label: t('namingOrnate') },
                { value: 'plain', label: t('namingPlain') },
            ], settings.namingStyle, value => updateSettings({ namingStyle: value }))),
            field(t('langOfPresetLabel'), select(
                LANGUAGES.map(l => ({ value: l.id, label: l.label })),
                settings.promptLanguage,
                value => updateSettings({ promptLanguage: value }),
            )),
        ]),
        lengthControls(),
        actionRow(t('generate'), runForge),
    );
    return page;
}

/** Length preset plus the custom word count, shared by both generating tabs. */
function lengthControls() {
    const settings = getSettings();
    const wrap = el('div', { class: 'pf-grid' });

    const custom = el('input', {
        class: 'pf-input pf-input--number', type: 'number', min: 20, max: 1200, step: 10,
        value: settings.customWords, disabled: settings.lengthPreset !== 'custom',
    });
    custom.addEventListener('change', () => updateSettings({ customWords: Number(custom.value) || 200 }));

    const preset = select([
        { value: 'compact', label: `${t('lengthCompact')} · ${LENGTH_PRESETS.compact.words}` },
        { value: 'normal', label: `${t('lengthNormal')} · ${LENGTH_PRESETS.normal.words}` },
        { value: 'detailed', label: `${t('lengthDetailed')} · ${LENGTH_PRESETS.detailed.words}` },
        { value: 'extensive', label: `${t('lengthExtensive')} · ${LENGTH_PRESETS.extensive.words}` },
        { value: 'custom', label: t('lengthCustom') },
    ], settings.lengthPreset, value => {
        updateSettings({ lengthPreset: value });
        custom.disabled = value !== 'custom';
    });

    wrap.append(
        field(t('lengthLabel'), preset),
        field(t('customWordsLabel'), custom),
    );
    return wrap;
}

/* ------------------------------------------------------------------ *
 * Rewrite tab
 * ------------------------------------------------------------------ */

function renderRewrite() {
    const page = el('div', { class: 'pf-page' });
    const names = listPresetNames();

    const fromList = select(
        [{ value: '', label: t('pickPreset') }, ...names.map(n => ({ value: n, label: n }))],
        '',
        value => {
            if (!value) return;
            const preset = loadPreset(value);
            if (!preset) return toast('error', t('errBadFile'));
            adoptPreset(preset, value);
        },
    );

    const fromFile = el('button', {
        class: 'pf-btn pf-btn--ghost', type: 'button', text: t('loadFile'),
        onClick: async () => {
            try {
                const result = await pickPresetFile();
                if (result) adoptPreset(result.preset, result.name);
            } catch (error) {
                toast('error', error.message);
            }
        },
    });

    page.append(
        el('div', { class: 'pf-grid' }, [
            field(t('sourceFromList'), fromList),
            field(t('sourceFromFile'), fromFile),
        ]),
    );

    if (state.preset) {
        const modules = listModules(state.preset).filter(m => !m.marker);
        page.append(el('p', {
            class: 'pf-note',
            text: t('loadedFrom', { name: state.presetLabel, count: modules.length }),
        }));
    }

    const brief = el('textarea', {
        class: 'pf-input pf-textarea', rows: 5,
        placeholder: t('rewriteBriefPlaceholder'), value: state.rewriteBrief,
    });
    brief.addEventListener('input', () => { state.rewriteBrief = brief.value; });

    const saveAs = el('input', {
        class: 'pf-input', type: 'text', placeholder: t('saveAsHint'), value: state.saveAs,
    });
    saveAs.addEventListener('input', () => { state.saveAs = saveAs.value; });

    page.append(
        field(t('rewriteBriefLabel'), brief),
        el('div', { class: 'pf-grid' }, [
            field(t('rewriteScopeLabel'), select([
                { value: 'selected', label: t('scopeSelected') },
                { value: 'enabled', label: t('scopeEnabled') },
                { value: 'all', label: t('scopeAll') },
            ], state.rewriteScope, value => { state.rewriteScope = value; render(); })),
            field(t('saveAsLabel'), saveAs),
        ]),
        checkbox(t('keepNamesLabel'), state.keepNames, value => { state.keepNames = value; }, t('keepNamesHint')),
        lengthControls(),
    );

    if (state.rewriteScope === 'selected' && state.preset) {
        page.append(el('p', {
            class: 'pf-note',
            text: `${t('selectedCount', { n: state.selection.size })} — ${t('tabModules')}`,
        }));
    }

    page.append(actionRow(t('rewriteGo'), runRewrite));
    return page;
}

/** Take ownership of a loaded preset and jump to its module list. */
function adoptPreset(preset, label) {
    state.preset = preset;
    state.presetLabel = label;
    state.selection = new Set();
    state.saveAs = '';
    state.filter = '';
    render();
}

/* ------------------------------------------------------------------ *
 * Modules tab
 * ------------------------------------------------------------------ */

function renderModules() {
    const page = el('div', { class: 'pf-page' });

    if (!state.preset) {
        page.append(el('p', { class: 'pf-empty', text: t('modulesEmpty') }));
        return page;
    }

    // Always read the module list back off the preset: toggling or editing a
    // module changes the preset, and a cached list would go stale.
    const selectable = () => listModules(state.preset).filter(m => !m.marker);
    const visible = () => {
        const needle = state.filter.trim().toLowerCase();
        if (!needle) return selectable();
        return selectable().filter(m =>
            m.name.toLowerCase().includes(needle) || m.content.toLowerCase().includes(needle));
    };

    const search = el('input', {
        class: 'pf-input', type: 'search', placeholder: t('searchPlaceholder'), value: state.filter,
    });
    search.addEventListener('input', () => {
        state.filter = search.value;
        renderList();
    });

    const bulk = el('div', { class: 'pf-bulk' }, [
        el('button', { class: 'pf-chip', type: 'button', text: t('selectAll'),
            onClick: () => { state.selection = new Set(selectable().map(m => m.identifier)); renderList(); } }),
        el('button', { class: 'pf-chip', type: 'button', text: t('selectEnabled'),
            onClick: () => { state.selection = new Set(selectable().filter(m => m.enabled).map(m => m.identifier)); renderList(); } }),
        el('button', { class: 'pf-chip', type: 'button', text: t('invert'),
            onClick: () => {
                const next = new Set();
                for (const module of selectable()) {
                    if (!state.selection.has(module.identifier)) next.add(module.identifier);
                }
                state.selection = next;
                renderList();
            } }),
        el('button', { class: 'pf-chip', type: 'button', text: t('selectNone'),
            onClick: () => { state.selection = new Set(); renderList(); } }),
        el('button', { class: 'pf-chip pf-chip--accent', type: 'button', text: t('addModule'),
            onClick: () => openModuleEditor(null, renderList) }),
    ]);

    const counter = el('p', { class: 'pf-note', text: t('selectedCount', { n: state.selection.size }) });
    const list = el('div', { class: 'pf-modules' });

    function renderList() {
        counter.textContent = t('selectedCount', { n: state.selection.size });
        clear(list);
        const rows = visible();
        for (const module of rows) list.append(moduleRow(module, renderList));
        if (!rows.length) list.append(el('p', { class: 'pf-empty', text: '—' }));
    }

    renderList();

    page.append(search, bulk, counter, list, actionRow(t('saveToST'), saveCurrentPreset, t('exportJson'), () => {
        downloadPreset(state.saveAs || state.presetLabel || 'preset', state.preset);
    }));
    return page;
}

function moduleRow(module, refresh) {
    const check = el('input', {
        type: 'checkbox', class: 'pf-checkbox',
        checked: state.selection.has(module.identifier),
    });
    check.addEventListener('change', () => {
        check.checked ? state.selection.add(module.identifier) : state.selection.delete(module.identifier);
        refresh();
    });

    const power = el('button', {
        class: `pf-power ${module.enabled ? 'pf-power--on' : ''}`,
        type: 'button',
        title: t('enabledLabel'),
        'aria-pressed': String(module.enabled),
        text: module.enabled ? '●' : '○',
    });
    power.addEventListener('click', () => {
        setEnabled(state.preset, module.identifier, !module.enabled);
        refresh();
    });

    const preview = module.content.replace(/\s+/g, ' ').trim().slice(0, 130);

    return el('div', { class: `pf-module ${module.enabled ? '' : 'pf-module--off'}` }, [
        check,
        power,
        el('div', { class: 'pf-module__text', onClick: () => openModuleEditor(module, refresh) }, [
            el('span', { class: 'pf-module__name', text: module.name || '—' }),
            el('small', { class: 'pf-module__preview', text: preview || (module.reserved ? 'SillyTavern prompt' : '') }),
        ]),
        el('div', { class: 'pf-module__actions' }, [
            el('button', { class: 'pf-iconbtn pf-iconbtn--sm', type: 'button', title: t('editModule'),
                html: '&#9998;', onClick: () => openModuleEditor(module, refresh) }),
            module.reserved ? null : el('button', {
                class: 'pf-iconbtn pf-iconbtn--sm pf-iconbtn--danger', type: 'button', title: t('deleteModule'),
                html: '&#10005;',
                onClick: async () => {
                    if (!await confirm(t('confirmDelete', { name: module.name }))) return;
                    removeModule(state.preset, module.identifier);
                    state.selection.delete(module.identifier);
                    refresh();
                },
            }),
        ]),
    ]);
}

/** Inline editor for one module; `module` null means "create a new one". */
function openModuleEditor(module, onSaved = render) {
    const isNew = !module;
    const overlay = el('div', { class: 'pf-modal' });

    const name = el('input', { class: 'pf-input', type: 'text', value: module?.name ?? '' });
    const content = el('textarea', { class: 'pf-input pf-textarea', rows: 12, value: module?.content ?? '' });
    const role = select([
        { value: 'system', label: t('roleSystem') },
        { value: 'user', label: t('roleUser') },
        { value: 'assistant', label: t('roleAssistant') },
    ], module?.role ?? 'system', () => {});
    const enabled = el('input', { type: 'checkbox', class: 'pf-checkbox', checked: module?.enabled ?? true });

    const close = () => overlay.remove();

    const card = el('div', { class: 'pf-modal__card' }, [
        el('header', { class: 'pf-modal__header' }, [
            el('span', { text: isNew ? t('addModule') : t('editModule') }),
            el('button', { class: 'pf-iconbtn', type: 'button', html: '&times;', onClick: close, 'aria-label': t('close') }),
        ]),
        el('div', { class: 'pf-modal__body' }, [
            field(t('moduleName'), name),
            el('div', { class: 'pf-grid' }, [
                field(t('moduleRole'), role),
                el('label', { class: 'pf-check' }, [enabled, el('span', { class: 'pf-check__label', text: t('enabledLabel') })]),
            ]),
            field(t('moduleContent'), content),
        ]),
        el('footer', { class: 'pf-modal__footer' }, [
            el('button', { class: 'pf-btn pf-btn--ghost', type: 'button', text: t('cancel'), onClick: close }),
            el('button', { class: 'pf-btn', type: 'button', text: t('save'), onClick: () => {
                if (isNew) {
                    addModule(state.preset, {
                        name: name.value.trim() || 'New module',
                        role: role.value,
                        content: content.value,
                        enabled: enabled.checked,
                    });
                } else {
                    const prompt = state.preset.prompts.find(p => p.identifier === module.identifier);
                    if (prompt) {
                        prompt.name = name.value.trim() || prompt.name;
                        prompt.content = content.value;
                        // Markers never carry a role of their own.
                        if (!prompt.marker) prompt.role = role.value;
                    }
                    setEnabled(state.preset, module.identifier, enabled.checked);
                }
                close();
                onSaved?.();
            } }),
        ]),
    ]);

    overlay.append(card);
    overlay.addEventListener('mousedown', event => { if (event.target === overlay) close(); });
    root.append(overlay);
    requestAnimationFrame(() => overlay.classList.add('pf-modal--open'));
    name.focus();
}

/* ------------------------------------------------------------------ *
 * Settings tab
 * ------------------------------------------------------------------ */

function renderSettings() {
    const settings = getSettings();
    const page = el('div', { class: 'pf-page' });

    const profiles = listProfiles();
    const cmAvailable = isConnectionManagerAvailable();

    const profileSelect = select(
        [{ value: '', label: t('pickProfile') }, ...profiles.map(p => ({ value: p.id, label: p.name }))],
        settings.profileId,
        value => updateSettings({ profileId: value }),
        { disabled: !cmAvailable || settings.apiSource !== 'profile' },
    );

    const apiSelect = select([
        { value: 'main', label: t('apiMain') },
        { value: 'profile', label: t('apiProfile') },
    ], settings.apiSource, value => {
        updateSettings({ apiSource: value });
        render();
    });

    const maxTokens = el('input', {
        class: 'pf-input pf-input--number', type: 'number', min: 512, max: 32000, step: 256,
        value: settings.maxTokens,
    });
    maxTokens.addEventListener('change', () => updateSettings({ maxTokens: Number(maxTokens.value) || 4096 }));

    const batch = el('input', {
        class: 'pf-input pf-input--number', type: 'number', min: 1, max: 12, step: 1,
        value: settings.batchSize,
    });
    batch.addEventListener('change', () => updateSettings({ batchSize: Number(batch.value) || 4 }));

    const temperature = el('input', {
        class: 'pf-input pf-input--number', type: 'number', min: 0, max: 2, step: 0.05,
        value: settings.temperature ?? '', placeholder: t('temperatureAuto'),
    });
    temperature.addEventListener('change', () => {
        const raw = temperature.value.trim();
        updateSettings({ temperature: raw === '' ? null : Number(raw) });
    });

    page.append(
        field(t('uiLanguage'), select(
            LANGUAGES.map(l => ({ value: l.id, label: l.label })),
            settings.uiLanguage,
            value => {
                updateSettings({ uiLanguage: value });
                setLanguage(value);
                rerenderAll();
            },
        )),
        el('hr', { class: 'pf-rule' }),
        field(t('apiSource'), apiSelect),
        field(t('profileLabel'), profileSelect, cmAvailable ? undefined : t('profileMissing')),
        el('div', { class: 'pf-grid' }, [
            field(t('maxTokensLabel'), maxTokens),
            field(t('batchLabel'), batch, t('batchHint')),
            field(t('temperatureLabel'), temperature),
        ]),
        el('hr', { class: 'pf-rule' }),
        lengthControls(),
        el('hr', { class: 'pf-rule' }),
        checkbox(t('autoSaveLabel'), settings.autoSave, value => updateSettings({ autoSave: value }), t('autoSaveHint')),
        checkbox(t('showButtonLabel'), settings.buttonVisible, value => {
            updateSettings({ buttonVisible: value });
            setAnvilVisible(value);
        }),
        el('div', { class: 'pf-bulk' }, [
            el('button', { class: 'pf-chip', type: 'button', text: t('resetButtonPos'), onClick: () => {
                resetAnvilPosition();
                toast('success', t('done'));
            } }),
            el('button', { class: 'pf-chip pf-chip--danger', type: 'button', text: t('resetSettings'), onClick: async () => {
                if (!await confirm(t('resetSettings') + '?')) return;
                resetSettings();
                setAnvilVisible(true);
                resetAnvilPosition();
                rerenderAll();
            } }),
        ]),
    );
    return page;
}

/* ------------------------------------------------------------------ *
 * Actions and progress
 * ------------------------------------------------------------------ */

function actionRow(primaryLabel, primaryAction, secondaryLabel, secondaryAction) {
    const progress = el('div', { class: 'pf-progress', hidden: true }, [
        el('div', { class: 'pf-progress__bar' }, [el('span', { class: 'pf-progress__fill' })]),
        el('small', { class: 'pf-progress__text' }),
    ]);

    const stop = el('button', {
        class: 'pf-btn pf-btn--ghost pf-btn--danger', type: 'button', text: t('abort'), hidden: true,
        onClick: () => state.controller?.abort(),
    });

    const primary = el('button', {
        class: 'pf-btn pf-btn--primary', type: 'button', text: primaryLabel,
        onClick: () => primaryAction({ progress, stop, primary }),
    });

    const row = el('div', { class: 'pf-actions' }, [
        secondaryLabel ? el('button', { class: 'pf-btn pf-btn--ghost', type: 'button', text: secondaryLabel, onClick: secondaryAction }) : null,
        primary,
        stop,
    ]);

    return el('div', {}, [progress, row]);
}

/** Wire a generation run to the progress bar and the busy flags. */
function makeProgressHandler(ui) {
    const fill = ui.progress.querySelector('.pf-progress__fill');
    const text = ui.progress.querySelector('.pf-progress__text');

    return info => {
        ui.progress.hidden = false;
        if (info.phase === 'blueprint') {
            fill.style.width = '8%';
            text.textContent = t('phaseBlueprint');
            return;
        }
        if (info.phase === 'assemble') {
            fill.style.width = '100%';
            text.textContent = t('phaseAssemble');
            return;
        }
        const ratio = info.total ? info.done / info.total : 0;
        fill.style.width = `${Math.round(10 + ratio * 88)}%`;
        text.textContent = t(info.phase === 'rewrite' ? 'phaseRewrite' : 'phaseContent', {
            from: info.from, to: info.to, total: info.total,
        });
    };
}

function setBusy(ui, busy) {
    state.busy = busy;
    setAnvilBusy(busy);
    ui.primary.disabled = busy;
    ui.stop.hidden = !busy;
    root?.classList.toggle('pf-panel--busy', busy);
    if (!busy) {
        setTimeout(() => { ui.progress.hidden = true; }, 900);
    }
}

async function runForge(ui) {
    if (state.busy) return;
    if (!state.brief.trim()) return toast('warning', t('errNoBrief'));

    const settings = getSettings();
    if (settings.apiSource === 'profile' && !settings.profileId) return toast('warning', t('errNoProfile'));

    state.controller = new AbortController();
    setBusy(ui, true);

    try {
        const { preset, blueprint, missing } = await forgePreset({
            brief: state.brief,
            presetName: state.presetName,
            signal: state.controller.signal,
            onProgress: makeProgressHandler(ui),
        });

        state.preset = preset;
        state.presetLabel = blueprint.name;
        state.saveAs = blueprint.name;
        state.selection = new Set();

        if (missing > 0) toast('warning', t('partialWarning', { n: missing }));
        await finishPreset(blueprint.name, preset);
        state.tab = 'modules';
        render();
    } catch (error) {
        reportFailure(error);
    } finally {
        setBusy(ui, false);
        state.controller = null;
    }
}

async function runRewrite(ui) {
    if (state.busy) return;
    if (!state.preset) return toast('warning', t('errNoSource'));
    if (!state.rewriteBrief.trim()) return toast('warning', t('errNoBrief'));

    const settings = getSettings();
    if (settings.apiSource === 'profile' && !settings.profileId) return toast('warning', t('errNoProfile'));

    const all = listModules(state.preset).filter(m => !m.marker);
    let targets;
    if (state.rewriteScope === 'selected') targets = all.filter(m => state.selection.has(m.identifier));
    else if (state.rewriteScope === 'enabled') targets = all.filter(m => m.enabled && m.content.trim());
    else targets = all.filter(m => m.content.trim());

    if (!targets.length) return toast('warning', t('errNoSelection'));

    state.controller = new AbortController();
    setBusy(ui, true);

    try {
        const { preset, empty } = await rewriteModules({
            preset: state.preset,
            modules: targets,
            brief: state.rewriteBrief,
            keepNames: state.keepNames,
            signal: state.controller.signal,
            onProgress: makeProgressHandler(ui),
        });

        state.preset = preset;
        if (empty > 0) toast('warning', t('partialWarning', { n: empty }));

        const name = state.saveAs.trim() || state.presetLabel;
        await finishPreset(name, preset);
        state.presetLabel = name;
        state.tab = 'modules';
        render();
    } catch (error) {
        reportFailure(error);
    } finally {
        setBusy(ui, false);
        state.controller = null;
    }
}

/** Save into SillyTavern when allowed, otherwise offer the download. */
async function finishPreset(name, preset) {
    const settings = getSettings();
    if (!settings.autoSave) {
        downloadPreset(name, preset);
        toast('success', t('done'));
        return;
    }
    if (presetExists(name) && !await confirm(t('overwritePrompt', { name }))) {
        downloadPreset(name, preset);
        return;
    }
    try {
        await savePreset(name, preset, false);
        toast('success', t('savedAs', { name }));
    } catch (error) {
        console.error('[PresetForge] save failed', error);
        toast('error', error.message);
        downloadPreset(name, preset);
    }
}

async function saveCurrentPreset() {
    if (!state.preset) return toast('warning', t('errNoSource'));
    const name = state.saveAs.trim() || state.presetLabel || 'Forged Preset';
    await finishPreset(name, state.preset);
}

function reportFailure(error) {
    if (error?.name === 'AbortError') {
        toast('info', t('aborted'));
        return;
    }
    console.error('[PresetForge]', error);
    toast('error', t('errGeneration', { msg: error?.message ?? String(error) }));
}
