/**
 * ST-PresetForge — generate and rewrite SillyTavern Chat Completion presets.
 *
 * Entry point: waits for SillyTavern, restores settings, mounts the anvil
 * button, registers a slash command and an Extensions-panel drawer.
 */

import { EXT_ID, VERSION } from './src/constants.js';
import { getSettings } from './src/settings.js';
import { setLanguage, t } from './src/i18n.js';
import { mountAnvil, setAnvilVisible, resetAnvilPosition } from './src/ui/anvil.js';
import { openPanel, closePanel, togglePanel } from './src/ui/panel.js';
import { el } from './src/ui/dom.js';

/** Resolve once SillyTavern has published its context API. */
function waitForSillyTavern(timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        const started = Date.now();
        const poll = () => {
            if (typeof globalThis.SillyTavern?.getContext === 'function') {
                try {
                    // getContext throws until the app has finished booting.
                    SillyTavern.getContext();
                    return resolve();
                } catch {
                    // keep waiting
                }
            }
            if (Date.now() - started > timeoutMs) {
                return reject(new Error('SillyTavern context never became available'));
            }
            setTimeout(poll, 150);
        };
        poll();
    });
}

/** A small drawer in the Extensions panel, for people who hide the button. */
function mountSettingsDrawer() {
    const host = document.getElementById('extensions_settings2')
        ?? document.getElementById('extensions_settings');
    if (!host || document.getElementById('pf-drawer')) return;

    const content = el('div', { class: 'inline-drawer-content' }, [
        el('p', { class: 'pf-field__hint', text: t('tagline') }),
        el('div', { class: 'pf-drawer-actions' }, [
            el('button', { class: 'pf-btn pf-btn--primary', type: 'button', text: t('appName'), onClick: openPanel }),
            el('button', {
                class: 'pf-btn pf-btn--ghost', type: 'button', text: t('showButtonLabel'),
                onClick: () => {
                    const settings = getSettings();
                    const next = !settings.buttonVisible;
                    settings.buttonVisible = next;
                    SillyTavern.getContext().saveSettingsDebounced();
                    setAnvilVisible(next);
                },
            }),
            el('button', { class: 'pf-btn pf-btn--ghost', type: 'button', text: t('resetButtonPos'), onClick: resetAnvilPosition }),
        ]),
    ]);

    const drawer = el('div', { id: 'pf-drawer', class: 'inline-drawer' }, [
        el('div', { class: 'inline-drawer-toggle inline-drawer-header' }, [
            el('b', { text: `${EXT_ID}` }),
            el('div', { class: 'inline-drawer-icon fa-solid fa-circle-chevron-down down' }),
        ]),
        content,
    ]);

    host.append(drawer);
}

/** `/presetforge` opens, closes or toggles the panel. */
function registerSlashCommand() {
    const ctx = SillyTavern.getContext();
    const { SlashCommandParser, SlashCommand, SlashCommandArgument, ARGUMENT_TYPE } = ctx;
    if (!SlashCommandParser?.addCommandObject) return;

    try {
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'presetforge',
            aliases: ['forge'],
            helpString: 'Open the PresetForge panel. Pass <code>open</code>, <code>close</code> or <code>toggle</code>.',
            unnamedArgumentList: [
                SlashCommandArgument.fromProps({
                    description: 'action',
                    typeList: [ARGUMENT_TYPE.STRING],
                    isRequired: false,
                    enumList: ['open', 'close', 'toggle'],
                }),
            ],
            callback: (_args, value) => {
                const action = String(value ?? 'toggle').trim().toLowerCase();
                if (action === 'open') openPanel();
                else if (action === 'close') closePanel();
                else togglePanel();
                return '';
            },
        }));
    } catch (error) {
        console.warn(`[${EXT_ID}] slash command registration failed`, error);
    }
}

async function init() {
    await waitForSillyTavern();

    const settings = getSettings();
    setLanguage(settings.uiLanguage);

    mountAnvil(togglePanel);
    mountSettingsDrawer();
    registerSlashCommand();

    // The Extensions panel is rebuilt on some navigations; re-attach if needed.
    const ctx = SillyTavern.getContext();
    ctx.eventSource?.on?.(ctx.event_types?.APP_READY, mountSettingsDrawer);

    console.log(`[${EXT_ID}] v${VERSION} ready`);
}

init().catch(error => console.error(`[${EXT_ID}] failed to start`, error));
