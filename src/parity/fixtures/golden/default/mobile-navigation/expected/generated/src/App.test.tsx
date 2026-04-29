import { render, screen } from "@testing-library/react";
import App from "./App.tsx";

test("renders generated Mobile Banking Navigation Board app", () => {
  render(<App />);

  expect(screen.getByTestId("generated-app")).toBeInTheDocument();
});
