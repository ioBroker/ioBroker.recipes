#!/usr/bin/env node
/**
 * Checks recipes: node scripts/validate.mjs [file ...] [--quiet]
 *
 * Without files all of recipes/ are checked. The exit code is 1 if one of them has errors.
 */
import { resolve } from 'node:path';

import { recipeFiles, report, validateFiles } from '../lib/catalog.mjs';

const args = process.argv.slice(2);
const quiet = args.includes('--quiet');
const given = args.filter(arg => !arg.startsWith('--'));
const files = given.length ? given.map(file => resolve(file)) : recipeFiles();

if (!files.length) {
    console.error('no recipes found');
    process.exit(1);
}

const { errors } = validateFiles(files);
process.exit(report(errors, { quiet }) ? 1 : 0);
