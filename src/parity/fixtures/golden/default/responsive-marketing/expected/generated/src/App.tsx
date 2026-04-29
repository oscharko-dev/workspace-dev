import HomeDesktop1 from "./pages/home-desktop";
import "./theme/tokens.css";

export default function App() {
  return (
    <div data-testid="generated-app" className="min-h-screen bg-[var(--color-background)] text-[var(--color-text)]">
      <HomeDesktop1 />
    </div>
  );
}
