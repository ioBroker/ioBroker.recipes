import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildCatalog, readRecipes, recipeFiles, validateFiles } from '../lib/catalog.mjs';
import { checkCatalog, checkRecipe } from '../lib/check.mjs';

/** A small valid recipe, changed by every test */
function recipe(change = r => r) {
    const base = {
        id: 'test-recipe',
        version: '1.0.0',
        title: { en: 'Test', de: 'Test' },
        description: { en: 'A test', de: 'Ein Test' },
        author: 'someone',
        minJavascript: '8.0.0',
        inputs: {
            light: { type: 'device', deviceType: ['light', 'dimmer'], multiple: true, title: { en: 'Lights', de: 'Lampen' } },
            delay: { type: 'duration', default: 60 },
        },
        blockly:
            '<xml xmlns="https://developers.google.com/blockly/xml">\n' +
            '  <block type="timeouts_settimeout">\n' +
            '    <field name="NAME">t</field>\n' +
            '    <field name="DELAY">{{delay}}</field>\n' +
            '    <field name="UNIT">sec</field>\n' +
            '    <statement name="STATEMENT">\n' +
            '{{#each light}}\n' +
            '      <block type="control"><field name="OID">{{light.SET}}</field></block>\n' +
            '{{/each}}\n' +
            '    </statement>\n' +
            '  </block>\n' +
            '</xml>',
    };
    const copy = structuredClone(base);
    change(copy);
    return copy;
}

/** The errors as "path: message" */
const errorsOf = r => checkRecipe(r, { fileId: r.id }).map(error => `${error.path}: ${error.message}`);

/** Expects exactly one error that matches */
function expectError(r, pattern) {
    const errors = errorsOf(r);
    assert.ok(
        errors.some(error => pattern.test(error)),
        `expected an error like ${pattern}, got:\n${errors.join('\n') || '(none)'}`,
    );
}

describe('the recipes of the catalog', () => {
    for (const { file, recipe: r, fileId } of readRecipes(recipeFiles())) {
        it(`${file} is valid`, () => {
            assert.deepEqual(checkRecipe(r, { fileId }), []);
        });
    }

    it('the test recipe itself is valid', () => {
        assert.deepEqual(errorsOf(recipe()), []);
    });
});

describe('the schema', () => {
    it('wants every required property', () => {
        expectError(recipe(r => void delete r.author), /^recipe: the property "author" is missing$/);
    });

    it('knows no other properties', () => {
        expectError(recipe(r => void (r.script = 'log(1)')), /^recipe: unknown property "script"$/);
    });

    it('checks SemVer', () => {
        expectError(recipe(r => void (r.version = '1.0')), /^version: "1.0" must be a version in SemVer form, like 1.0.0$/);
        expectError(recipe(r => void (r.minJavascript = 'v8')), /^minJavascript: "v8" must be a version in SemVer form/);
    });

    it('wants English and German texts', () => {
        expectError(recipe(r => void (r.title = { en: 'Test' })), /^title: the property "de" is missing$/);
    });

    it('knows the input types', () => {
        expectError(
            recipe(r => void (r.inputs.delay = { type: 'seconds' })),
            /^inputs\.delay\.type: unknown input type "seconds", known are: device, state, number/,
        );
    });

    it('checks the properties of an input type', () => {
        expectError(recipe(r => void (r.inputs.delay.unit = 's')), /^inputs\.delay: unknown property "unit"$/);
        expectError(recipe(r => void (r.inputs.delay.default = 1.5)), /^inputs\.delay\.default: must be integer$/);
        expectError(
            recipe(r => {
                r.inputs.sensor = { type: 'state', valueType: 'number', commonType: 'nummer', title: { en: 'S', de: 'S' } };
                r.blockly = r.blockly.replace('</xml>', '<!-- {{sensor}} --></xml>');
            }),
            /^inputs\.sensor: unknown property "valueType"$/,
        );
        expectError(
            recipe(r => {
                r.inputs.sensor = { type: 'state', commonType: 'nummer', title: { en: 'S', de: 'S' } };
                r.blockly = r.blockly.replace('</xml>', '<!-- {{sensor}} --></xml>');
            }),
            /^inputs\.sensor\.commonType: must be one of: number, string, boolean/,
        );
    });

    it('wants the ID in kebab case and as file name', () => {
        expectError(recipe(r => void (r.id = 'Test_Recipe')), /^id: "Test_Recipe" must be lower case words and digits joined by "-"/);
        const errors = checkRecipe(recipe(), { fileId: 'other-name' }).map(e => `${e.path}: ${e.message}`);
        assert.ok(errors.includes('id: "test-recipe" must be the name of the file: recipes/test-recipe.json'), errors.join('\n'));
    });
});

describe('the inputs', () => {
    it('knows the device types of the type-detector', () => {
        expectError(
            recipe(r => void (r.inputs.light.deviceType = ['lights'])),
            /^inputs\.light\.deviceType: unknown device type "lights" \(did you mean "light"\?\)\. Known types: /,
        );
    });

    it('wants the default of a select among the options', () => {
        expectError(
            recipe(r => {
                r.inputs.mode = { type: 'select', default: 'off', options: [{ value: 'eco', title: { en: 'Eco', de: 'Eco' } }] };
                r.blockly = r.blockly.replace('</xml>', '<!-- {{mode}} --></xml>');
            }),
            /^inputs\.mode\.default: "off" is none of the options: eco$/,
        );
    });

    it('wants a title for devices and states', () => {
        expectError(recipe(r => void delete r.inputs.light.title), /^inputs\.light\.title: a device or state needs a title/);
    });
});

describe('the placeholders', () => {
    it('must have an input', () => {
        expectError(
            recipe(r => void (r.blockly = r.blockly.replace('{{delay}}', '{{dealy}}'))),
            /^blockly, line 4: \{\{dealy\}\}: there is no input "dealy" \(did you mean "delay"\?\)$/,
        );
    });

    it('every input must be used', () => {
        expectError(
            recipe(r => void (r.inputs.unused = { type: 'number', default: 1 })),
            /^inputs\.unused: the input is not used in the Blockly XML, there is no \{\{unused\}\}$/,
        );
    });

    it('a list only inside {{#each}}', () => {
        expectError(
            recipe(r => void (r.blockly = r.blockly.replace('</xml>', '<!-- {{light.SET}} --></xml>'))),
            /\{\{light\.SET\}\}: "light" is a list, use it inside \{\{#each light\}\}$/,
        );
    });

    it('{{#each}} only over a list', () => {
        expectError(
            recipe(r => void (r.blockly = r.blockly.replace('</xml>', '{{#each delay}}{{/each}}</xml>'))),
            /\{\{#each delay\}\}: the input "delay" is no list, it needs "multiple": true$/,
        );
    });

    it('a state must exist for the device type', () => {
        expectError(
            recipe(r => void (r.blockly = r.blockly.replace('{{light.SET}}', '{{light.SWITCH}}'))),
            /\{\{light\.SWITCH\}\}: the device type light, dimmer has no state "SWITCH"/,
        );
    });

    it('a state of only some device types needs a guard', () => {
        const unguarded = recipe(r => void (r.blockly = r.blockly.replace('{{light.SET}}', '{{light.ON_SET}}')));
        expectError(unguarded, /\{\{light\.ON_SET\}\}: the device type light has no state "ON_SET"\. Use it inside \{\{#if light\.ON_SET\}\} or \{\{#if light\.type == "dimmer"\}\}$/);

        const guarded = recipe(r => void (r.blockly = r.blockly.replace('{{light.SET}}', '{{#if light.ON_SET}}{{light.ON_SET}}{{else}}{{light.SET}}{{/if}}')));
        assert.deepEqual(errorsOf(guarded), []);

        const byType = recipe(r => void (r.blockly = r.blockly.replace('{{light.SET}}', '{{#if light.type == "dimmer"}}{{light.ACTUAL}}{{else}}{{light.SET}}{{/if}}')));
        assert.deepEqual(errorsOf(byType), []);
    });

    it('compares the type only with a type of the input', () => {
        expectError(
            recipe(r => void (r.blockly = r.blockly.replace('{{light.SET}}', '{{#if light.type == "socket"}}x{{/if}}{{light.SET}}'))),
            /\{\{light\.type\}\} is never "socket", the device types are: light, dimmer$/,
        );
    });

    it('an optional input needs a guard', () => {
        const optional = r => {
            r.inputs.sensor = { type: 'state', optional: true, title: { en: 'Sensor', de: 'Sensor' } };
        };
        expectError(
            recipe(r => {
                optional(r);
                r.blockly = r.blockly.replace('</xml>', '<!-- {{sensor}} --></xml>');
            }),
            /\{\{sensor\}\}: the input "sensor" is optional, use it inside \{\{#if sensor\}\} \.\.\. \{\{\/if\}\}$/,
        );
        assert.deepEqual(
            errorsOf(
                recipe(r => {
                    optional(r);
                    r.blockly = r.blockly.replace('</xml>', '<!-- {{#if sensor}}{{sensor}}{{/if}} --></xml>');
                }),
            ),
            [],
        );
    });

    it('names a syntax error with its line', () => {
        expectError(recipe(r => void (r.blockly = r.blockly.replace('{{/each}}', ''))), /^blockly, line 7: \{\{#each\}\} is not closed$/);
    });
});

describe('the Blockly XML', () => {
    it('must be well formed', () => {
        expectError(
            recipe(r => void (r.blockly = r.blockly.replace('</statement>', '</statment>'))),
            /^blockly: the XML is not well formed: .*statment.* \(line \d+\)$/,
        );
    });

    it('must be well formed with every choice of the user', () => {
        // fine as a template, but the branch for dimmers leaves a <field> open
        expectError(
            recipe(r => void (r.blockly = r.blockly.replace('<field name="OID">{{light.SET}}</field>', '<field name="OID">{{#if light.type == "dimmer"}}{{light.SET}}<b>{{else}}{{light.SET}}{{/if}}</field>'))),
            /the XML is not well formed/,
        );
    });

    it('allows no free JavaScript', () => {
        expectError(
            recipe(r => void (r.blockly = r.blockly.replace('</xml>', '<block type="procedures_defcustomnoreturn"><field name="SCRIPT">evil()</field></block></xml>'))),
            /^blockly, line 12: the block "procedures_defcustomnoreturn" is not allowed in the catalog: it contains free JavaScript$/,
        );
        expectError(
            recipe(r => void (r.blockly = r.blockly.replace('</xml>', '<block type="exec"></block></xml>'))),
            /the block "exec" is not allowed in the catalog: it runs shell commands/,
        );
    });

    it('rejects reading a state synchronously, but not the name of its object', () => {
        const read = attr =>
            recipe(
                r =>
                    void (r.blockly = r.blockly.replace(
                        '</xml>',
                        `<block type="debug"><value name="TEXT"><block type="get_value"><field name="ATTR">${attr}</field><field name="OID">a.0.b</field></block></value></block></xml>`,
                    )),
            );
        expectError(
            read('val'),
            /^blockly, line 12: the block "get_value" reads the state synchronously, which fails if the javascript instance does not subscribe to all states on start: use "get_value_async"$/,
        );
        assert.deepEqual(errorsOf(read('common.name')).filter(error => /synchronously/.test(error)), []);
    });

    it('must have the root <xml>', () => {
        expectError(recipe(r => void (r.blockly = r.blockly.replace(/^<xml[^>]*>/, '<root>').replace(/<\/xml>$/, '</root>'))), /^blockly: the root element must be <xml>$/);
    });

    it('a block repeated by {{#each}} must not have a <next>', () => {
        expectError(
            recipe(r => void (r.blockly = r.blockly.replace('</field></block>', '</field><next><block type="debug"></block></next></block>'))),
            /a block that \{\{#each\}\} repeats must not have a <next> of its own/,
        );
    });
});

describe('the catalog', () => {
    it('wants every ID once', () => {
        const a = recipe();
        const errors = checkCatalog([
            { file: 'recipes/test-recipe.json', fileId: 'test-recipe', recipe: a },
            { file: 'recipes/copy/test-recipe.json', fileId: 'test-recipe', recipe: structuredClone(a) },
        ]);
        assert.deepEqual(errors.get('recipes/test-recipe.json'), []);
        assert.deepEqual(
            errors.get('recipes/copy/test-recipe.json').map(e => e.message),
            ['the ID "test-recipe" is used by recipes/test-recipe.json as well'],
        );
    });

    it('builds recipes.json sorted, without $schema', () => {
        const catalog = buildCatalog(
            [recipe(r => void (r.id = 'b')), recipe(r => void Object.assign(r, { id: 'a', $schema: '../schema/recipe.schema.json' }))],
            new Date('2026-01-02T03:04:05Z'),
        );
        assert.equal(catalog.format, 1);
        assert.equal(catalog.buildTime, '2026-01-02T03:04:05.000Z');
        assert.deepEqual(catalog.recipes.map(r => r.id), ['a', 'b']);
        assert.ok(!('$schema' in catalog.recipes[0]));
    });

    it('reports a file that is no JSON', () => {
        const broken = fileURLToPath(new URL('fixtures/not-json.json', import.meta.url));
        const { errors } = validateFiles([broken]);
        const [list] = [...errors.values()];
        assert.match(list[0].message, /^the file is no valid JSON \(line 3\): /);
    });
});

describe('scripts/validate.mjs', () => {
    const script = fileURLToPath(new URL('../scripts/validate.mjs', import.meta.url));

    it('rejects a broken recipe with a readable message and exit code 1', () => {
        const broken = fileURLToPath(new URL('fixtures/broken-recipe.json', import.meta.url));
        let output = '';
        let code = 0;
        try {
            execFileSync(process.execPath, [script, broken], { encoding: 'utf8', stdio: 'pipe' });
        } catch (error) {
            code = error.status;
            output = error.stderr;
        }
        assert.equal(code, 1);
        assert.match(output, /x .*broken-recipe\.json/);
        assert.match(output, /version: "1\.0" must be a version in SemVer form, like 1\.0\.0/);
        assert.match(output, /inputs\.light\.deviceType: unknown device type "lamp"/);
        assert.match(output, /\{\{lights\.SET\}\}: there is no input "lights" \(did you mean "light"\?\)/);
    });

    it('accepts the catalog', () => {
        const output = execFileSync(process.execPath, [script], { encoding: 'utf8' });
        assert.match(output, /recipe\(s\) are valid/);
    });
});
