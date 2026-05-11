import { render, screen } from "@testing-library/react";
import App from "./App.tsx";

test("renders the default Tailwind template shell", () => {
  render(<App />);

  expect(
    screen.getByRole("heading", {
      name: /React, TypeScript, Vite, and Tailwind ready for generated apps\./i,
    }),
  ).toBeInTheDocument();
  expect(screen.getByText("WorkspaceDev default template")).toBeInTheDocument();
  expect(screen.getByText("Components")).toBeInTheDocument();
});
