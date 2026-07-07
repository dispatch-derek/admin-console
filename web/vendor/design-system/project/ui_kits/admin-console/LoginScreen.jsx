// Multi-user login screen — recreation of the Admin Console auth modal.
function LoginScreen({ onLogin }) {
  const { Button } = window.AnythingLLMAdminDesignSystem_4c97b8;
  const field = {
    boxSizing: "border-box", width: 300, height: 34, padding: "0 10px",
    fontFamily: "var(--font-sans)", fontSize: 14, color: "#e4e4e7",
    background: "#27272a", border: "none", borderRadius: 8, outline: "none",
  };
  return (
    <div style={{ position: "absolute", inset: 0, background: "#09090b", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.01em", color: "#fff", marginBottom: 8 }}>Admin Console</span>
      <form onSubmit={(e) => { e.preventDefault(); onLogin(); }} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ padding: "28px 0 36px", textAlign: "center", maxWidth: 300 }}>
          <h3 style={{ margin: 0, fontSize: 38, lineHeight: "28px", fontWeight: 500, color: "#fff" }}>Welcome Back</h3>
          <p style={{ margin: "18px 0 0", fontSize: 14, color: "#a1a1aa" }}>Sign in to your Admin Console instance.</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "0 48px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ fontSize: 14, color: "#d4d4d8" }}>Username</label>
            <input style={field} defaultValue="admin" />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ fontSize: 14, color: "#d4d4d8" }}>Password</label>
            <input type="password" style={field} defaultValue="password" />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24, padding: "36px 48px 0", width: 300, boxSizing: "content-box" }}>
          <Button variant="login" full type="submit">Login</Button>
          <button type="button" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#e4e4e7" }}>
            Forgot password? <b style={{ color: "#7dd3fc" }}>Reset</b>
          </button>
        </div>
      </form>
    </div>
  );
}
window.LoginScreen = LoginScreen;
