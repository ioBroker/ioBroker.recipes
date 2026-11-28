/**
 * Placeholders in the Blockly XML of a recipe.
 *
 * The engine has no dependencies, so that ioBroker.javascript can use the very same code to apply a
 * recipe. The syntax is described in README.md ("Placeholders").
 *
 *   {{path}}                         a value, XML escaped
 *   {{#each name}} ... {{/each}}     once per item of an input with "multiple": true
 *   {{#if cond}} ... {{else}} ... {{/if}}
 *
 * A path is `name`, `name.PROPERTY` or `@index`. A condition is a path, or a path compared with a text:
 * `light.type == "dimmer"`, `mode != "eco"`.
 */

/** Names of inputs and properties */
const IDENT = '[A-Za-z_][A-Za-z0-9_]*';
const PATH = `(?:@index|${IDENT}(?:\\.${IDENT})?)`;
const PATH_RE = new RegExp(`^${PATH}$`);
const CONDITION_RE = new RegExp(`^(${PATH})(?:\\s*(==|!=)\\s*"([^"]*)")?$`);
const EACH_RE = new RegExp(`^#each\\s+(${IDENT})$`);
const IF_RE = /^#if\s+(.+)$/;
const TAG_RE = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** A state of a device is named in upper case, like the type-detector does: SET, ACTUAL, ON_SET */
export const STATE_NAME_RE = /^[A-Z][A-Z0-9_]*$/;

/** Line and column (both counted from 1) of an offset in a text */
export function locate(text, offset) {
    const before = text.slice(0, offset);
    const lines = before.split('\n');
    return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

/** A template that cannot be parsed */
export class TemplateError extends Error {
    /**
     * @param {string} message what is wrong
     * @param {string} text the template
     * @param {number} offset where in the template
     */
    constructor(message, text, offset) {
        const { line, column } = locate(text, offset);
        super(`line ${line}, column ${column}: ${message}`);
        this.name = 'TemplateError';
        this.line = line;
        this.column = column;
    }
}

/** A template that cannot be rendered with the given values */
export class RenderError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RenderError';
    }
}

/**
 * Splits a path like `light.SET` into its parts.
 *
 * @param {string} text the path
 * @returns {{ name: string, prop?: string, index?: true }}
 */
function parsePath(text) {
    if (text === '@index') {
        return { index: true, name: '@index' };
    }
    const [name, prop] = text.split('.');
    return prop ? { name, prop } : { name };
}

/** The text of a path again, for messages */
export function pathText(path) {
    return path.index ? '@index' : path.prop ? `${path.name}.${path.prop}` : path.name;
}

/**
 * Parses a template into a tree of nodes:
 * `{ type: 'text', value }`, `{ type: 'value', path, offset }`,
 * `{ type: 'each', name, offset, body }`, `{ type: 'if', condition, offset, then, else }`.
 *
 * @param {string} text the template
 * @returns {{ type: 'root', children: object[], text: string }}
 */
export function parseTemplate(text) {
    const root = { type: 'root', children: [], text };
    // the open blocks; the last one receives the nodes
    const stack = [{ node: root, children: root.children }];
    let last = 0;

    for (const match of text.matchAll(TAG_RE)) {
        const offset = match.index;
        const tag = match[1];
        const current = stack[stack.length - 1];
        if (offset > last) {
            current.children.push({ type: 'text', value: text.slice(last, offset) });
        }
        last = offset + match[0].length;

        if (tag.startsWith('#each')) {
            const each = tag.match(EACH_RE);
            if (!each) {
                throw new TemplateError(`"{{${tag}}}" must name one input, like {{#each light}}`, text, offset);
            }
            const node = { type: 'each', name: each[1], offset, body: [] };
            current.children.push(node);
            stack.push({ node, children: node.body });
        } else if (tag.startsWith('#if')) {
            const condition = (tag.match(IF_RE)?.[1] || '').trim().match(CONDITION_RE);
            if (!condition) {
                throw new TemplateError(
                    `"{{${tag}}}" is no valid condition: use {{#if name}}, {{#if name.STATE}} or {{#if name == "text"}}`,
                    text,
                    offset,
                );
            }
            const node = {
                type: 'if',
                condition: { path: parsePath(condition[1]), op: condition[2], literal: condition[3] },
                offset,
                then: [],
                else: null,
            };
            current.children.push(node);
            stack.push({ node, children: node.then });
        } else if (tag === 'else') {
            if (current.node.type !== 'if' || current.node.else) {
                throw new TemplateError('{{else}} without {{#if}}', text, offset);
            }
            current.node.else = [];
            current.children = current.node.else;
        } else if (tag === '/each' || tag === '/if') {
            const expected = tag.slice(1);
            if (current.node.type !== expected) {
                const open = current.node.type === 'root' ? 'nothing' : `{{#${current.node.type}}}`;
                throw new TemplateError(`{{${tag}}} closes ${open}`, text, offset);
            }
            stack.pop();
        } else if (PATH_RE.test(tag)) {
            current.children.push({ type: 'value', path: parsePath(tag), offset });
        } else {
            throw new TemplateError(`"{{${tag}}}" is no placeholder`, text, offset);
        }
    }
    if (stack.length > 1) {
        const open = stack[stack.length - 1].node;
        throw new TemplateError(`{{#${open.type}}} is not closed`, text, open.offset);
    }
    if (last < text.length) {
        root.children.push({ type: 'text', value: text.slice(last) });
    }
    return root;
}

const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

/** Escapes a text for XML, both for element content and attribute values */
export function escapeXml(text) {
    return String(text).replace(/[&<>"']/g, char => XML_ESCAPES[char]);
}

/** Is a value given at all? `false` and `0` are values, an empty text or list is none */
function isDefined(value) {
    return value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && !value.length);
}

/**
 * The text of a value of an input, as it goes into the XML (not yet escaped).
 *
 * @param {object} input the definition of the input
 * @param {*} value its value
 */
function valueText(input, value) {
    switch (input.type) {
        case 'boolean':
            // the value of the Blockly block "logic_boolean"
            return value ? 'TRUE' : 'FALSE';
        case 'device':
            return value.id;
        default:
            return String(value);
    }
}

/**
 * Resolves a path to the value it stands for.
 *
 * @returns {{ defined: boolean, value: *, text?: string }} `text` only for a defined single value
 */
function resolve(path, ctx) {
    if (path.index) {
        if (ctx.index === undefined) {
            throw new RenderError('{{@index}} is only known inside {{#each}}');
        }
        return { defined: true, value: ctx.index, text: String(ctx.index) };
    }
    const input = ctx.inputs[path.name];
    if (!input) {
        throw new RenderError(`there is no input "${path.name}"`);
    }
    const inLoop = Object.prototype.hasOwnProperty.call(ctx.loops, path.name);
    const value = inLoop ? ctx.loops[path.name] : ctx.values[path.name];
    const list = Array.isArray(value);

    if (!path.prop) {
        if (!isDefined(value)) {
            return { defined: false, value };
        }
        return { defined: true, value, text: list ? undefined : valueText(input, value) };
    }
    const prop = path.prop;
    if (prop === 'count') {
        const count = list ? value.length : 0;
        return { defined: true, value: count, text: String(count) };
    }
    if (!isDefined(value) || list) {
        return { defined: false, value: undefined };
    }
    let result;
    if (STATE_NAME_RE.test(prop)) {
        result = value.states?.[prop];
    } else if (prop === 'id' || prop === 'name' || prop === 'type') {
        result = value[prop];
    } else if (prop === 'hour' || prop === 'minute') {
        const [hour, minute] = String(value).split(':');
        // without leading zeros, so they can go into a cron expression
        result = String(parseInt(prop === 'hour' ? hour : minute, 10));
    } else {
        throw new RenderError(`"${prop}" is no property of {{${path.name}}}`);
    }
    return isDefined(result) ? { defined: true, value: result, text: String(result) } : { defined: false, value: result };
}

/** Is a condition true? */
function test(condition, ctx) {
    const resolved = resolve(condition.path, ctx);
    if (!condition.op) {
        return resolved.defined && resolved.value !== false;
    }
    const text = resolved.defined ? (resolved.text ?? '') : '';
    return condition.op === '==' ? text === condition.literal : text !== condition.literal;
}

const XML_TOKEN_RE =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(\/?)([A-Za-z_][\w.:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;

/**
 * The elements at the top level of a piece of XML.
 *
 * @param {string} xml the piece
 * @returns {{ elements: { name: string, start: number, end: number, closeStart: number, selfClosing: boolean, children: string[] }[], text: boolean }}
 *   `closeStart` is where the closing tag begins, `children` the names of the direct child elements,
 *   `text` whether there is text other than white space at the top level
 */
export function topLevelElements(xml) {
    const elements = [];
    let depth = 0;
    let current = null;
    let last = 0;
    let text = false;

    for (const match of xml.matchAll(XML_TOKEN_RE)) {
        if (depth === 0 && xml.slice(last, match.index).trim()) {
            text = true;
        }
        last = match.index + match[0].length;
        const [token, closing, name, , selfClose] = match;
        if (!name) {
            // comment, CDATA or processing instruction
            continue;
        }
        if (closing) {
            depth--;
            if (depth === 0 && current) {
                current.closeStart = match.index;
                current.end = last;
                elements.push(current);
                current = null;
            }
        } else if (selfClose) {
            if (depth === 0) {
                elements.push({
                    name,
                    start: match.index,
                    end: last,
                    closeStart: match.index + token.length - 2,
                    selfClosing: true,
                    children: [],
                });
            } else if (depth === 1 && current) {
                current.children.push(name);
            }
        } else {
            if (depth === 0) {
                current = { name, start: match.index, children: [], selfClosing: false };
            } else if (depth === 1 && current) {
                current.children.push(name);
            }
            depth++;
        }
    }
    if (xml.slice(last).trim()) {
        text = true;
    }
    return { elements, text };
}

/** The piece is exactly one `<block>` element */
function singleBlock(xml) {
    const { elements, text } = topLevelElements(xml);
    return !text && elements.length === 1 && elements[0].name === 'block' ? elements[0] : null;
}

/**
 * Links blocks into a sequence, as Blockly stores statements one after another: the second block goes
 * into a `<next>` of the first one, and so on.
 *
 * @param {string[]} blocks one `<block>` element each
 */
function chainBlocks(blocks) {
    let result = '';
    for (let i = blocks.length - 1; i >= 0; i--) {
        const xml = blocks[i];
        if (!result) {
            result = xml;
            continue;
        }
        const block = singleBlock(xml);
        if (block.children.includes('next')) {
            throw new RenderError('a block that {{#each}} repeats must not have a <next> of its own');
        }
        result = block.selfClosing
            ? `${xml.slice(0, block.closeStart)}><next>${result}</next></block>`
            : `${xml.slice(0, block.closeStart)}<next>${result}</next>${xml.slice(block.closeStart)}`;
    }
    return result;
}

function renderNodes(nodes, ctx) {
    let out = '';
    for (const node of nodes) {
        if (node.type === 'text') {
            out += node.value;
        } else if (node.type === 'value') {
            const resolved = resolve(node.path, ctx);
            if (!resolved.defined) {
                throw new RenderError(`{{${pathText(node.path)}}} has no value`);
            }
            if (resolved.text === undefined) {
                throw new RenderError(`{{${node.path.name}}} is a list: use it inside {{#each ${node.path.name}}}`);
            }
            out += escapeXml(resolved.text);
        } else if (node.type === 'if') {
            const branch = test(node.condition, ctx) ? node.then : node.else;
            if (branch) {
                out += renderNodes(branch, ctx);
            }
        } else if (node.type === 'each') {
            const items = ctx.values[node.name];
            if (!ctx.inputs[node.name]) {
                throw new RenderError(`there is no input "${node.name}"`);
            }
            if (items !== undefined && items !== null && !Array.isArray(items)) {
                throw new RenderError(`{{#each ${node.name}}} needs a list`);
            }
            const parts = (items || [])
                .map((item, index) =>
                    renderNodes(node.body, { ...ctx, loops: { ...ctx.loops, [node.name]: item }, index }),
                )
                .filter(part => part.trim());
            out += parts.length > 1 && parts.every(part => singleBlock(part.trim()))
                ? chainBlocks(parts.map(part => part.trim()))
                : parts.join('');
        }
    }
    return out;
}

/**
 * Replaces the placeholders of a template.
 *
 * Values, by type of the input: `device` an object `{ id, name, type, states: { SET: '<state id>', ... } }`
 * (a list of them for "multiple"), `state` the ID of the state (a list for "multiple"), `number` and
 * `duration` (seconds) a number, `boolean` true or false, `string`, `select` and `time` ("HH:MM") a text.
 * An input without value is `undefined`.
 *
 * @param {string | object} template the template, or what parseTemplate() made of it
 * @param {Record<string, object>} inputs the inputs of the recipe
 * @param {Record<string, *>} values the value of every input
 * @returns {string} the XML
 */
export function renderTemplate(template, inputs, values) {
    const ast = typeof template === 'string' ? parseTemplate(template) : template;
    return renderNodes(ast.children, { inputs, values: values || {}, loops: {}, index: undefined });
}
