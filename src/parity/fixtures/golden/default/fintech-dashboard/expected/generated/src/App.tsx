import Dashboard1 from "./pages/dashboard";
import "./theme/tokens.css";

export default function App() {
  return (
    <div data-testid="generated-app" className="min-h-screen bg-[var(--color-background)] text-[var(--color-text)]">
      <Dashboard1 />
    </div>
  );
}
