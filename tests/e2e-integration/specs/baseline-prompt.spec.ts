// F-002 Customer-Wide Baseline System Prompt -- the one critical, cross-component journey this
// suite covers end-to-end through the REAL running app (fake-engine HTTP stub <- BFF dev server
// <- web dev server <- real Chromium), exercising the full staff login FSM plus the baseline
// define -> preview -> danger-gated apply -> per-workspace result flow, per
// specs/F-002-customer-system-prompt.md rev 9 and docs/design/ux/F-002-baseline-prompt.md.
//
// Deliberately ONE test: login (full first-boot MFA bootstrap) is expensive and this journey is
// inherently sequential (baseline state carries from step to step), so splitting it into several
// independent `test()` blocks would just re-pay the login cost for no added coverage. Every
// per-requirement edge case already has bff-level route/unit coverage (bff/test/routes/
// baseline-prompt.*.test.ts); this suite exists to catch the seams those can't: real HTTP across
// two real dev servers, real cookies/CORS, and real rendered DOM.
//
// Covers (golden path):
//   - staff login through the full bootstrap FSM (password -> set-password -> TOTP enroll -> session)
//   - REQ-F002-029: the Baseline Prompt surface is reachable from top-level nav
//   - REQ-F002-060: the native-default advisory is present and persists across a save
//   - REQ-F002-015/016: define baseline ("not defined" -> saved with metadata)
//   - REQ-F002-019/030: mandatory pre-write preview with a real per-workspace diff
//   - REQ-F002-031/048: DangerConfirm typed-phrase gate using the server-issued confirmationPhrase
//   - REQ-F002-021/022: a real fan-out apply that writes through to the (fake) engine
//   - REQ-F002-022a/032: per-workspace outcomes rendered individually, not a single banner
// Plus one edge case:
//   - REQ-F002-048: a wrong typedConfirmation is rejected both client-side (the confirm button
//     never arms) and server-side (409, zero engine writes) -- verified via the fake engine's
//     debug patch-count endpoint so "no apply occurred" is asserted structurally, not by polling.

import { expect, test } from '@playwright/test';
import { loginAsBootstrapOperator } from '../fixtures/login.js';
import { FAKE_ENGINE_URL } from '../fixtures/env.js';

const BASELINE_TEXT = 'You are a concise, professional assistant for Acme Corp.';
const BASELINE_TEXT_V2 = 'You are a concise, professional assistant for Acme Corp. Be extra terse.';

interface PreviewBody {
  affectedCount: number;
  confirmToken: string;
  confirmationPhrase: string;
}

test('operator defines, previews, and applies a customer-wide baseline prompt; a mismatched confirmation is rejected', async ({
  page,
  request,
}) => {
  // --- login (full bootstrap FSM: password -> set-password -> TOTP enroll -> session) ---
  await loginAsBootstrapOperator(page);

  // --- REQ-F002-029: reachable from top-level nav, not bound to a workspace ---
  await page.getByRole('button', { name: 'Baseline Prompt' }).click();
  await expect(page.getByRole('heading', { name: 'Customer-wide Baseline Prompt', level: 1 })).toBeVisible();

  // --- REQ-F002-060: persistent native-default advisory, present before any baseline exists ---
  const advisory = page.getByRole('note');
  await expect(advisory).toContainText('Native Default System Prompt');
  await expect(advisory).toContainText('separate');

  // --- REQ-F002-015: "not defined" before any baseline is set ---
  await expect(page.getByText('Not yet defined')).toBeVisible();

  // --- REQ-F002-016: define the baseline (console-store write only, no engine write yet) ---
  const initialPatchCount = await patchCount(request);
  expect(initialPatchCount).toBe(0);

  await page.getByLabel('Baseline text').fill(BASELINE_TEXT);
  await page.getByRole('button', { name: 'Save baseline' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  // REQ-F002-060: the advisory is NOT a one-time toast -- still present after the save round-trip.
  await expect(advisory).toContainText('Native Default System Prompt');
  expect(await patchCount(request)).toBe(0); // defining the baseline issues zero engine writes

  // --- REQ-F002-024/026: both seeded workspaces show up as never-applied drift ---
  await expect(page.getByRole('row', { name: /Acme Support/ })).toContainText('Never applied');
  await expect(page.getByRole('row', { name: /Acme Sales/ })).toContainText('Never applied');

  // --- REQ-F002-019/020: mandatory pre-write preview mints a confirmToken + phrase ---
  const preview1 = await previewAndCapture(page);
  expect(preview1.affectedCount).toBe(2);

  // REQ-F002-019: a real per-workspace diff, not just a count -- assert specific rows, not a
  // collapsed summary. "Acme Support" already has a prompt (prepend mode composes baseline +
  // sentinel + its remainder); "Acme Sales" starts empty (composes to the baseline alone).
  const supportItem = page.locator('li.preview-diff', { hasText: 'Acme Support' });
  await expect(supportItem).toBeVisible();
  await expect(supportItem.locator('.diff-current')).toContainText('Answer only in French.');
  await expect(supportItem.locator('.diff-composed')).toContainText(BASELINE_TEXT);
  await expect(supportItem.locator('.diff-composed')).toContainText('Answer only in French.');

  const salesItem = page.locator('li.preview-diff', { hasText: 'Acme Sales' });
  await expect(salesItem).toBeVisible();
  await expect(salesItem.locator('.diff-composed')).toContainText(BASELINE_TEXT);

  // --- REQ-F002-030/031/048: apply is inert until a preview loaded; DangerConfirm typed-gate ---
  await page.getByRole('button', { name: 'Apply baseline' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('rewritten');
  await expect(dialog).toContainText('no native undo');

  const confirmButton = dialog.getByRole('button', { name: 'Apply baseline' });
  await expect(confirmButton).toBeDisabled(); // unarmed until the exact phrase is typed

  await dialog.getByRole('textbox').fill(preview1.confirmationPhrase);
  await expect(confirmButton).toBeEnabled();

  const applyResponse = page.waitForResponse(
    (res) => res.url().includes('/api/baseline-prompt/apply') && res.request().method() === 'POST',
  );
  await confirmButton.click();
  const applyRes = await applyResponse;
  expect(applyRes.status()).toBe(200);
  const applyBody = (await applyRes.json()) as { appliedCount: number; failedCount: number };
  expect(applyBody.appliedCount).toBe(2);
  expect(applyBody.failedCount).toBe(0);

  // --- REQ-F002-022a/032: per-workspace outcomes rendered individually -- never one banner ---
  const outcomeRegion = page.getByRole('status');
  await expect(outcomeRegion).toContainText('2 applied');
  const outcomeItems = outcomeRegion.locator('li');
  await expect(outcomeItems).toHaveCount(2);
  const supportOutcome = outcomeRegion.locator('li.outcome-applied', { hasText: 'Acme Support' });
  await expect(supportOutcome).toBeVisible();
  await expect(supportOutcome).toContainText('Applied');
  const salesOutcome = outcomeRegion.locator('li.outcome-applied', { hasText: 'Acme Sales' });
  await expect(salesOutcome).toBeVisible();

  // Confirms the apply really landed on the (fake) engine, not just in the BFF's response.
  expect(await patchCount(request)).toBe(2);

  // --- REQ-F002-013: re-sync after a baseline change so there is something to (mis-)apply below ---
  await page.getByLabel('Baseline text').fill(BASELINE_TEXT_V2);
  await page.getByRole('button', { name: 'Save baseline' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  const preview2 = await previewAndCapture(page);
  expect(preview2.affectedCount).toBeGreaterThan(0);

  // --- Edge case (REQ-F002-048): a WRONG typedConfirmation must not apply anything ---
  await page.getByRole('button', { name: 'Apply baseline' }).click();
  const dialog2 = page.getByRole('dialog');
  await expect(dialog2).toBeVisible();
  const confirmButton2 = dialog2.getByRole('button', { name: 'Apply baseline' });

  await dialog2.getByRole('textbox').fill('this is not the confirmation phrase');
  // Client-side gate: the confirm button never arms on a mismatched phrase, so the apply request
  // structurally cannot be sent from the UI.
  await expect(confirmButton2).toBeDisabled();
  const patchCountBeforeWrongAttempt = await patchCount(request);

  // Server-side gate (REQ-F002-048): even a direct, authenticated call to the apply route with a
  // valid confirmToken but the wrong typedConfirmation is rejected 409, and issues zero engine
  // writes -- the UI's disabled button is not the only thing standing between an operator and a
  // destructive fan-out.
  const directApply = await page.context().request.post('/api/baseline-prompt/apply', {
    data: {
      confirmToken: preview2.confirmToken,
      typedConfirmation: 'this is not the confirmation phrase',
      mode: 'prepend',
    },
  });
  expect(directApply.status()).toBe(409);
  const directApplyBody = (await directApply.json()) as { message: string };
  expect(directApplyBody.message).toMatch(/confirmation phrase/i);

  // No engine writes occurred from either the disabled UI control or the rejected direct call.
  expect(await patchCount(request)).toBe(patchCountBeforeWrongAttempt);

  await dialog2.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog2).toBeHidden();
});

async function patchCount(request: {
  get: (url: string) => Promise<{ json: () => Promise<{ patchCount: number }> }>;
}): Promise<number> {
  const res = await request.get(`${FAKE_ENGINE_URL}/__test__/patch-count`);
  const body = await res.json();
  return body.patchCount;
}

async function previewAndCapture(page: import('@playwright/test').Page): Promise<PreviewBody> {
  const responsePromise = page.waitForResponse(
    (res) => res.url().includes('/api/baseline-prompt/preview') && res.request().method() === 'GET',
  );
  await page.getByRole('button', { name: 'Preview changes' }).click();
  const res = await responsePromise;
  expect(res.status()).toBe(200);
  return (await res.json()) as PreviewBody;
}
