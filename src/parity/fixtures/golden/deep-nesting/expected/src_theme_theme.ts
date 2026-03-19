import { createTheme } from "@mui/material/styles";

export const appTheme = createTheme({
  cssVariables: true,
  colorSchemes: {
    light: {
      palette: {
      mode: "light",
      primary: { main: "#1c1f24" },
      secondary: { main: "#f7f9fa" },
      success: { main: "#268026" },
      warning: { main: "#D97706" },
      error: { main: "#DC2626" },
      info: { main: "#0288D1" },
      background: { default: "#f7f9fa", paper: "#f7f9fa" },
      text: { primary: "#1c1f24" },
      divider: "#1c1f241f",
      action: {
        active: "#1c1f248a",
        hover: "#1c1f240a",
        selected: "#1c1f2414",
        disabled: "#1c1f2442",
        disabledBackground: "#1c1f241f",
        focus: "#1c1f241f"
      }
    }
    },
    dark: {
      palette: {
      mode: "dark",
      primary: { main: "#898b8d" },
      secondary: { main: "#f7f9fa" },
      success: { main: "#499449" },
      warning: { main: "#d97706" },
      error: { main: "#e24949" },
      info: { main: "#0288d1" },
      background: { default: "#121212", paper: "#1e1e1e" },
      text: { primary: "#f5f7fb" },
      divider: "#f5f7fb1f",
      action: {
        active: "#f5f7fb8a",
        hover: "#898b8d0a",
        selected: "#898b8d14",
        disabled: "#f5f7fb42",
        disabledBackground: "#f5f7fb1f",
        focus: "#898b8d1f"
      }
    }
    }
  },
  shape: {
    borderRadius: 12
  },
  spacing: 8,
  typography: {
    fontFamily: "Inter, Roboto, Arial, sans-serif",
    h1: { fontSize: "2rem", fontWeight: 700, lineHeight: "2.5rem", fontFamily: "Inter" },
    h2: { fontSize: "1.75rem", fontWeight: 700, lineHeight: "2.25rem", fontFamily: "Inter" },
    h3: { fontSize: "1.125rem", fontWeight: 600, lineHeight: "1.5rem", fontFamily: "Inter" },
    h4: { fontSize: "1.125rem", fontWeight: 600, lineHeight: "1.5rem", fontFamily: "Inter" },
    h5: { fontSize: "1.125rem", fontWeight: 600, lineHeight: "1.5rem", fontFamily: "Inter" },
    h6: { fontSize: "1.125rem", fontWeight: 600, lineHeight: "1.5rem", fontFamily: "Inter" },
    subtitle1: { fontSize: "1.125rem", fontWeight: 700, lineHeight: "2.5rem", fontFamily: "Inter" },
    subtitle2: { fontSize: "1.125rem", fontWeight: 700, lineHeight: "2.5rem", fontFamily: "Inter" },
    body1: { fontSize: "1.125rem", fontWeight: 700, lineHeight: "2.5rem", fontFamily: "Inter" },
    body2: { fontSize: "1.125rem", fontWeight: 700, lineHeight: "2.25rem", fontFamily: "Inter" },
    button: { fontSize: "1.125rem", fontWeight: 700, lineHeight: "2.5rem", fontFamily: "Inter", textTransform: "none" },
    caption: { fontSize: "0.8125rem", fontWeight: 400, lineHeight: "1.125rem", fontFamily: "Inter" },
    overline: { fontSize: "0.8125rem", fontWeight: 400, lineHeight: "1.125rem", fontFamily: "Inter", letterSpacing: "0.08em" }
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: "none"
        }
      }
    },
    MuiCard: {
      defaultProps: { elevation: 5 },
      styleOverrides: {
        root: {
          borderRadius: "12px"
        }
      }
    }
  }
});
