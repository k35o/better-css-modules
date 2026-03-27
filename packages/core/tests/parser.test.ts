import { describe, it, expect } from 'vitest';
import { extractClassNames } from '../src/parser.js';

describe('extractClassNames', () => {
  it('extracts a single class', () => {
    const css = '.container { color: red; }';
    expect(extractClassNames(css)).toEqual(['container']);
  });

  it('extracts multiple classes', () => {
    const css = `.container { color: red; }
.header { font-size: 16px; }
.footer { margin: 0; }`;
    expect(extractClassNames(css)).toEqual(['container', 'footer', 'header']);
  });

  it('extracts hyphenated class names', () => {
    const css = '.primary-btn { color: blue; }';
    expect(extractClassNames(css)).toEqual(['primary-btn']);
  });

  it('extracts classes from nested selectors', () => {
    const css = '.container .inner { color: red; }';
    expect(extractClassNames(css)).toEqual(['container', 'inner']);
  });

  it('extracts classes from comma-separated selectors', () => {
    const css = '.foo, .bar { color: red; }';
    expect(extractClassNames(css)).toEqual(['bar', 'foo']);
  });

  it('deduplicates class names', () => {
    const css = `.container { color: red; }
.container:hover { color: blue; }`;
    expect(extractClassNames(css)).toEqual(['container']);
  });

  it('returns an empty array for empty CSS', () => {
    expect(extractClassNames('')).toEqual([]);
  });

  it('returns an empty array when there are no class selectors', () => {
    const css = 'div { color: red; }';
    expect(extractClassNames(css)).toEqual([]);
  });

  it('correctly extracts class names before pseudo-classes', () => {
    const css = '.btn:hover { color: red; } .btn:focus { outline: none; }';
    expect(extractClassNames(css)).toEqual(['btn']);
  });
});
