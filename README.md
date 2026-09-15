# ST-PresetForge

A SillyTavern extension that writes Chat Completion presets for you, and
rewrites existing ones — whole, or a few toggles at a time.

Presets are described in plain language ("grimdark low-fantasy roleplay, harsh
consequences, prose in the voice of Joe Abercrombie"), and come back as a
normal preset file: a stack of toggleable prompt modules, exclusive option
groups, sampler settings and the usual SillyTavern injection markers.

## Features

- **Create** a preset from a description, for roleplay, game-mastering,
  creative writing or plain assistant work.
- **Rewrite** any preset against a change request — re-skin a fantasy preset
  for hard sci-fi, translate the tone, tighten the rules.
- **Rewrite only the toggles you pick.** Everything you did not select is kept
  byte-for-byte.
- **Edit by hand.** Add, edit, delete, enable and disable modules in the panel.
- **Two generation backends**: the API SillyTavern is currently connected to,
  or a separate Connection Manager profile — so you can forge on a cheap model
  while chatting on an expensive one.
- **Adjustable prompt length**, from terse one-liners to long protocol blocks.
- **English and Russian** interface, and generated prompts in either language.
  English is the default.
- **A draggable anvil button** that remembers where you put it, plus a
  `/presetforge` slash command.
- **Phone and desktop.** A floating window on a desktop, a bottom sheet on a
  phone, with touch drag on both.

## Install

In SillyTavern: **Extensions → Install extension**, and paste

```
https://github.com/jellysilly/ST-PresetForge
```

Or clone into `SillyTavern/public/scripts/extensions/third-party/`:

```sh
git clone https://github.com/jellysilly/ST-PresetForge
```

Then reload SillyTavern. The anvil appears in the lower right; drag it wherever
you like.

Your API must be set to **Chat Completion** — that is the only preset format
this builds.

## Using it

### Create

1. Open the anvil, go to **Create**.
2. Describe what the preset should do. Specifics help: name the tone, the
   failure modes you hate, the toggles you want to be able to flip.
3. Pick the preset type, roughly how many modules you want, and a naming style.
4. **Forge preset**. It designs the architecture first, then writes the modules
   in batches, so a large preset does not have to fit in one response.

### Rewrite

1. Go to **Rewrite** and load a preset, from SillyTavern or from a `.json` file.
2. Describe the change.
3. Choose the scope:
   - **Only selected modules** — tick them in the **Modules** tab.
   - **Only enabled modules**
   - **Every module with content**
4. **Keep module names** rewrites the content and leaves labels alone.
5. Leave **Save as** empty to overwrite the source, or type a new name.

### Modules

The module list is the preset itself. Tick modules to target them for a
rewrite, click the dot to enable or disable one in the prompt order, click a
row to edit it, and use **Add module** for your own. SillyTavern's own prompts
(World Info, Char Description, Chat History and friends) are shown but cannot
be deleted.

## Settings

| Setting | What it does |
| --- | --- |
| Interface language | English or Russian |
| Generation API | The current connection, or a separate Connection Manager profile |
| Max response tokens | Ceiling per request |
| Modules per request | Lower is slower but survives small context windows |
| Generation temperature | Blank leaves it to the API preset |
| Prompt length | Target words per module, or a custom number |
| Save straight into SillyTavern | Off means the result is offered as a download instead |

## How generation works

One response cannot hold a whole preset, so it runs in stages:

1. **Blueprint** — the model designs the module stack: names, kinds, exclusive
   option groups, order, sampler settings, and a one-line brief per module.
2. **Content** — modules are written in batches, each batch seeing the whole
   architecture for context. A batch that comes back unusable costs only its
   own modules; the run continues and the panel reports how many were lost.
3. **Assembly** — modules become a preset, and it is repaired before saving:
   missing SillyTavern prompts are restored, dangling order entries pruned,
   duplicate identifiers dropped, and each exclusive group forced to exactly
   one enabled member.

Selective rewriting reuses stage two, which is why rewriting three toggles
costs three toggles' worth of generation.

### Macros are shielded in transit

SillyTavern expands macros in anything sent through its main API path, so an
unguarded request would turn `{{char}}` in our instructions into a character
name and would *execute* `{{setvar::…}}`, writing variables into your chat.
Rewriting is the acute case, since existing modules are full of macros.

So macros travel to the model as `{%char%}` and are converted back on the way
in. Your presets always end up with real `{{char}}`, and forging one never
touches your variables.

## Development

```sh
node --test "test/*.test.mjs"     # pipeline, schema and JSON-repair tests
```

Set `PF_REFERENCE_DIR` to a folder of real preset `.json` files to also run the
round-trip tests that check output stays shape-identical to presets in the
wild.

Browser tests live in `test/browser/` — see the README there.

### Layout

| Path | Contents |
| --- | --- |
| `index.js` | Entry point, slash command, Extensions-panel drawer |
| `src/doctrine.js` | The preset-writing knowledge given to the model |
| `src/generator.js` | Blueprint → batched content → assembly, and rewriting |
| `src/schema.js` | Preset construction, validation and repair |
| `src/json.js` | Tolerant JSON parsing for model output |
| `src/backend.js` | Main-API and connection-profile generation |
| `src/presetio.js` | Loading, saving, import and export |
| `src/ui/` | Anvil button, panel, DOM helpers |

## Licence

No licence file is included yet — that is the repository owner's call.
SillyTavern itself is AGPL-3.0, and most third-party extensions follow suit.
