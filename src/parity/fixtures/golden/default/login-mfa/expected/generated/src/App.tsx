import Login1 from "./pages/login";
import MFA2 from "./pages/mfa";
import "./theme/tokens.css";

export default function App() {
  return (
    <div data-testid="generated-app" className="min-h-screen bg-[var(--color-background)] text-[var(--color-text)]">
      <Login1 />
      <MFA2 />
    </div>
  );
}
