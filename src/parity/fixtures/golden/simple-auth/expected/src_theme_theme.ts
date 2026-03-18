import { createTheme } from "@mui/material/styles";

export const appTheme = createTheme({
  colorSchemes: {
    light: {
      palette: {
      mode: "light",
      primary: { main: "#ed001f" },
      secondary: { main: "#1c1f24" },
      success: { main: "#16A34A" },
      warning: { main: "#D97706" },
      error: { main: "#DC2626" },
      info: { main: "#0288D1" },
      background: { default: "#fbfbfd", paper: "#fbfbfd" },
      text: { primary: "#1c1f24" },
      divider: "#1c1f241f",
      action: {
        active: "#1c1f248a",
        hover: "#ed001f0a",
        selected: "#ed001f14",
        disabled: "#1c1f2442",
        disabledBackground: "#1c1f241f",
        focus: "#ed001f1f"
      }
    }
    },
    dark: {
      palette: {
      mode: "dark",
      primary: { main: "#f02943" },
      secondary: { main: "#898b8d" },
      success: { main: "#16a34a" },
      warning: { main: "#d97706" },
      error: { main: "#e24949" },
      info: { main: "#0288d1" },
      background: { default: "#121212", paper: "#1e1e1e" },
      text: { primary: "#f5f7fb" },
      divider: "#f5f7fb1f",
      action: {
        active: "#f5f7fb8a",
        hover: "#f029430a",
        selected: "#f0294314",
        disabled: "#f5f7fb42",
        disabledBackground: "#f5f7fb1f",
        focus: "#f029431f"
      }
    }
    }
  },
  shape: {
    borderRadius: 8
  },
  spacing: 10,
  typography: {
    fontFamily: "Inter, Roboto, Arial, sans-serif",
    h1: { fontSize: "2rem", fontWeight: 700, lineHeight: "2.5rem", fontFamily: "Inter" },
    h2: { fontSize: "2rem", fontWeight: 700, lineHeight: "2.5rem", fontFamily: "Inter" },
    h3: { fontSize: "2rem", fontWeight: 700, lineHeight: "2.5rem", fontFamily: "Inter" },
    h4: { fontSize: "2rem", fontWeight: 700, lineHeight: "2.5rem", fontFamily: "Inter" },
    h5: { fontSize: "2rem", fontWeight: 700, lineHeight: "2.5rem", fontFamily: "Inter" },
    h6: { fontSize: "2rem", fontWeight: 700, lineHeight: "2.5rem", fontFamily: "Inter" },
    subtitle1: { fontSize: "2rem", fontWeight: 700, lineHeight: "2.5rem", fontFamily: "Inter" },
    subtitle2: { fontSize: "2rem", fontWeight: 700, lineHeight: "2.5rem", fontFamily: "Inter" },
    body1: { fontSize: "1rem", fontWeight: 600, lineHeight: "1.375rem", fontFamily: "Inter" },
    body2: { fontSize: "0.875rem", fontWeight: 500, lineHeight: "1.25rem", fontFamily: "Inter" },
    button: { fontSize: "0.875rem", fontWeight: 600, lineHeight: "1.375rem", fontFamily: "Inter", textTransform: "none" },
    caption: { fontSize: "0.875rem", fontWeight: 500, lineHeight: "1.25rem", fontFamily: "Inter" },
    overline: { fontSize: "0.875rem", fontWeight: 500, lineHeight: "1.25rem", fontFamily: "Inter", letterSpacing: "0.08em" }
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: "none"
        }
      }
    }
  }
});
