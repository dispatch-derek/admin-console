// Renders the BFF { message } UNCHANGED (REQ-097a). The console never rewrites upstream error
// text; it prints exactly what the API returned.

interface ErrorBannerProps {
  message: string | null | undefined;
}

export function ErrorBanner({ message }: ErrorBannerProps) {
  if (!message) return null;
  return (
    <div role="alert" className="ac-error-banner">
      {message}
    </div>
  );
}
