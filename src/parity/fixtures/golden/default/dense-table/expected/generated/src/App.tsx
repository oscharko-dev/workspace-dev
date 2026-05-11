import TransactionTable1 from "./pages/transactiontable";
import "./theme/tokens.css";

export default function App() {
  return (
    <div data-testid="generated-app" className="min-h-screen bg-[var(--color-background)] text-[var(--color-text)]">
      <TransactionTable1 />
    </div>
  );
}
