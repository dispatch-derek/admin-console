// F-005 first-class empty state (REQ-F005-024/036). Rendered when the catalog declares zero
// features (the expected reality until the customer-facing app ships) — this is NOT an error, so it
// is a role="status" panel, never an ErrorBanner.

export function EmptyFeaturesState() {
  return (
    <div role="status" className="feature-empty">
      <p className="feature-empty-title">No features are defined for this install yet.</p>
      <p className="feature-empty-help">
        Features declared by the customer-facing codebase will appear here for you to enable or
        disable for this install.
      </p>
    </div>
  );
}
