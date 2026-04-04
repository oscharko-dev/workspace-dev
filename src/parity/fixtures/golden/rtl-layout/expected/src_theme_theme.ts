import { extendTheme } from "@mui/material/styles";

export const appTheme = extendTheme({
  colorSchemes: {
    light: {
      palette: {
      mode: "light",
      primary: { main: "#1a1a1f" },
      secondary: { main: "#666b75" },
      success: { main: "#26ad61" },
      warning: { main: "#D97706" },
      error: { main: "#DC2626" },
      info: { main: "#3d78f5" },
      background: { default: "#fcfcfd", paper: "#fcfcfd" },
      text: { primary: "#1a1a1f" },
      divider: "#1a1a1f1f",
      action: {
        active: "#1a1a1f8a",
        hover: "#1a1a1f0a",
        selected: "#1a1a1f14",
        disabled: "#1a1a1f42",
        disabledBackground: "#1a1a1f1f",
        focus: "#1a1a1f1f"
      }
    }
    }
  },
  shape: {
    borderRadius: 8
  },
  spacing: 12,
  typography: {
    fontFamily: "Cairo, Roboto, Arial, sans-serif",
    h1: { fontSize: "2rem", fontWeight: 700, lineHeight: "2.75rem", fontFamily: "Cairo" },
    h2: { fontSize: "1.125rem", fontWeight: 600, lineHeight: "1.75rem", fontFamily: "Cairo" },
    h3: { fontSize: "1rem", fontWeight: 400, lineHeight: "1.5rem", fontFamily: "Cairo" },
    h4: { fontSize: "1rem", fontWeight: 400, lineHeight: "1.5rem", fontFamily: "Cairo" },
    h5: { fontSize: "1rem", fontWeight: 400, lineHeight: "1.5rem", fontFamily: "Cairo" },
    h6: { fontSize: "1rem", fontWeight: 400, lineHeight: "1.5rem", fontFamily: "Cairo" },
    subtitle1: { fontSize: "1rem", fontWeight: 600, lineHeight: "1.75rem", fontFamily: "Cairo" },
    subtitle2: { fontSize: "1rem", fontWeight: 400, lineHeight: "1.5rem", fontFamily: "Cairo" },
    body1: { fontSize: "0.875rem", fontWeight: 400, lineHeight: "1.375rem", fontFamily: "Cairo" },
    body2: { fontSize: "0.875rem", fontWeight: 400, lineHeight: "1.375rem", fontFamily: "Cairo" },
    button: { fontSize: "0.875rem", fontWeight: 700, lineHeight: "2.75rem", fontFamily: "Cairo", textTransform: "none" },
    caption: { fontSize: "0.875rem", fontWeight: 400, lineHeight: "1.375rem", fontFamily: "Cairo" },
    overline: { fontSize: "0.875rem", fontWeight: 400, lineHeight: "1.375rem", fontFamily: "Cairo", letterSpacing: "0.08em" }
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
