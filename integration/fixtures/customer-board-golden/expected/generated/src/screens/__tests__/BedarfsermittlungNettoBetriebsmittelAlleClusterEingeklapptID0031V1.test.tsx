import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@mui/material/styles";
import { axe } from "jest-axe";
import { MemoryRouter } from "react-router-dom";
import { appTheme } from "../../theme/theme";
import BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1Screen from "../Bedarfsermittlung_Netto_Betriebsmittel_alle_Cluster_eingeklappt_ID-003_1_v1";

const expectedTexts: string[] = [];
const expectedButtonLabels: string[] = [];
const clickableButtonLabels: string[] = [];
const expectedTextInputLabels: string[] = [];
const expectedSelectLabels: string[] = [];

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
        <BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1Screen />
      </MemoryRouter>
    </ThemeProvider>
  );
};

describe("BedarfsermittlungNettoBetriebsmittelAlleClusterEingeklapptID0031V1Screen", () => {
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
