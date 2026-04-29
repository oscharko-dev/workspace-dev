import UserList1 from "./pages/userlist";
import "./theme/tokens.css";

export default function App() {
  return (
    <div data-testid="generated-app" className="min-h-screen bg-[var(--color-background)] text-[var(--color-text)]">
      <UserList1 />
    </div>
  );
}
