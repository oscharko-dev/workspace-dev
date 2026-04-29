import { render, screen } from "@testing-library/react";
import App from "./App.tsx";

test("renders generated Pattern Extraction Board app", () => {
  render(<App />);

  expect(screen.getByTestId("generated-app")).toBeInTheDocument();
});
