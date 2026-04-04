import { extendTheme } from "@mui/material/styles";

export const appTheme = extendTheme({
  colorSchemes: {
    light: {
      palette: {
      mode: "light",
      primary: { main: "#121726" },
      secondary: { main: "#3d78f5" },
      success: { main: "#16A34A" },
      warning: { main: "#D97706" },
      error: { main: "#DC2626" },
      info: { main: "#3d78f5" },
      background: { default: "#f9fbfc", paper: "#f9fbfc" },
      text: { primary: "#121726" },
      divider: "#1217261f",
      action: {
        active: "#1217268a",
        hover: "#1217260a",
        selected: "#12172614",
        disabled: "#12172642",
        disabledBackground: "#1217261f",
        focus: "#1217261f"
      }
    }
    }
  },
  shape: {
    borderRadius: 8
  },
  spacing: 12,
  breakpoints: {
    values: { xs: 0, sm: 495, md: 900, lg: 1170, xl: 1488 }
  },
  typography: {
    fontFamily: "Inter, Roboto, Arial, sans-serif",
    h1: { fontSize: "3rem", fontWeight: 800, lineHeight: "3.5rem", fontFamily: "Inter" },
    h2: { fontSize: "2rem", fontWeight: 800, lineHeight: "2.5rem", fontFamily: "Inter" },
    h3: { fontSize: "1.25rem", fontWeight: 600, lineHeight: "1.75rem", fontFamily: "Inter" },
    h4: { fontSize: "1.125rem", fontWeight: 600, lineHeight: "1.5rem", fontFamily: "Inter" },
    h5: { fontSize: "1rem", fontWeight: 400, lineHeight: "1.5rem", fontFamily: "Inter" },
    h6: { fontSize: "1rem", fontWeight: 400, lineHeight: "1.5rem", fontFamily: "Inter" },
    subtitle1: { fontSize: "1rem", fontWeight: 600, lineHeight: "1.5rem", fontFamily: "Inter" },
    subtitle2: { fontSize: "1rem", fontWeight: 400, lineHeight: "1.5rem", fontFamily: "Inter" },
    body1: { fontSize: "0.875rem", fontWeight: 400, lineHeight: "1.375rem", fontFamily: "Inter" },
    body2: { fontSize: "0.875rem", fontWeight: 400, lineHeight: "1.375rem", fontFamily: "Inter" },
    button: { fontSize: "0.875rem", fontWeight: 800, lineHeight: "3.5rem", fontFamily: "Inter", textTransform: "none" },
    caption: { fontSize: "0.875rem", fontWeight: 400, lineHeight: "1.375rem", fontFamily: "Inter" },
    overline: { fontSize: "0.875rem", fontWeight: 400, lineHeight: "1.375rem", fontFamily: "Inter", letterSpacing: "0.08em" }
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
      styleOverrides: {
        root: {
          borderRadius: "8px"
        }
      }
    }
  }
});
