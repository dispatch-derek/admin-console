// Persistent, always-present advisory (REQ-F002-060): AnythingLLM's native instance-level Default
// System Prompt is a separate, console-unreachable setting (REQ-F002-004) that may also affect a
// workspace's assistant. The managed baseline does not account for it. Informational only — gates
// no action and issues no engine read/write. Not a toast, not dismissible: it renders whenever the
// baseline surface renders.

export function NativeDefaultAdvisory() {
  return (
    <div className="baseline-advisory" role="note">
      <span className="baseline-advisory-icon" aria-hidden="true">
        ⓘ
      </span>
      <div>
        <strong>Native Default System Prompt is separate and not managed here.</strong>
        <p>
          AnythingLLM has its own instance-level <em>Default System Prompt</em> that this console
          cannot read or write. It may also affect what a workspace&apos;s assistant sees, and the
          customer-wide baseline below does not account for it — a native default may exist
          invisibly beneath the baseline you manage here.
        </p>
      </div>
    </div>
  );
}
