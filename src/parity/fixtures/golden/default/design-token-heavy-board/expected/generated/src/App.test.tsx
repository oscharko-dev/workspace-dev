import { render, screen } from "@testing-library/react";
import App from "./App.tsx";

test("renders generated Token Heavy Risk Operations Board app", () => {
  render(<App />);

  expect(screen.getByTestId("generated-app")).toBeInTheDocument();
});
