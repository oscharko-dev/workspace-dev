import Profile1 from "./pages/profile";
import "./theme/tokens.css";

export default function App() {
  return (
    <div data-testid="generated-app" className="min-h-screen bg-[var(--color-background)] text-[var(--color-text)]">
      <Profile1 />
    </div>
  );
}
