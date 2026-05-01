import { render } from "@testing-library/react";
import App from "./App.tsx";

test("renders generated Account Opening Form Board app", () => {
  const { container } = render(<App />);

  expect(container.querySelector('[data-testid="generated-app"]')).not.toBeNull();
});
