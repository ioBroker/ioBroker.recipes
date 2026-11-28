#!/usr/bin/env node
/**
 * Puts a Blockly XML file into the "blockly" property of a recipe, so nobody has to escape XML for a
 * JSON string by hand: node scripts/embed.mjs recipes/<id>.json <file.xml>
 *
 * Without the XML file, it writes the XML of the recipe to <id>.xml instead, to edit it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const [recipeFile, xmlFile] = process.argv.slice(2);
if (!recipeFile) {
    console.error('usage: node scripts/embed.mjs recipes/<id>.json [file.xml]');
    process.exit(1);
}

const recipe = JSON.parse(readFileSync(recipeFile, 'utf8'));
if (xmlFile) {
    recipe.blockly = readFileSync(xmlFile, 'utf8').replace(/\r\n/g, '\n');
    writeFileSync(recipeFile, `${JSON.stringify(recipe, null, 4)}\n`);
    console.log(`${xmlFile} is now the Blockly XML of ${recipeFile}`);
} else {
    const out = `${basename(recipeFile, '.json')}.xml`;
    writeFileSync(out, recipe.blockly || '');
    console.log(`the Blockly XML of ${recipeFile} is in ${out}`);
}
