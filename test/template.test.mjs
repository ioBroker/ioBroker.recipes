import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { RenderError, TemplateError, escapeXml, parseTemplate, renderTemplate } from '../lib/template.mjs';

const lamp = (id, type = 'light', states = { SET: `${id}.SET` }) => ({ id, name: id, type, states });

describe('{{name}}', () => {
    it('puts in values of every type', () => {
        const inputs = {
            n: { type: 'number' },
            d: { type: 'duration' },
            b: { type: 'boolean' },
            f: { type: 'boolean' },
            s: { type: 'string' },
            t: { type: 'time' },
            o: { type: 'select', options: [] },
            st: { type: 'state' },
            dev: { type: 'device', deviceType: 'light' },
        };
        const values = { n: 1.5, d: 120, b: true, f: false, s: 'hi', t: '07:05', o: 'eco', st: 'a.0.b', dev: lamp('hm.0.l1') };
        const out = renderTemplate(
            '{{n}}|{{d}}|{{b}}|{{f}}|{{s}}|{{t}}|{{t.hour}}|{{t.minute}}|{{o}}|{{st}}|{{dev}}|{{dev.SET}}|{{dev.type}}',
            inputs,
            values,
        );
        assert.equal(out, '1.5|120|TRUE|FALSE|hi|07:05|7|5|eco|a.0.b|hm.0.l1|hm.0.l1.SET|light');
    });

    it('escapes for XML, in text and in attributes', () => {
        const inputs = { s: { type: 'string' } };
        const out = renderTemplate('<a b="{{s}}">{{s}}</a>', inputs, { s: `<"x" & 'y'>` });
        assert.equal(out, '<a b="&lt;&quot;x&quot; &amp; &apos;y&apos;&gt;">&lt;&quot;x&quot; &amp; &apos;y&apos;&gt;</a>');
        assert.equal(escapeXml('a&amp;b'), 'a&amp;amp;b', 'escaped twice, as a value is never XML');
    });

    it('fails for a value that is missing', () => {
        const inputs = { s: { type: 'string', optional: true }, dev: { type: 'device', deviceType: 'light' } };
        assert.throws(() => renderTemplate('{{s}}', inputs, {}), RenderError);
        assert.throws(() => renderTemplate('{{dev.ON_SET}}', inputs, { dev: lamp('l1') }), /has no value/);
        assert.throws(() => renderTemplate('{{nothing}}', inputs, {}), /there is no input "nothing"/);
    });
});

describe('{{#each}}', () => {
    const inputs = { light: { type: 'device', deviceType: ['light', 'dimmer'], multiple: true } };

    it('links repeated blocks with <next>, as Blockly stores statements', () => {
        const out = renderTemplate(
            '<statement name="DO0">{{#each light}}\n  <block type="control"><field name="OID">{{light.SET}}</field></block>\n{{/each}}</statement>',
            inputs,
            { light: [lamp('l1'), lamp('l2'), lamp('l3')] },
        );
        assert.equal(
            out,
            '<statement name="DO0"><block type="control"><field name="OID">l1.SET</field><next>' +
                '<block type="control"><field name="OID">l2.SET</field><next>' +
                '<block type="control"><field name="OID">l3.SET</field></block>' +
                '</next></block></next></block></statement>',
        );
    });

    it('links self-closing blocks too', () => {
        const out = renderTemplate('{{#each light}}<block type="x"/>{{/each}}', inputs, { light: [lamp('a'), lamp('b')] });
        assert.equal(out, '<block type="x"><next><block type="x"/></next></block>');
    });

    it('only repeats what is no single block, with {{@index}}', () => {
        const out = renderTemplate(
            '<mutation items="{{light.count}}"></mutation>{{#each light}}<value name="ADD{{@index}}"><block type="text"><field name="TEXT">{{light}}</field></block></value>{{/each}}',
            inputs,
            { light: [lamp('l1'), lamp('l2')] },
        );
        assert.equal(
            out,
            '<mutation items="2"></mutation>' +
                '<value name="ADD0"><block type="text"><field name="TEXT">l1</field></block></value>' +
                '<value name="ADD1"><block type="text"><field name="TEXT">l2</field></block></value>',
        );
    });

    it('renders nothing for an empty list', () => {
        assert.equal(renderTemplate('[{{#each light}}<block type="x"/>{{/each}}]', inputs, { light: [] }), '[]');
    });

    it('refuses to link a block that has a <next> of its own', () => {
        assert.throws(
            () => renderTemplate('{{#each light}}<block type="x"><next><block type="y"/></next></block>{{/each}}', inputs, { light: [lamp('a'), lamp('b')] }),
            /must not have a <next> of its own/,
        );
    });
});

describe('{{#if}}', () => {
    const inputs = {
        light: { type: 'device', deviceType: ['light', 'dimmer'], multiple: true },
        sensor: { type: 'state', optional: true },
        flag: { type: 'boolean' },
        mode: { type: 'select', options: [] },
    };

    it('takes the branch by the type and the states of each device', () => {
        const template =
            '{{#each light}}[{{#if light.ON_SET}}on:{{light.ON_SET}}{{else}}{{#if light.type == "dimmer"}}level:{{light.SET}}{{else}}switch:{{light.SET}}{{/if}}{{/if}}]{{/each}}';
        const out = renderTemplate(template, inputs, {
            light: [lamp('a'), lamp('b', 'dimmer'), lamp('c', 'dimmer', { SET: 'c.SET', ON_SET: 'c.ON' })],
        });
        assert.equal(out, '[switch:a.SET][level:b.SET][on:c.ON]');
    });

    it('knows whether an optional input is given, and what is false', () => {
        const template = '{{#if sensor}}s{{else}}-{{/if}}{{#if flag}}f{{else}}!f{{/if}}{{#if mode != "eco"}}x{{/if}}';
        assert.equal(renderTemplate(template, inputs, { sensor: 'a.b', flag: true, mode: 'eco' }), 'sf');
        assert.equal(renderTemplate(template, inputs, { flag: false, mode: 'comfort' }), '-!fx');
        assert.equal(renderTemplate(template, inputs, { sensor: '', flag: false, mode: 'eco' }), '-!f');
    });
});

describe('parse errors', () => {
    const cases = [
        ['{{#each}}', /must name one input/],
        ['{{#if}}x{{/if}}', /no valid condition/],
        ['{{#if a ==}}x{{/if}}', /no valid condition/],
        ['{{#if a}}x', /\{\{#if\}\} is not closed/],
        ['{{/each}}', /closes nothing/],
        ['{{#if a}}{{/each}}', /closes \{\{#if\}\}/],
        ['{{else}}', /\{\{else\}\} without \{\{#if\}\}/],
        ['{{#if a}}{{else}}{{else}}{{/if}}', /\{\{else\}\} without \{\{#if\}\}/],
        ['{{a b}}', /is no placeholder/],
        ['{{a.b.c}}', /is no placeholder/],
    ];
    for (const [template, message] of cases) {
        it(`rejects ${template}`, () => {
            assert.throws(() => parseTemplate(template), error => error instanceof TemplateError && message.test(error.message));
        });
    }

    it('names the line', () => {
        assert.throws(() => parseTemplate('<xml>\n  <a>\n  {{#if x}}\n</xml>'), /line 3, column 3/);
    });
});
