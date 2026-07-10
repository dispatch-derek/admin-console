import { test, expect } from '@playwright/test';
import { installApiMocks } from '../fixtures/mockApi';
import { pageTitle } from '../fixtures/helpers';

// Journey: opening and dismissing the DS `Modal`-backed `DangerConfirm` dialog (REQ-F001-020/045),
// reached via the Workspaces screen's "Delete" action. This is the one thing jsdom/RTL structurally
// cannot prove: real overlay stacking (the backdrop actually renders ABOVE the underlying content,
// not just present in the DOM) and that the dialog is a genuine top-layer element a real user could
// not click through.

test.describe('DangerConfirm (DS Modal) overlay + dismiss', () => {
  test('opens above the page content and dismisses via Cancel', async ({ page }) => {
    await installApiMocks(page);
    await page.goto('/');
    await page.getByText('Workspaces', { exact: true }).click();
    await expect(pageTitle(page, 'Workspaces')).toBeVisible();

    const workspaceRow = page.getByText('E2E Test Workspace', { exact: true });
    await expect(workspaceRow).toBeVisible();

    const deleteButton = page.getByRole('button', { name: 'Delete' });
    const deleteButtonBox = (await deleteButton.boundingBox())!;
    await deleteButton.click();

    const dialog = page.getByRole('dialog', { name: 'Delete workspace' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog.getByText('E2E Test Workspace')).toBeVisible(); // names the exact target

    // Real stacking-order proof: the point where the dialog's own heading renders must hit-test to
    // an element INSIDE the dialog, not to whatever sits behind the backdrop -- i.e. the overlay is
    // genuinely on top, not just co-present in the DOM.
    const dialogHeadingBox = await dialog.getByRole('heading', { name: 'Delete workspace' }).boundingBox();
    expect(dialogHeadingBox).not.toBeNull();
    const elementAtPoint = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return el ? el.closest('[role="dialog"]') !== null : false;
      },
      [dialogHeadingBox!.x + dialogHeadingBox!.width / 2, dialogHeadingBox!.y + dialogHeadingBox!.height / 2] as const,
    );
    expect(elementAtPoint).toBe(true);

    // The underlying Delete button's own screen position is now covered by the overlay: hit-testing
    // that exact point no longer resolves to the button itself (real click-through prevention, not
    // just DOM co-presence).
    const coveredByOverlay = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return el ? el.closest('[role="dialog"]') !== null || el.closest('button')?.textContent !== 'Delete' : true;
      },
      [deleteButtonBox.x + deleteButtonBox.width / 2, deleteButtonBox.y + deleteButtonBox.height / 2] as const,
    );
    expect(coveredByOverlay).toBe(true);

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible();
  });
});
