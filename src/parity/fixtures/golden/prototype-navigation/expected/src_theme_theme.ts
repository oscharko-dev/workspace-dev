import { createTheme } from "@mui/material/styles";

export const appTheme = createTheme({
  cssVariables: true,
  colorSchemes: {
    light: {
      palette: {
      mode: "light",
      primary: { main: "#ed001f" },
      secondary: { main: "#1f2126" },
      success: { main: "#16A34A" },
      warning: { main: "#D97706" },
      error: { main: "#ed001f" },
      info: { main: "#0288D1" },
      background: { default: "#ffffff", paper: "#ffffff" },
      text: { primary: "#1f2126" },
      divider: "#1f21261f",
      action: {
        active: "#1f21268a",
        hover: "#ed001f0a",
        selected: "#ed001f14",
        disabled: "#1f212642",
        disabledBackground: "#1f21261f",
        focus: "#ed001f1f"
      }
    }
    }

  },
  shape: {
    borderRadius: 8
  },
  spacing: 16,
  typography: {
    fontFamily: "Inter, Roboto, Arial, sans-serif",
    h1: { fontSize: "1.875rem", fontWeight: 700, lineHeight: "2.375rem", fontFamily: "Inter" },
    h2: { fontSize: "1.75rem", fontWeight: 700, lineHeight: "2.25rem", fontFamily: "Inter" },
    h3: { fontSize: "1.75rem", fontWeight: 700, lineHeight: "2.25rem", fontFamily: "Inter" },
    h4: { fontSize: "1.75rem", fontWeight: 700, lineHeight: "2.25rem", fontFamily: "Inter" },
    h5: { fontSize: "1.75rem", fontWeight: 700, lineHeight: "2.25rem", fontFamily: "Inter" },
    h6: { fontSize: "1.75rem", fontWeight: 700, lineHeight: "2.25rem", fontFamily: "Inter" },
    subtitle1: { fontSize: "1.75rem", fontWeight: 700, lineHeight: "2.375rem", fontFamily: "Inter" },
    subtitle2: { fontSize: "1.75rem", fontWeight: 700, lineHeight: "2.25rem", fontFamily: "Inter" },
    body1: { fontSize: "1rem", fontWeight: 400, lineHeight: "1.375rem", fontFamily: "Inter" },
    body2: { fontSize: "1rem", fontWeight: 400, lineHeight: "1.375rem", fontFamily: "Inter" },
    button: { fontSize: "1rem", fontWeight: 700, lineHeight: "2.375rem", fontFamily: "Inter", textTransform: "none" },
    caption: { fontSize: "1rem", fontWeight: 400, lineHeight: "1.375rem", fontFamily: "Inter" },
    overline: { fontSize: "1rem", fontWeight: 400, lineHeight: "1.375rem", fontFamily: "Inter", letterSpacing: "0.08em" }
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
