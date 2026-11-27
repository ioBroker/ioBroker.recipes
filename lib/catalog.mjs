/**
 * Reading the recipe files and building the catalog that ioBroker.javascript loads.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkCatalog } from './check.mjs';
import { locate } from './template.mjs';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const RECIPES_DIR = join(ROOT, 'recipes');

/** Version of the format of recipes.json, raised when ioBroker.javascript has to read it differently */
export const CATALOG_FORMAT = 1;

/** The recipe files, sorted */
export function recipeFiles(dir = RECIPES_DIR) {
    return readdirSync(dir)
        .filter(name => name.endsWith('.json'))
        .sort()
        .map(name => join(dir, name));
}

/**
 * Reads recipe files.
 *
 * @param {string[]} files paths
 * @returns {{ file: string, fileId: string, recipe?: object, parseError?: string }[]}
 */
export function readRecipes(files) {
    return files.map(path => {
        const file = relative(process.cwd(), path).replace(/\\/g, '/') || path;
        const fileId = basename(path).replace(/\.json$/, '');
        let text;
        try {
            text = readFileSync(path, 'utf8');
        } catch (error) {
            return { file, fileId, parseError: `cannot read the file: ${error.message}` };
        }
        try {
            return { file, fileId, recipe: JSON.parse(text) };
        } catch (error) {
            const position = Number(error.message.match(/position (\d+)/)?.[1]);
            const where = Number.isFinite(position) ? ` (line ${locate(text, position).line})` : '';
            return { file, fileId, parseError: `the file is no valid JSON${where}: ${error.message}` };
        }
    });
}

/**
 * Checks recipe files.
 *
 * @param {string[]} files paths
 * @returns {{ entries: object[], errors: Map<string, object[]> }}
 */
export function validateFiles(files) {
    const entries = readRecipes(files);
    return { entries, errors: checkCatalog(entries) };
}

/**
 * The catalog: all recipes, sorted by ID, and when it was built.
 *
 * @param {object[]} recipes
 */
export function buildCatalog(recipes, buildTime = new Date()) {
    return {
        format: CATALOG_FORMAT,
        buildTime: buildTime.toISOString(),
        recipes: recipes
            .map(recipe => {
                // only for editors, the catalog does not need it
                const { $schema, ...rest } = recipe;
                return rest;
            })
            .sort((a, b) => a.id.localeCompare(b.id)),
    };
}

/** Prints the result of a check, returns the number of files with errors */
export function report(errors, { quiet = false } = {}) {
    let failed = 0;
    for (const [file, list] of errors) {
        if (list.length) {
            failed++;
            console.error(`\nx ${file}`);
            for (const error of list) {
                console.error(`    ${error.path}: ${error.message}`);
            }
        } else if (!quiet) {
            console.log(`ok ${file}`);
        }
    }
    const total = errors.size;
    if (failed) {
        console.error(`\n${failed} of ${total} recipe(s) have errors`);
    } else {
        console.log(`\n${total} recipe(s) are valid`);
    }
    return failed;
}
