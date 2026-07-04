// services/verify.ts — verifiedWrite (REQ-028, REQ-092a).
// Pure module (no config/db imports), so ordinary static imports are safe here.

import { describe, it, expect, vi } from 'vitest';
import { verifiedWrite } from '../../src/services/verify.js';
import { AppError } from '../../src/server/errors.js';

describe('verifiedWrite (REQ-028)', () => {
  it('returns the re-read state when confirm() is true', async () => {
    const rereadState = { slug: 'ws-1', name: 'Updated' };
    const write = vi.fn().mockResolvedValue(undefined);
    const reread = vi.fn().mockResolvedValue(rereadState);
    const confirm = vi.fn().mockReturnValue(true);

    const result = await verifiedWrite({ write, reread, confirm });

    expect(result).toBe(rereadState);
  });

  it('calls write() before reread(), and passes reread()\'s result to confirm()', async () => {
    const order: string[] = [];
    const rereadState = { value: 42 };
    const write = vi.fn().mockImplementation(async () => {
      order.push('write');
    });
    const reread = vi.fn().mockImplementation(async () => {
      order.push('reread');
      return rereadState;
    });
    const confirm = vi.fn().mockImplementation((state: unknown) => {
      order.push('confirm');
      expect(state).toBe(rereadState); // confirm() receives exactly what reread() returned
      return true;
    });

    await verifiedWrite({ write, reread, confirm });

    expect(order).toEqual(['write', 'reread', 'confirm']);
    expect(write).toHaveBeenCalledTimes(1);
    expect(reread).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('throws AppError(409) with the default message when confirm() is false', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const reread = vi.fn().mockResolvedValue({ ok: false });
    const confirm = vi.fn().mockReturnValue(false);

    const promise = verifiedWrite({ write, reread, confirm });

    await expect(promise).rejects.toBeInstanceOf(AppError);
    await expect(promise.catch((e) => e)).resolves.toMatchObject({
      status: 409,
      message: 'could not confirm the change was saved',
    });
  });

  it('throws AppError(409) with a custom onUnconfirmed message when provided', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const reread = vi.fn().mockResolvedValue({ ok: false });
    const confirm = vi.fn().mockReturnValue(false);

    const promise = verifiedWrite({
      write,
      reread,
      confirm,
      onUnconfirmed: 'the workspace name did not change',
    });

    await expect(promise.catch((e) => e)).resolves.toMatchObject({
      status: 409,
      message: 'the workspace name did not change',
    });
  });

  it('still calls write() and reread() even though it ultimately throws', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const reread = vi.fn().mockResolvedValue({ ok: false });
    const confirm = vi.fn().mockReturnValue(false);

    await verifiedWrite({ write, reread, confirm }).catch(() => undefined);

    expect(write).toHaveBeenCalledTimes(1);
    expect(reread).toHaveBeenCalledTimes(1);
  });

  it('propagates a rejection from write() without calling reread() or confirm()', async () => {
    const boom = new Error('engine unreachable');
    const write = vi.fn().mockRejectedValue(boom);
    const reread = vi.fn();
    const confirm = vi.fn();

    await expect(verifiedWrite({ write, reread, confirm })).rejects.toBe(boom);
    expect(reread).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });
});
