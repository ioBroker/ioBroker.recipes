# Contributing a recipe

[Deutsch](#deutsch)

A recipe is submitted as a pull request with one file `recipes/<id>.json`. You need a GitHub account; there is
no other way to submit.

## 1. Build the script

Build the automation in the Blockly editor of ioBroker.javascript with your own devices and test it until it
does what it should. Only Blockly is accepted: no JavaScript or TypeScript, and none of the blocks that contain
free code (`exec`, the procedures with your own JavaScript).

Keep in mind that the script will run with devices of other users:

- every ID of a device or state comes from an input, none is written into the script;
- timers that are started are also stopped or replaced (`clearTimeout` before `setTimeout` with the same name);
- the script does not depend on a state it creates itself, or on other scripts;
- texts the user sees (log, messages) come from a `string` input, so they can be translated;
- the value of a state is read with "Get state value" (`get_value_async`), not with "value of object ID"
  (`get_value`): that one fails if the javascript instance does not subscribe to all states on start.

## 2. Turn it into a recipe

1. Export the script: in the Blockly editor the button "Export blocks" shows the XML. Save it as `<id>.xml`.
2. Replace every ID by a placeholder: `<field name="OID">hm-rpc.0.ABC.1.STATE</field>` becomes
   `<field name="OID">{{motion.ACTUAL}}</field>`. Numbers and times the user should choose become `{{delay}}`
   and so on. See the placeholders in the [README](README.md#placeholders).
3. Write `recipes/<id>.json` without `blockly`; an existing recipe is a good start. Describe every input in
   `inputs`, with `title` in English and German.
4. Put the XML into the recipe: `npm run embed -- recipes/<id>.json <id>.xml`. To change it later:
   `npm run embed -- recipes/<id>.json` writes the XML back to `<id>.xml`.
5. Check it: `npm ci`, then `npm run validate -- recipes/<id>.json`. Every message names the property or the
   line of the XML.

Choose the device types of the type-detector the recipe works with (`deviceType`). If it works with several of
them, use states that only some of them have inside `{{#if ...}}`; the validator tells you where that is
needed.

## 3. Open the pull request

One recipe per pull request. The CI runs the same checks as `npm run validate`. A changed recipe needs a higher
`version`; users of the old one get the update offered.

## Review criteria

A maintainer checks what the CI cannot:

- **It works.** It was tested in an ioBroker, with every device type it allows. Tell in the pull request with
  which devices.
- **It does what the description says**, and nothing else: no writes to states that are not inputs.
- **It is safe for every user.** No endless loops, no timers that pile up, no fast loops of `setState`.
  Switching off what others switched on is avoided where possible (see `light-on-motion`).
- **Inputs are clear.** Titles and descriptions say what to choose; defaults are sensible; units are set.
- **Texts** are in English and German, more languages are welcome. Spelling: „ioBroker“, „vis-2“.
- **Small and general.** One automation per recipe. Special cases for one installation belong in a script of
  your own, not in the catalog.
- **License.** By the pull request you agree that the recipe is published under the MIT license of this
  repository. Copy no blocks from other sources without their permission.

---

## Deutsch

Ein Rezept wird als Pull Request mit einer Datei `recipes/<id>.json` eingereicht. Dafür braucht man ein
GitHub-Konto; einen anderen Weg gibt es nicht.

### 1. Skript bauen

Die Automation im Blockly-Editor des javascript-Adapters mit den eigenen Geräten bauen und testen, bis sie tut,
was sie soll. Angenommen wird nur Blockly: kein JavaScript oder TypeScript und keine Bausteine mit freiem Code
(`exec`, Funktionen mit eigenem JavaScript).

Das Skript läuft später mit den Geräten anderer Nutzer:

- jede ID eines Geräts oder Datenpunkts kommt aus einer Eingabe, keine steht fest im Skript;
- gestartete Timer werden auch gestoppt oder ersetzt (`clearTimeout` vor `setTimeout` mit demselben Namen);
- das Skript hängt nicht von Datenpunkten ab, die es selbst anlegt, und nicht von anderen Skripten;
- Texte für den Nutzer (Log, Nachrichten) kommen aus einer `string`-Eingabe, damit man sie übersetzen kann;
- der Wert eines Datenpunkts wird mit „Zustandswert nehmen“ (`get_value_async`) gelesen, nicht mit „Wert vom
  Objekt ID“ (`get_value`): Das scheitert, wenn die javascript-Instanz beim Start nicht alle Datenpunkte abonniert.

### 2. Daraus ein Rezept machen

1. Skript exportieren: im Blockly-Editor zeigt der Knopf „Blöcke exportieren“ das XML. Als `<id>.xml`
   speichern.
2. Jede ID durch einen Platzhalter ersetzen: aus `<field name="OID">hm-rpc.0.ABC.1.STATE</field>` wird
   `<field name="OID">{{motion.ACTUAL}}</field>`. Zahlen und Zeiten, die der Nutzer wählen soll, werden zu
   `{{delay}}` und so weiter. Die Platzhalter beschreibt die [README](README.md#platzhalter).
3. `recipes/<id>.json` ohne `blockly` schreiben; ein vorhandenes Rezept ist ein guter Anfang. Jede Eingabe in
   `inputs` beschreiben, mit `title` auf Englisch und Deutsch.
4. Das XML ins Rezept legen: `npm run embed -- recipes/<id>.json <id>.xml`. Um es später zu ändern, schreibt
   `npm run embed -- recipes/<id>.json` das XML zurück nach `<id>.xml`.
5. Prüfen: `npm ci`, dann `npm run validate -- recipes/<id>.json`. Jede Meldung nennt die Eigenschaft oder die
   Zeile im XML.

Die Gerätetypen des type-detector wählen, mit denen das Rezept funktioniert (`deviceType`). Bei mehreren Typen
stehen Datenpunkte, die nur manche haben, in `{{#if ...}}`; der Validator sagt, wo das nötig ist.

### 3. Pull Request öffnen

Ein Rezept pro Pull Request. Die CI führt dieselben Prüfungen aus wie `npm run validate`. Ein geändertes Rezept
braucht eine höhere `version`; wer das alte nutzt, bekommt das Update angeboten.

### Kriterien für das Review

Ein Maintainer prüft, was die CI nicht kann:

- **Es funktioniert.** Es wurde in einem ioBroker getestet, mit jedem erlaubten Gerätetyp. Im Pull Request
  angeben, mit welchen Geräten.
- **Es tut, was die Beschreibung sagt**, und nichts anderes: es schreibt keine Datenpunkte, die keine Eingaben
  sind.
- **Es ist für jeden Nutzer sicher.** Keine Endlosschleifen, keine Timer, die sich anhäufen, kein schnelles
  `setState` in Schleifen. Was andere eingeschaltet haben, wird möglichst nicht ausgeschaltet (siehe
  `light-on-motion`).
- **Klare Eingaben.** Titel und Beschreibungen sagen, was zu wählen ist; die Vorgaben sind sinnvoll; Einheiten
  sind gesetzt.
- **Texte** auf Englisch und Deutsch, weitere Sprachen sind willkommen. Schreibweise: „ioBroker“, „vis-2“.
- **Klein und allgemein.** Eine Automation pro Rezept. Sonderfälle einer einzelnen Installation gehören in ein
  eigenes Skript, nicht in den Katalog.
- **Lizenz.** Mit dem Pull Request stimmt man zu, dass das Rezept unter der MIT-Lizenz dieses Repositorys
  veröffentlicht wird. Keine Bausteine aus anderen Quellen ohne deren Erlaubnis übernehmen.
