// F-002 customer-wide baseline surface (REQ-F002-029): the app's first above-workspaces settings
// home. Stateful shell owning the fetches and the preview → confirm → apply flow; presentational
// children receive data + callbacks. The persistent native-default advisory (REQ-F002-060) renders
// unconditionally at the top, in every page state. Engine-free: talks only to /api/baseline-prompt*.

import { useCallback, useEffect, useState } from 'react';
import {
  applyBaselinePrompt,
  clearBaselinePrompt,
  getBaselinePreview,
  getBaselinePrompt,
  getBaselineStatus,
  putBaselinePrompt,
} from '../../api/client';
import type {
  BaselineApplyResult,
  BaselinePreview,
  BaselinePrompt,
  BaselineStatusView,
  OperatorMode,
  OverrideResolution,
} from '../../api/types';
import { ErrorBanner } from '../../components/ErrorBanner';
import { NativeDefaultAdvisory } from './NativeDefaultAdvisory';
import { BaselineEditor } from './BaselineEditor';
import { BaselineStatusList } from './BaselineStatusList';
import { BaselinePreviewApply } from './BaselinePreviewApply';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong.';
}

export function BaselinePromptPage() {
  const [baseline, setBaseline] = useState<BaselinePrompt | null>(null);
  const [status, setStatus] = useState<BaselineStatusView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  const [editorBusy, setEditorBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [mode, setMode] = useState<OperatorMode>('prepend');
  const [preview, setPreview] = useState<BaselinePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, OverrideResolution>>({});

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [result, setResult] = useState<BaselineApplyResult | null>(null);

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      setStatus(await getBaselineStatus());
    } catch (err) {
      setStatusError(errorMessage(err));
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const loadBaseline = useCallback(async () => {
    try {
      setBaseline(await getBaselinePrompt());
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void loadBaseline();
    void refreshStatus();
  }, [loadBaseline, refreshStatus]);

  // A change to the baseline text or apply mode invalidates a loaded preview (REQ-F002-055): the
  // confirmToken no longer matches the current snapshot, so force a re-preview.
  const invalidatePreview = useCallback(() => {
    setPreview(null);
    setPreviewError(null);
    setOverrides({});
    setResult(null);
  }, []);

  const handleSave = useCallback(
    async (text: string) => {
      setEditorBusy(true);
      setSaveError(null);
      setSaved(false);
      try {
        setBaseline(await putBaselinePrompt(text));
        setSaved(true);
        invalidatePreview();
        await refreshStatus();
      } catch (err) {
        setSaveError(errorMessage(err));
      } finally {
        setEditorBusy(false);
      }
    },
    [invalidatePreview, refreshStatus],
  );

  const handleClear = useCallback(async () => {
    setEditorBusy(true);
    setSaveError(null);
    setSaved(false);
    try {
      setBaseline(await clearBaselinePrompt());
      invalidatePreview();
      await refreshStatus();
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      setEditorBusy(false);
    }
  }, [invalidatePreview, refreshStatus]);

  const handleModeChange = useCallback(
    (next: OperatorMode) => {
      setMode(next);
      invalidatePreview();
    },
    [invalidatePreview],
  );

  const handlePreview = useCallback(async () => {
    setPreviewing(true);
    setPreviewError(null);
    setResult(null);
    setOverrides({});
    try {
      setPreview(await getBaselinePreview(mode));
    } catch (err) {
      setPreview(null);
      setPreviewError(errorMessage(err));
    } finally {
      setPreviewing(false);
    }
  }, [mode]);

  const handleOverrideChange = useCallback(
    (workspaceId: string, resolution: OverrideResolution) => {
      setOverrides((prev) => ({ ...prev, [workspaceId]: resolution }));
    },
    [],
  );

  const handleApply = useCallback(
    async (typedConfirmation: string) => {
      if (!preview) return;
      setApplying(true);
      setApplyError(null);
      try {
        const overrideList = Object.entries(overrides).map(([workspaceId, resolution]) => ({
          workspaceId,
          resolution,
        }));
        const res = await applyBaselinePrompt({
          confirmToken: preview.confirmToken,
          // Send what the operator actually typed into the confirm dialog, not an echo of the
          // server-issued phrase, so the server-side phrase check validates real operator input.
          typedConfirmation,
          mode,
          ...(overrideList.length > 0 ? { overrides: overrideList } : {}),
        });
        setResult(res);
        setConfirmOpen(false);
        // The confirmToken is single-use; force a re-preview before another apply.
        setPreview(null);
        setOverrides({});
        await refreshStatus();
      } catch (err) {
        setApplyError(errorMessage(err));
      } finally {
        setApplying(false);
      }
    },
    [preview, overrides, mode, refreshStatus],
  );

  return (
    <div className="baseline-page">
      <NativeDefaultAdvisory />

      <ErrorBanner message={loadError} />

      <BaselineEditor
        baseline={baseline}
        busy={editorBusy}
        saved={saved}
        saveError={saveError}
        onSave={(text) => void handleSave(text)}
        onClear={() => void handleClear()}
      />

      <BaselineStatusList
        status={status}
        loading={statusLoading}
        error={statusError}
        onRefresh={() => void refreshStatus()}
      />

      <BaselinePreviewApply
        mode={mode}
        onModeChange={handleModeChange}
        preview={preview}
        previewing={previewing}
        previewError={previewError}
        onPreview={() => void handlePreview()}
        overrides={overrides}
        onOverrideChange={handleOverrideChange}
        confirmOpen={confirmOpen}
        onOpenConfirm={() => setConfirmOpen(true)}
        onCancelConfirm={() => setConfirmOpen(false)}
        applying={applying}
        applyError={applyError}
        onApply={(typed) => void handleApply(typed)}
        result={result}
        disabled={editorBusy}
      />
    </div>
  );
}
