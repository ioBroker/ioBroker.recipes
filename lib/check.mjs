/**
 * Checks of a recipe: the schema, and everything a schema cannot say. The placeholders must fit the
 * inputs, the device types and their states must exist in the type-detector, and the Blockly XML must
 * stay well formed for every value the user may choose.
 */
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { XMLValidator } from 'fast-xml-parser';

import { DEVICE_TYPES, closest } from './deviceTypes.mjs';
import {
    RenderError,
    STATE_NAME_RE,
    TemplateError,
    locate,
    parseTemplate,
    pathText,
    renderTemplate,
    topLevelElements,
} from './template.mjs';

export const SCHEMA = JSON.parse(readFileSync(new URL('../schema/recipe.schema.json', import.meta.url), 'utf8'));

// strictRequired would want "type" declared next to the discriminator, which needs it only as required
const ajv = new Ajv2020({ allErrors: true, discriminator: true, verbose: true, strict: true, strictRequired: false });
const validateSchema = ajv.compile(SCHEMA);

export const INPUT_TYPES = ['device', 'state', 'number', 'boolean', 'string', 'duration', 'time', 'select'];

/**
 * Blocks that run code of their own. The catalog contains Blockly only, so that a recipe can be read
 * and reviewed block by block.
 */
export const FORBIDDEN_BLOCKS = {
    exec: 'runs shell commands',
    exec_result: 'belongs to "exec", which runs shell commands',
    procedures_defcustomreturn: 'contains free JavaScript',
    procedures_defcustomnoreturn: 'contains free JavaScript',
    procedures_callcustomreturn: 'calls free JavaScript',
    procedures_callcustomnoreturn: 'calls free JavaScript',
};

/**
 * Blocks that read a state synchronously, with `getState(id).val`. That only works if the javascript
 * instance subscribes to all states on start, which can be switched off in its settings; then the
 * script stops with an error. "get_value_async" reads the state in both cases. Reading an attribute of
 * the object (`type`, `common.*`) is asynchronous anyway.
 */
export const SYNC_READ_BLOCKS = ['get_value', 'get_value_var'];

/** The field ATTR of the block that starts at `index`: before its first inner block */
function attrOf(xml, index) {
    const rest = xml.slice(index + 1);
    const inner = rest.search(/<(block|shadow)\b|<\/block>|<\/shadow>/);
    const own = inner < 0 ? rest : rest.slice(0, inner);
    const match = own.match(/<field\s+name\s*=\s*(["'])ATTR\1\s*>([^<]*)<\/field>/);
    return match ? match[2].trim() : '';
}

/** The device types of an input, as a list */
export function deviceTypesOf(input) {
    return Array.isArray(input.deviceType) ? input.deviceType : [input.deviceType];
}

/** `inputs.light.deviceType` from `/inputs/light/deviceType` */
function jsonPath(pointer) {
    return pointer
        .split('/')
        .slice(1)
        .map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))
        .join('.');
}

/** A readable message for an error of the schema */
function schemaMessage(error) {
    const path = jsonPath(error.instancePath);
    const where = path || 'recipe';
    switch (error.keyword) {
        case 'required':
            return { path: where, message: `the property "${error.params.missingProperty}" is missing` };
        case 'additionalProperties':
            return { path: where, message: `unknown property "${error.params.additionalProperty}"` };
        case 'discriminator':
            if (error.params.error === 'mapping') {
                return {
                    path: `${where}.type`,
                    message: `unknown input type "${error.params.tagValue}", known are: ${INPUT_TYPES.join(', ')}`,
                };
            }
            return { path: where, message: `the property "type" is missing (${INPUT_TYPES.join(', ')})` };
        case 'pattern': {
            const comment = error.parentSchema?.$comment;
            return { path: where, message: `"${error.data}" ${comment || `does not match ${error.params.pattern}`}` };
        }
        case 'propertyNames':
            return null; // the error of the name itself follows
        case 'enum':
            return { path: where, message: `must be one of: ${error.params.allowedValues.join(', ')}` };
        case 'const':
            return null; // only the other branches of the discriminator
        default:
            return { path: where, message: error.message };
    }
}

/**
 * Walks the placeholders and checks them against the inputs.
 *
 * @returns {{ errors: object[], used: Set<string>, needs: Map<string, Set<string>> }}
 *   `needs`: the states of a device the template uses outside a guard, so a device without them does not fit
 */
export function checkPlaceholders(ast, inputs) {
    const errors = [];
    const used = new Set();
    const needs = new Map();
    const text = ast.text;

    const at = node => {
        const { line } = locate(text, node.offset);
        return `blockly, line ${line}`;
    };
    const fail = (node, message) => errors.push({ path: at(node), message });

    /**
     * @param path the path
     * @param scope what is known at this place
     * @param mode 'output', 'condition' or 'compare'
     * @param node for the line
     */
    const checkPath = (path, scope, mode, node, literal) => {
        const shown = `{{${pathText(path)}}}`;
        if (path.index) {
            if (!scope.loops.size) {
                fail(node, '{{@index}} is only known inside {{#each}}');
            } else if (mode !== 'output') {
                fail(node, '{{@index}} cannot be a condition');
            }
            return;
        }
        const input = inputs[path.name];
        if (!input || typeof input !== 'object') {
            const hint = closest(path.name, Object.keys(inputs));
            fail(node, `${shown}: there is no input "${path.name}"${hint ? ` (did you mean "${hint}"?)` : ''}`);
            return;
        }
        used.add(path.name);
        const inLoop = scope.loops.has(path.name);
        const prop = path.prop;

        if (input.multiple && !inLoop && prop !== 'count' && !(mode === 'condition' && !prop)) {
            fail(node, `${shown}: "${path.name}" is a list, use it inside {{#each ${path.name}}}`);
            return;
        }
        if (prop === 'count') {
            if (!input.multiple) {
                fail(node, `${shown}: "count" is only known for inputs with "multiple": true`);
            } else if (inLoop) {
                fail(node, `${shown}: inside {{#each ${path.name}}} "${path.name}" is one item, it has no "count"`);
            }
            return;
        }
        if (mode === 'output' && input.optional && !input.multiple && !scope.given.has(path.name)) {
            fail(node, `${shown}: the input "${path.name}" is optional, use it inside {{#if ${path.name}}} ... {{/if}}`);
        }
        if (!prop) {
            if (mode === 'compare' && input.type === 'select' && Array.isArray(input.options)) {
                const values = input.options.map(option => option.value);
                if (!values.includes(literal)) {
                    fail(node, `${shown} is never "${literal}", the options are: ${values.join(', ')}`);
                }
            }
            return;
        }
        if (STATE_NAME_RE.test(prop)) {
            if (input.type !== 'device') {
                fail(node, `${shown}: only a device has states, "${path.name}" is of type ${input.type}`);
                return;
            }
            const types = [...(scope.types.get(path.name) || deviceTypesOf(input))].filter(type => DEVICE_TYPES.has(type));
            const having = types.filter(type => DEVICE_TYPES.get(type).states.has(prop));
            if (!having.length) {
                const known = new Set(types.flatMap(type => [...DEVICE_TYPES.get(type).states]));
                const hint = closest(prop, known);
                fail(
                    node,
                    `${shown}: the device type ${types.join(', ')} has no state "${prop}"${hint ? ` (did you mean "${hint}"?)` : ''}. Known states: ${[...known].join(', ')}`,
                );
                return;
            }
            const guarded = scope.states.get(path.name)?.has(prop);
            if (mode === 'output' && !guarded) {
                if (having.length < types.length) {
                    const without = types.filter(type => !having.includes(type));
                    fail(
                        node,
                        `${shown}: the device type ${without.join(', ')} has no state "${prop}". Use it inside {{#if ${path.name}.${prop}}} or {{#if ${path.name}.type == "${having[0]}"}}`,
                    );
                    return;
                }
                if (!needs.has(path.name)) {
                    needs.set(path.name, new Set());
                }
                needs.get(path.name).add(prop);
            }
            return;
        }
        if (prop === 'id' || prop === 'name' || prop === 'type') {
            if (input.type !== 'device') {
                fail(node, `${shown}: "${prop}" is only known for devices`);
            } else if (prop === 'type' && mode === 'compare' && !deviceTypesOf(input).includes(literal)) {
                fail(node, `${shown} is never "${literal}", the device types are: ${deviceTypesOf(input).join(', ')}`);
            }
            return;
        }
        if (prop === 'hour' || prop === 'minute') {
            if (input.type !== 'time') {
                fail(node, `${shown}: "${prop}" is only known for inputs of type time`);
            }
            return;
        }
        fail(node, `${shown}: unknown property "${prop}"`);
    };

    const copy = scope => ({
        loops: new Set(scope.loops),
        given: new Set(scope.given),
        states: new Map([...scope.states].map(([name, states]) => [name, new Set(states)])),
        types: new Map([...scope.types].map(([name, types]) => [name, new Set(types)])),
    });

    const walk = (nodes, scope) => {
        for (const node of nodes) {
            if (node.type === 'value') {
                checkPath(node.path, scope, 'output', node);
            } else if (node.type === 'each') {
                const input = inputs[node.name];
                if (!input) {
                    checkPath({ name: node.name }, scope, 'output', node);
                } else if (!input.multiple) {
                    used.add(node.name);
                    fail(node, `{{#each ${node.name}}}: the input "${node.name}" is no list, it needs "multiple": true`);
                } else if (scope.loops.has(node.name)) {
                    fail(node, `{{#each ${node.name}}} inside {{#each ${node.name}}}`);
                } else {
                    used.add(node.name);
                    const inner = copy(scope);
                    inner.loops.add(node.name);
                    walk(node.body, inner);
                }
            } else if (node.type === 'if') {
                const { path, op, literal } = node.condition;
                checkPath(path, scope, op ? 'compare' : 'condition', node, literal);
                const yes = copy(scope);
                const no = copy(scope);
                const input = inputs[path.name];
                if (input && !op && !path.prop) {
                    yes.given.add(path.name);
                } else if (input && !op && STATE_NAME_RE.test(path.prop)) {
                    yes.given.add(path.name);
                    if (!yes.states.has(path.name)) {
                        yes.states.set(path.name, new Set());
                    }
                    yes.states.get(path.name).add(path.prop);
                } else if (input?.type === 'device' && path.prop === 'type' && op) {
                    const types = scope.types.get(path.name) || new Set(deviceTypesOf(input));
                    const only = new Set([...types].filter(type => type === literal));
                    const others = new Set([...types].filter(type => type !== literal));
                    yes.types.set(path.name, op === '==' ? only : others);
                    no.types.set(path.name, op === '==' ? others : only);
                    (op === '==' ? yes : no).given.add(path.name);
                }
                walk(node.then, yes);
                if (node.else) {
                    walk(node.else, no);
                }
            }
        }
    };

    walk(ast.children, { loops: new Set(), given: new Set(), states: new Map(), types: new Map() });
    return { errors, used, needs };
}

/** A device as the type-detector would find it, for test renderings */
function sampleDevice(name, type, index, states) {
    const id = `test.0.${name}${index === undefined ? '' : `_${index}`}`;
    return {
        id,
        name: `${name} ${type}`,
        type,
        states: Object.fromEntries([...states].map(state => [state, `${id}.${state}`])),
    };
}

/**
 * Values for a test rendering.
 *
 * @param inputs the inputs
 * @param variant which device type of a list to take (round robin), whether optional inputs are given,
 *   and whether devices have every state or only those that are needed
 * @param needs see checkPlaceholders()
 */
function sampleValues(inputs, { typeIndex, optional, allStates }, needs) {
    const values = {};
    for (const [name, input] of Object.entries(inputs)) {
        if (input.optional && !optional) {
            continue;
        }
        switch (input.type) {
            case 'device': {
                const types = deviceTypesOf(input).filter(type => DEVICE_TYPES.has(type));
                const device = (type, index) => {
                    const known = DEVICE_TYPES.get(type);
                    const states = allStates
                        ? known.states
                        : new Set([...known.required, ...(needs.get(name) || [])].filter(s => known.states.has(s)));
                    return sampleDevice(name, type, index, states);
                };
                values[name] = input.multiple
                    ? [0, 1].map(i => device(types[(typeIndex + i) % types.length], i))
                    : device(types[typeIndex % types.length]);
                break;
            }
            case 'state':
                values[name] = input.multiple ? [`test.0.${name}_0`, `test.0.${name}_1`] : `test.0.${name}`;
                break;
            case 'number':
                values[name] = input.default ?? input.min ?? 1;
                break;
            case 'duration':
                values[name] = input.default ?? input.min ?? 60;
                break;
            case 'boolean':
                values[name] = input.default ?? true;
                break;
            case 'string':
                // the characters that must be escaped, to prove they are
                values[name] = typeof input.default === 'object' ? input.default.en : (input.default ?? `<"text" & 'more'>`);
                break;
            case 'time':
                values[name] = input.default ?? '07:30';
                break;
            case 'select':
                values[name] = input.default ?? input.options?.[0]?.value;
                break;
        }
    }
    return values;
}

/** Problems of the inputs the schema cannot see */
function checkInputs(inputs) {
    const errors = [];
    for (const [name, input] of Object.entries(inputs)) {
        const path = `inputs.${name}`;
        if (input.type === 'device') {
            for (const type of deviceTypesOf(input)) {
                if (typeof type === 'string' && !DEVICE_TYPES.has(type)) {
                    const hint = closest(type, DEVICE_TYPES.keys());
                    errors.push({
                        path: `${path}.deviceType`,
                        message: `unknown device type "${type}"${hint ? ` (did you mean "${hint}"?)` : ''}. Known types: ${[...DEVICE_TYPES.keys()].sort().join(', ')}`,
                    });
                }
            }
        }
        if (input.type === 'select' && input.default !== undefined) {
            const values = (input.options || []).map(option => option.value);
            if (!values.includes(input.default)) {
                errors.push({ path: `${path}.default`, message: `"${input.default}" is none of the options: ${values.join(', ')}` });
            }
        }
        if (input.type === 'select' && Array.isArray(input.options)) {
            const values = input.options.map(option => option.value);
            const twice = values.filter((value, i) => values.indexOf(value) !== i);
            if (twice.length) {
                errors.push({ path: `${path}.options`, message: `the option "${twice[0]}" is there twice` });
            }
        }
        if ((input.type === 'number' || input.type === 'duration') && input.default !== undefined) {
            if (input.min !== undefined && input.default < input.min) {
                errors.push({ path: `${path}.default`, message: `${input.default} is below the minimum ${input.min}` });
            }
            if (input.max !== undefined && input.default > input.max) {
                errors.push({ path: `${path}.default`, message: `${input.default} is above the maximum ${input.max}` });
            }
        }
        if ((input.type === 'device' || input.type === 'state') && !input.title) {
            errors.push({ path: `${path}.title`, message: 'a device or state needs a title, the user chooses it by that' });
        }
    }
    return errors;
}

/** The XML is well formed, and its root is <xml> */
function checkXml(xml, where) {
    const result = XMLValidator.validate(xml);
    if (result !== true) {
        return [{ path: where, message: `the XML is not well formed: ${result.err.msg} (line ${result.err.line})` }];
    }
    const { elements } = topLevelElements(xml.replace(/^\s*<\?xml[^>]*\?>/, ''));
    if (elements.length !== 1 || elements[0].name !== 'xml') {
        return [{ path: where, message: 'the root element must be <xml>' }];
    }
    return [];
}

/** Block types that run free code, and block types made of placeholders */
function checkBlocks(xml) {
    const errors = [];
    for (const match of xml.matchAll(/<(block|shadow)\b[^>]*?\btype\s*=\s*(["'])(.*?)\2/g)) {
        const type = match[3];
        const { line } = locate(xml, match.index);
        if (FORBIDDEN_BLOCKS[type]) {
            errors.push({ path: `blockly, line ${line}`, message: `the block "${type}" is not allowed in the catalog: it ${FORBIDDEN_BLOCKS[type]}` });
        } else if (type.includes('{{')) {
            errors.push({ path: `blockly, line ${line}`, message: 'the type of a block must not be a placeholder' });
        } else if (SYNC_READ_BLOCKS.includes(type)) {
            const attr = attrOf(xml, match.index);
            if (attr !== 'type' && !attr.startsWith('common.')) {
                errors.push({
                    path: `blockly, line ${line}`,
                    message: `the block "${type}" reads the state synchronously, which fails if the javascript instance does not subscribe to all states on start: use "get_value_async"`,
                });
            }
        }
    }
    return errors;
}

/**
 * Checks one recipe.
 *
 * @param {*} recipe the parsed JSON
 * @param {{ fileId?: string }} options `fileId`: the file name without ".json", must be the ID
 * @returns {{ path: string, message: string }[]} the errors, none if the recipe is fine
 */
export function checkRecipe(recipe, { fileId } = {}) {
    if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) {
        return [{ path: 'recipe', message: 'a recipe is a JSON object' }];
    }
    const errors = [];
    if (!validateSchema(recipe)) {
        const seen = new Set();
        for (const error of validateSchema.errors) {
            const message = schemaMessage(error);
            const key = message && `${message.path}: ${message.message}`;
            if (message && !seen.has(key)) {
                seen.add(key);
                errors.push(message);
            }
        }
    }
    if (fileId !== undefined && typeof recipe.id === 'string' && recipe.id !== fileId) {
        errors.push({ path: 'id', message: `"${recipe.id}" must be the name of the file: recipes/${recipe.id}.json` });
    }

    const inputs = recipe.inputs && typeof recipe.inputs === 'object' ? recipe.inputs : null;
    if (inputs) {
        errors.push(...checkInputs(inputs));
    }
    if (typeof recipe.blockly !== 'string' || !inputs) {
        return errors;
    }

    let ast;
    try {
        ast = parseTemplate(recipe.blockly);
    } catch (error) {
        if (error instanceof TemplateError) {
            errors.push({ path: `blockly, line ${error.line}`, message: error.message.replace(/^line \d+, column \d+: /, '') });
            return errors;
        }
        throw error;
    }
    errors.push(...checkXml(recipe.blockly, 'blockly'));
    errors.push(...checkBlocks(recipe.blockly));

    const { errors: placeholderErrors, used, needs } = checkPlaceholders(ast, inputs);
    errors.push(...placeholderErrors);
    for (const name of Object.keys(inputs)) {
        if (!used.has(name)) {
            errors.push({ path: `inputs.${name}`, message: `the input is not used in the Blockly XML, there is no {{${name}}}` });
        }
    }
    if (errors.length) {
        // the renderings would only repeat these errors
        return errors;
    }

    // Render it as the user may: with every device type of a list, with and without the optional inputs,
    // with devices that have all their states or only the needed ones
    const maxTypes = Math.max(1, ...Object.values(inputs).filter(i => i.type === 'device').map(i => deviceTypesOf(i).length));
    const seen = new Set();
    for (let typeIndex = 0; typeIndex < maxTypes; typeIndex++) {
        for (const optional of [true, false]) {
            for (const allStates of [true, false]) {
                const variant = `${optional ? 'with' : 'without'} optional inputs, ${allStates ? 'all' : 'only the needed'} states of the devices`;
                const values = sampleValues(inputs, { typeIndex, optional, allStates }, needs);
                let xml;
                try {
                    xml = renderTemplate(ast, inputs, values);
                } catch (error) {
                    if (!(error instanceof RenderError)) {
                        throw error;
                    }
                    xml = null;
                    const message = `cannot be filled in (${variant}): ${error.message}`;
                    if (!seen.has(message)) {
                        seen.add(message);
                        errors.push({ path: 'blockly', message });
                    }
                }
                if (xml !== null) {
                    for (const error of checkXml(xml, 'blockly')) {
                        const message = `${error.message}, after filling in (${variant})`;
                        if (!seen.has(message)) {
                            seen.add(message);
                            errors.push({ path: error.path, message });
                        }
                    }
                }
            }
        }
    }
    return errors;
}

/**
 * Checks recipes together: every ID once only.
 *
 * @param {{ file: string, recipe: * }[]} entries
 * @returns {Map<string, { path: string, message: string }[]>} errors per file
 */
export function checkCatalog(entries) {
    const result = new Map();
    const byId = new Map();
    for (const { file, recipe, fileId, parseError } of entries) {
        const errors = parseError ? [{ path: 'file', message: parseError }] : checkRecipe(recipe, { fileId });
        result.set(file, errors);
        const id = typeof recipe?.id === 'string' ? recipe.id.toLowerCase() : null;
        if (id) {
            if (byId.has(id)) {
                errors.push({ path: 'id', message: `the ID "${recipe.id}" is used by ${byId.get(id)} as well` });
            } else {
                byId.set(id, file);
            }
        }
    }
    return result;
}
