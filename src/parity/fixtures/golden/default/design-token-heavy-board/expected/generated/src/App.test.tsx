import { render, screen } from "@testing-library/react";
import App from "./App.tsx";

test("renders generated Dark Mode Golden app", () => {
  render(<App />);

  expect(screen.getByTestId("generated-app")).toBeInTheDocument();
});
