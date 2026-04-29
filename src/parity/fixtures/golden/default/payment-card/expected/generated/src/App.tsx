import ProductList1 from "./pages/productlist";
import "./theme/tokens.css";

export default function App() {
  return (
    <div data-testid="generated-app" className="min-h-screen bg-[var(--color-background)] text-[var(--color-text)]">
      <ProductList1 />
    </div>
  );
}
