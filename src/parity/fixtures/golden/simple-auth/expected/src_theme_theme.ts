import { createTheme } from "@mui/material/styles";

export const appTheme = createTheme({
  cssVariables: true,
  colorSchemes: {
    light: {
      palette: {
      mode: "light",
      primary: { main: "#ed001f" },
      secondary: { main: "#1c1f24" },
      success: { main: "#16A34A" },
      warning: { main: "#D97706" },
      error: { main: "#ed001f" },
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
