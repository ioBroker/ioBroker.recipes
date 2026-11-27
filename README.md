# ioBroker recipes

[Deutsch](#deutsch)

Ready-made automations ("recipes") for ioBroker. A recipe is a Blockly script with placeholders and a list of
inputs. In the script editor of ioBroker.javascript the user picks a recipe, assigns their own devices, and gets
a normal Blockly script under `script.js.Rezepte.*`. There is no runtime of its own: the javascript adapter
runs the script like any other.

The catalog lives in this repository: one JSON file per recipe in `recipes/`, changes by pull request, checked
by CI. The catalog contains Blockly only, no free JavaScript.

## Contents

| Path | What |
|------|------|
| `recipes/<id>.json` | the recipes |
| `schema/recipe.schema.json` | JSON Schema of a recipe |
| `lib/template.mjs` | the placeholder engine, without dependencies, so that ioBroker.javascript can use the same code |
| `lib/check.mjs` | all checks of a recipe |
| `scripts/validate.mjs` | checks recipes |
| `scripts/build.mjs` | builds `dist/recipes.json` |
| `scripts/embed.mjs` | puts a Blockly XML file into a recipe, and back |

```bash
npm ci
npm test               # tests of the engine and the checks
npm run validate       # all recipes, or: npm run validate -- recipes/<id>.json
npm run build          # dist/recipes.json
```

How to submit a recipe: [CONTRIBUTING.md](CONTRIBUTING.md).

## Recipe format

```json
{
    "$schema": "../schema/recipe.schema.json",
    "id": "light-on-motion",
    "version": "1.0.0",
    "title": { "en": "Light on motion", "de": "Licht bei Bewegung" },
    "description": { "en": "...", "de": "..." },
    "author": "github-username",
    "tags": ["licht", "bewegung"],
    "minJavascript": "8.0.0",
    "inputs": {
        "motion": { "type": "device", "deviceType": "motion", "title": { "en": "Motion sensor", "de": "Bewegungsmelder" } },
        "light": { "type": "device", "deviceType": ["light", "dimmer"], "multiple": true, "title": { "en": "Lights", "de": "Lampen" } },
        "lux": { "type": "number", "default": 50, "unit": "lx" },
        "delay": { "type": "duration", "default": 120 }
    },
    "blockly": "<xml>...</xml>"
}
```

| Property | |
|----------|---|
| `id` | lower case words and digits joined by `-`; also the file name `recipes/<id>.json` |
| `version` | SemVer. Raise it with every change, users get the update offered |
| `title`, `description` | texts per language, `en` and `de` are required |
| `author` | GitHub user name |
| `tags` | optional, lower case words |
| `minJavascript` | lowest version of ioBroker.javascript the recipe runs with; older ones do not show it |
| `inputs` | what the user chooses; the key is the name used in the placeholders |
| `blockly` | the Blockly XML with placeholders |
| `$schema` | optional, for editors; not part of the catalog |

### Inputs

Every input has `type`, and optionally `title` and `description` (texts per language) and `optional: true`.
Devices and states need a `title`.

| `type` | Properties | `{{name}}` is |
|--------|------------|---------------|
| `device` | `deviceType`: a type of `@iobroker/type-detector` or a list of them; `multiple` | the ID of the device; its states: `{{name.SET}}` |
| `state` | `role`, `commonType` (common.type), `write`, `multiple` | the ID of the state |
| `number` | `default`, `min`, `max`, `step`, `unit` | the number |
| `boolean` | `default` | `TRUE` or `FALSE`, as the block `logic_boolean` wants it |
| `string` | `default`: a text, or a text per language | the text |
| `duration` | `default`, `min`, `max`, in seconds | the seconds |
| `time` | `default` as `HH:MM` | `HH:MM`; `{{name.hour}}`, `{{name.minute}}` without leading zero |
| `select` | `options`: `[{ "value": "...", "title": {...} }]`, `default` | the value of the chosen option |

`role` of a state input: a state fits if its role is the same or continues it (`value.power` fits
`value.power.xyz`). `write: true` offers only states the script may write.

## Placeholders

The placeholders are written in the Blockly XML. The engine is `lib/template.mjs`.

| Syntax | |
|--------|---|
| `{{name}}` | the value of an input, escaped for XML (`&`, `<`, `>`, `"`, `'`) |
| `{{name.SET}}` | the ID of the state `SET` of a device. The names are those of the type-detector: `SET`, `ACTUAL`, `ON_SET`, ... |
| `{{name.id}}`, `{{name.name}}`, `{{name.type}}` | ID, name and device type of a device |
| `{{name.count}}` | number of items of a list (`multiple: true`) |
| `{{name.hour}}`, `{{name.minute}}` | parts of a time |
| `{{#each name}} ... {{/each}}` | once per item of a list. Inside, `name` is the current item. `{{@index}}` counts from 0 |
| `{{#if name}} ... {{else}} ... {{/if}}` | if the input has a value. `{{else}}` is optional |
| `{{#if name.ON_SET}}` | if the device has this state |
| `{{#if name == "text"}}`, `{{#if name != "text"}}` | compares the value as it would be put in, for example `{{#if light.type == "dimmer"}}` |

Upper case after the dot is a state, lower case a property. `{{` is reserved for placeholders.

**`{{#each}}` and statements.** Blockly stores statements that follow each other nested: the second block is in
the `<next>` of the first one. If what `{{#each}}` repeats is exactly one `<block>` element, the engine links the
repetitions this way. So a list of lamps is simply:

```xml
<next>
{{#each light}}
  <block type="control">
    <mutation delay_input="false"></mutation>
    <field name="OID">{{light.SET}}</field>
    <field name="WITH_DELAY">FALSE</field>
    <value name="VALUE"><block type="logic_boolean"><field name="BOOL">TRUE</field></block></value>
  </block>
{{/each}}
</next>
```

Such a block must not have a `<next>` of its own. Anything else that is repeated, for example `<value>`
elements, is repeated as it is: `<mutation items="{{light.count}}"/>{{#each light}}<value name="ADD{{@index}}">...</value>{{/each}}`.
Block IDs that are repeated get new ones from Blockly when the script is loaded, so exported XML can keep them.

**Devices of several types.** A device type may lack a state the other one has: `light` has no `ON_SET`.
Such a state may only be used where it exists:

```xml
{{#if light.ON_SET}}   ... {{light.ON_SET}} ...
{{else}}{{#if light.type == "dimmer"}}   ... {{light.SET}} as level ...
{{else}}   ... {{light.SET}} as switch ...
{{/if}}{{/if}}
```

A state the template uses without such a condition is needed: ioBroker.javascript proposes only devices that
have it.

**Optional inputs** may only be used inside `{{#if name}}`. A list may be empty and needs no condition.

## Checks

`npm run validate` checks:

- the JSON Schema, with messages that name the property;
- the ID is the file name and is used once only;
- `version` and `minJavascript` are SemVer;
- the device types exist in `@iobroker/type-detector`, and so do the states used for them;
- the placeholders are valid, every placeholder has an input and every input is used;
- lists only inside `{{#each}}`, optional inputs only inside `{{#if}}`, states of only some device types only inside a condition;
- the Blockly XML is well formed, and stays so when it is filled in with every device type, with and without the optional inputs, with devices that have all their states or only the needed ones;
- no blocks with free code: `exec` and the custom JavaScript functions of the procedures;
- no blocks that read a state synchronously (`get_value`, `get_value_var`): they fail if the javascript instance
  does not subscribe to all states on start. `get_value_async` works in both cases.

Whether a recipe really works can only be seen in an ioBroker; see the review criteria in [CONTRIBUTING.md](CONTRIBUTING.md).

## Catalog

`npm run build` writes `dist/recipes.json`:

```json
{ "format": 1, "buildTime": "2026-11-27T12:00:00.000Z", "recipes": [ ... ] }
```

`format` changes only if ioBroker.javascript has to read the file differently. On every push to `main` the
GitHub Action builds the file and publishes it on GitHub Pages:
`https://iobroker.github.io/ioBroker.recipes/recipes.json`, the schema at `https://iobroker.github.io/ioBroker.recipes/schema/recipe.schema.json`.

**Open point:** the final place of `recipes.json`. GitHub Pages is the proposal; the URL is a setting of the
javascript adapter, so it can move (for example to `iobroker.net`) without a change of the adapter.

## License

MIT, see [LICENSE](LICENSE). A recipe in this catalog is under the same license.

---

## Deutsch

Fertige Automationen („Rezepte“) für ioBroker. Ein Rezept ist ein Blockly-Skript mit Platzhaltern und einer
Liste von Eingaben. Im Skript-Editor des javascript-Adapters wählt man ein Rezept aus, ordnet die eigenen Geräte
zu und erhält ein normales Blockly-Skript unter `script.js.Rezepte.*`. Es gibt keine eigene Laufzeit: der
javascript-Adapter führt das Skript aus wie jedes andere.

Der Katalog liegt in diesem Repository: eine JSON-Datei pro Rezept in `recipes/`, Änderungen per Pull Request,
geprüft von der CI. Der Katalog enthält nur Blockly, kein freies JavaScript.

### Inhalt

| Pfad | Was |
|------|-----|
| `recipes/<id>.json` | die Rezepte |
| `schema/recipe.schema.json` | JSON Schema eines Rezepts |
| `lib/template.mjs` | die Platzhalter, ohne Abhängigkeiten, damit der javascript-Adapter denselben Code nutzen kann |
| `lib/check.mjs` | alle Prüfungen eines Rezepts |
| `scripts/validate.mjs` | prüft Rezepte |
| `scripts/build.mjs` | erzeugt `dist/recipes.json` |
| `scripts/embed.mjs` | legt eine Blockly-XML-Datei in ein Rezept und zurück |

```bash
npm ci
npm test               # Tests der Platzhalter und der Prüfungen
npm run validate       # alle Rezepte, oder: npm run validate -- recipes/<id>.json
npm run build          # dist/recipes.json
```

Wie man ein Rezept einreicht: [CONTRIBUTING.md](CONTRIBUTING.md#deutsch).

### Rezeptformat

Das Format zeigt das Beispiel oben.

| Eigenschaft | |
|-------------|---|
| `id` | kleine Wörter und Ziffern, verbunden mit `-`; zugleich der Dateiname `recipes/<id>.json` |
| `version` | SemVer. Bei jeder Änderung erhöhen, dann wird das Update angeboten |
| `title`, `description` | Texte pro Sprache, `en` und `de` sind Pflicht |
| `author` | GitHub-Benutzername |
| `tags` | optional, kleingeschriebene Wörter |
| `minJavascript` | niedrigste Version des javascript-Adapters, mit der das Rezept läuft; ältere zeigen es nicht an |
| `inputs` | was der Nutzer auswählt; der Schlüssel ist der Name in den Platzhaltern |
| `blockly` | das Blockly-XML mit Platzhaltern |
| `$schema` | optional, für Editoren; nicht Teil des Katalogs |

#### Eingaben

Jede Eingabe hat `type`, optional `title` und `description` (Texte pro Sprache) und `optional: true`.
Geräte und Datenpunkte brauchen einen `title`.

| `type` | Eigenschaften | `{{name}}` ist |
|--------|---------------|----------------|
| `device` | `deviceType`: ein Typ des `@iobroker/type-detector` oder eine Liste davon; `multiple` | die ID des Geräts; seine Datenpunkte: `{{name.SET}}` |
| `state` | `role`, `commonType` (common.type), `write`, `multiple` | die ID des Datenpunkts |
| `number` | `default`, `min`, `max`, `step`, `unit` | die Zahl |
| `boolean` | `default` | `TRUE` oder `FALSE`, wie der Baustein `logic_boolean` es braucht |
| `string` | `default`: ein Text oder ein Text pro Sprache | der Text |
| `duration` | `default`, `min`, `max`, in Sekunden | die Sekunden |
| `time` | `default` als `HH:MM` | `HH:MM`; `{{name.hour}}`, `{{name.minute}}` ohne führende Null |
| `select` | `options`: `[{ "value": "...", "title": {...} }]`, `default` | der Wert der gewählten Option |

`role` einer Datenpunkt-Eingabe: ein Datenpunkt passt, wenn seine Rolle gleich ist oder sie fortsetzt
(`value.power` passt zu `value.power.xyz`). Mit `write: true` werden nur Datenpunkte angeboten, die das Skript
schreiben darf.

### Platzhalter

| Schreibweise | |
|--------------|---|
| `{{name}}` | der Wert einer Eingabe, für XML maskiert (`&`, `<`, `>`, `"`, `'`) |
| `{{name.SET}}` | die ID des Datenpunkts `SET` eines Geräts. Die Namen sind die des type-detector: `SET`, `ACTUAL`, `ON_SET`, ... |
| `{{name.id}}`, `{{name.name}}`, `{{name.type}}` | ID, Name und Gerätetyp eines Geräts |
| `{{name.count}}` | Anzahl der Einträge einer Liste (`multiple: true`) |
| `{{name.hour}}`, `{{name.minute}}` | Teile einer Uhrzeit |
| `{{#each name}} ... {{/each}}` | einmal pro Eintrag einer Liste. Darin ist `name` der aktuelle Eintrag. `{{@index}}` zählt ab 0 |
| `{{#if name}} ... {{else}} ... {{/if}}` | wenn die Eingabe einen Wert hat. `{{else}}` ist optional |
| `{{#if name.ON_SET}}` | wenn das Gerät diesen Datenpunkt hat |
| `{{#if name == "text"}}`, `{{#if name != "text"}}` | vergleicht den Wert, wie er eingesetzt würde, zum Beispiel `{{#if light.type == "dimmer"}}` |

Großbuchstaben nach dem Punkt sind ein Datenpunkt, Kleinbuchstaben eine Eigenschaft. `{{` ist für Platzhalter
reserviert.

**`{{#each}}` und Anweisungen.** Blockly speichert aufeinanderfolgende Anweisungen verschachtelt: der zweite
Baustein steht im `<next>` des ersten. Ist das, was `{{#each}}` wiederholt, genau ein `<block>`-Element, verkettet
die Engine die Wiederholungen so. Eine Liste von Lampen ist deshalb einfach das Beispiel oben. Ein solcher
Baustein darf kein eigenes `<next>` haben. Alles andere, zum Beispiel `<value>`-Elemente, wird unverändert
wiederholt. Doppelte Baustein-IDs ersetzt Blockly beim Laden durch neue, exportiertes XML kann sie also behalten.

**Geräte mehrerer Typen.** Einem Gerätetyp kann ein Datenpunkt fehlen, den der andere hat: `light` hat kein
`ON_SET`. Ein solcher Datenpunkt darf nur dort stehen, wo es ihn gibt, also in `{{#if light.ON_SET}}` oder
`{{#if light.type == "dimmer"}}`, siehe oben. Ein Datenpunkt, den das Rezept ohne solche Bedingung verwendet, ist
nötig: der javascript-Adapter schlägt nur Geräte vor, die ihn haben.

**Optionale Eingaben** dürfen nur innerhalb von `{{#if name}}` stehen. Eine Liste darf leer sein und braucht
keine Bedingung.

### Prüfungen

`npm run validate` prüft das JSON Schema, eindeutige IDs gleich dem Dateinamen, SemVer, die Gerätetypen und ihre
Datenpunkte laut type-detector, dass jeder Platzhalter eine Eingabe hat und jede Eingabe verwendet wird, Listen
nur in `{{#each}}`, optionale Eingaben nur in `{{#if}}`, und dass das Blockly-XML wohlgeformt ist, auch
ausgefüllt mit jedem Gerätetyp, mit und ohne optionale Eingaben. Bausteine mit freiem Code (`exec`, eigene
JavaScript-Funktionen) werden abgelehnt, ebenso Bausteine, die einen Datenpunkt synchron lesen (`get_value`,
`get_value_var`): Sie scheitern, wenn die javascript-Instanz beim Start nicht alle Datenpunkte abonniert.
`get_value_async` funktioniert in beiden Fällen.

### Katalog

`npm run build` schreibt `dist/recipes.json` (`format`, `buildTime`, `recipes`). Bei jedem Push auf `main`
erzeugt die GitHub Action die Datei und veröffentlicht sie auf GitHub Pages:
`https://iobroker.github.io/ioBroker.recipes/recipes.json`.

**Offener Punkt:** der endgültige Ort von `recipes.json`. GitHub Pages ist der Vorschlag; die URL ist eine
Einstellung des javascript-Adapters und kann deshalb ohne Änderung des Adapters umziehen (zum Beispiel nach
`iobroker.net`).

### Lizenz

MIT, siehe [LICENSE](LICENSE). Ein Rezept in diesem Katalog steht unter derselben Lizenz.
