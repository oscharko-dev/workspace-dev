import DashboardLight1 from "./pages/dashboard-light";
import DashboardDark2 from "./pages/dashboard-dark";
import "./theme/tokens.css";

export default function App() {
  return (
    <div data-testid="generated-app" className="min-h-screen bg-[var(--color-background)] text-[var(--color-text)]">
      <DashboardLight1 />
      <DashboardDark2 />
    </div>
  );
}
