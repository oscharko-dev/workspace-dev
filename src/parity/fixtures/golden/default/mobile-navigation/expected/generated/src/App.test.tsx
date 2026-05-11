import { render } from "@testing-library/react";
import App from "./App.tsx";

test("renders generated Mobile Banking Navigation Board app", () => {
  const { container } = render(<App />);

  expect(container.querySelector('[data-testid="generated-app"]')).not.toBeNull();
});
