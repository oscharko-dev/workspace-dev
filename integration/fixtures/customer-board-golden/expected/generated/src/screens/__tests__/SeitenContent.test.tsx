import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@mui/material/styles";
import { axe } from "jest-axe";
import { MemoryRouter } from "react-router-dom";
import { appTheme } from "../../theme/theme";
import SeitenContentScreen from "../SeitenContent";

const expectedTexts: string[] = [
  "Person",
  "Konkrete Bezeichnung des Investitionsobjekts",
  "Art des Investitionsobjekts",
  "Die MwSt. ist nicht Teil des Finanzierungsbedarfs.",
  "Höhe des Kaufpreises (Netto)",
  "Anfallender MwSt.-Satz bei Kauf"
];
const expectedButtonLabels: string[] = [
  "Abbrechen",
  "Bedarf anlegen"
];
const clickableButtonLabels: string[] = [
  "Abbrechen",
  "Bedarf anlegen"
];
const expectedTextInputLabels: string[] = [
  "Konkrete Bezeichnung des Investitionsobjekts",
  "Höhe des Kaufpreises (Netto)",
  "Höhe der Nebenkosten (Brutto)",
  "Interner Vermerk"
];
const expectedSelectLabels: string[] = [
  "Person",
  "Art des Investitionsobjekts",
  "Anfallender MwSt.-Satz bei Kauf"
];

const normalizeTextForAssertion = (value: string): string => {
  return value.replace(/\s+/g, " ").trim();
};

const expectTextToBePresent = ({ container, expectedText }: { container: HTMLElement; expectedText: string }): void => {
  const normalizedExpectedText = normalizeTextForAssertion(expectedText);
  if (normalizedExpectedText.length === 0) {
    return;
  }
  const normalizedContainerText = normalizeTextForAssertion(container.textContent ?? "");
  expect(normalizedContainerText).toContain(normalizedExpectedText);
};

const axeConfig = {
  rules: {
    "heading-order": { enabled: false },
    "landmark-banner-is-top-level": { enabled: false }
  }
} as const;

const renderScreen = () => {
  return render(
    <ThemeProvider theme={appTheme} defaultMode="system" noSsr>
      <MemoryRouter>
        <SeitenContentScreen />
      </MemoryRouter>
    </ThemeProvider>
  );
};

describe("SeitenContentScreen", () => {
  it("renders without crashing", () => {
    const { container } = renderScreen();
    expect(container.firstChild).not.toBeNull();
  });

  it("renders representative text content", () => {
    const { container } = renderScreen();
    for (const expectedText of expectedTexts) {
      expectTextToBePresent({ container, expectedText });
    }
  });

  it("keeps representative controls interactive", async () => {
    renderScreen();
    const user = userEvent.setup();

    for (const buttonLabel of expectedButtonLabels) {
      expect(screen.getAllByRole("button", { name: buttonLabel }).length).toBeGreaterThan(0);
    }

    for (const buttonLabel of clickableButtonLabels) {
      const buttons = screen.getAllByRole("button", { name: buttonLabel });
      expect(buttons.length).toBeGreaterThan(0);
      await user.click(buttons[0]);
    }

    for (const inputLabel of expectedTextInputLabels) {
      const controls = screen.getAllByLabelText(inputLabel);
      expect(controls.length).toBeGreaterThan(0);
      const control = controls[0];
      if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
        await user.clear(control);
        await user.type(control, "x");
      }
    }

    for (const selectLabel of expectedSelectLabels) {
      const selects = screen.getAllByRole("combobox", { name: selectLabel });
      expect(selects.length).toBeGreaterThan(0);
    }
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = renderScreen();
    const results = await axe(container, axeConfig);
    expect(results).toHaveNoViolations();
  });
});
