import { render, screen } from "@testing-library/react";
import App from "./App.tsx";

test("renders generated Login MFA View Board app", () => {
  render(<App />);

  expect(screen.getByTestId("generated-app")).toBeInTheDocument();
});
