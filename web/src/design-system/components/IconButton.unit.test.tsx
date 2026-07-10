// White-box unit tests for IconButton (REQ-F001-045). Complements IconButton.test.tsx (spec-level)
// by exercising: default shape/variant classes when omitted, the `size` -> inline width/height wiring
// (default 34 and a custom value), className merging, and the no-title branch.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IconButton } from '../index';

describe('IconButton (white-box)', () => {
  it('applies the default shape (square) and variant (default) classes when omitted', () => {
    render(<IconButton title="x" />);
    const btn = screen.getByTitle('x');
    expect(btn.className).toEqual(expect.stringContaining('square'));
    expect(btn.className).not.toEqual(expect.stringContaining('circle'));
    expect(btn.className).not.toEqual(expect.stringContaining('menu'));
  });

  it('applies the circle shape class when shape="circle"', () => {
    render(<IconButton title="x" shape="circle" />);
    expect(screen.getByTitle('x').className).toEqual(expect.stringContaining('circle'));
  });

  it('applies the menu variant class when variant="menu"', () => {
    render(<IconButton title="x" variant="menu" />);
    expect(screen.getByTitle('x').className).toEqual(expect.stringContaining('menu'));
  });

  it('defaults `size` to 34 (applied as inline width/height)', () => {
    render(<IconButton title="x" />);
    const btn = screen.getByTitle('x') as HTMLButtonElement;
    const defaultSize = 34;
    expect(parseInt(btn.style.width, 10)).toBe(defaultSize);
    expect(parseInt(btn.style.height, 10)).toBe(defaultSize);
  });

  it('wires a custom `size` to inline width/height', () => {
    const customSize = 48;
    render(<IconButton title="x" size={customSize} />);
    const btn = screen.getByTitle('x') as HTMLButtonElement;
    expect(parseInt(btn.style.width, 10)).toBe(customSize);
    expect(parseInt(btn.style.height, 10)).toBe(customSize);
  });

  it('merges a caller-supplied className with the internal classes', () => {
    render(<IconButton title="x" className="extra" />);
    expect(screen.getByTitle('x').className).toEqual(expect.stringContaining('extra'));
  });

  it('has no `title` attribute when omitted', () => {
    render(<IconButton />);
    const btn = screen.getByRole('button');
    expect(btn).not.toHaveAttribute('title');
  });

  it('has type="button" (never submits an enclosing form)', () => {
    render(<IconButton title="x" />);
    expect(screen.getByTitle('x')).toHaveAttribute('type', 'button');
  });
});
