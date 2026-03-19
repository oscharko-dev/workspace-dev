import { createTheme } from "@mui/material/styles";

export const appTheme = createTheme({
  cssVariables: true,
  colorSchemes: {
    light: {
      palette: {
      mode: "light",
      primary: { main: "#ffedd1" },
      secondary: { main: "#fbfbfc" },
      success: { main: "#def5de" },
      warning: { main: "#ffedd1" },
      error: { main: "#DC2626" },
      info: { main: "#0288D1" },
      background: { default: "#fbfbfc", paper: "#fbfbfc" },
      text: { primary: "#1c1f24" },
      divider: "#1c1f241f",
      action: {
        active: "#1c1f248a",
        hover: "#ffedd10a",
        selected: "#ffedd114",
        disabled: "#1c1f2442",
        disabledBackground: "#1c1f241f",
        focus: "#ffedd11f"
      }
    }
    },
    dark: {
      palette: {
      mode: "dark",
      primary: { main: "#ffedd1" },
      secondary: { main: "#fbfbfc" },
      success: { main: "#def5de" },
      warning: { main: "#ffedd1" },
      error: { main: "#e24949" },
      info: { main: "#0288d1" },
      background: { default: "#121212", paper: "#1e1e1e" },
      text: { primary: "#f5f7fb" },
      divider: "#f5f7fb1f",
      action: {
        active: "#f5f7fb8a",
        hover: "#ffedd10a",
        selected: "#ffedd114",
        disabled: "#f5f7fb42",
        disabledBackground: "#f5f7fb1f",
        focus: "#ffedd11f"
      }
    }
    }
  },
  shape: {
    borderRadius: 14
  },
  spacing: 8,
  typography: {
    fontFamily: "Inter, Roboto, Arial, sans-serif",
    h1: { fontSize: "1.5rem", fontWeight: 700, lineHeight: "2rem", fontFamily: "Inter" },
    h2: { fontSize: "1.5rem", fontWeight: 700, lineHeight: "2rem", fontFamily: "Inter" },
    h3: { fontSize: "1.5rem", fontWeight: 700, lineHeight: "2rem", fontFamily: "Inter" },
    h4: { fontSize: "1.5rem", fontWeight: 700, lineHeight: "2rem", fontFamily: "Inter" },
    h5: { fontSize: "1.5rem", fontWeight: 700, lineHeight: "2rem", fontFamily: "Inter" },
    h6: { fontSize: "1.5rem", fontWeight: 700, lineHeight: "2rem", fontFamily: "Inter" },
    subtitle1: { fontSize: "1.5rem", fontWeight: 700, lineHeight: "2rem", fontFamily: "Inter" },
    subtitle2: { fontSize: "1.5rem", fontWeight: 700, lineHeight: "2rem", fontFamily: "Inter" },
    body1: { fontSize: "0.875rem", fontWeight: 400, lineHeight: "1.25rem", fontFamily: "Inter" },
    body2: { fontSize: "0.75rem", fontWeight: 500, lineHeight: "1rem", fontFamily: "Inter" },
    button: { fontSize: "0.75rem", fontWeight: 400, lineHeight: "1.25rem", fontFamily: "Inter", textTransform: "none" },
    caption: { fontSize: "0.75rem", fontWeight: 500, lineHeight: "1rem", fontFamily: "Inter" },
    overline: { fontSize: "0.75rem", fontWeight: 500, lineHeight: "1rem", fontFamily: "Inter", letterSpacing: "0.08em" }
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: "none"
        }
      }
    },
    MuiChip: {
      defaultProps: { size: "small" },
      styleOverrides: {
        root: {
          borderRadius: "14px"
        }
      }
    }
  }
});
