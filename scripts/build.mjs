#!/usr/bin/env node
/**
 * Builds dist/recipes.json from all recipes, and copies the schema next to it: node scripts/build.mjs
 *
 * Nothing is written if a recipe has errors.
 */
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ROOT, buildCatalog, recipeFiles, report, validateFiles } from '../lib/catalog.mjs';

const { entries, errors } = validateFiles(recipeFiles());
if (report(errors, { quiet: true })) {
    console.error('dist/recipes.json was not written');
    process.exit(1);
}

const dist = join(ROOT, 'dist');
mkdirSync(join(dist, 'schema'), { recursive: true });
const catalog = buildCatalog(entries.map(entry => entry.recipe));
writeFileSync(join(dist, 'recipes.json'), `${JSON.stringify(catalog, null, 2)}\n`);
// the $id of the schema points here
copyFileSync(join(ROOT, 'schema', 'recipe.schema.json'), join(dist, 'schema', 'recipe.schema.json'));
console.log(`dist/recipes.json: ${catalog.recipes.length} recipe(s), built ${catalog.buildTime}`);
