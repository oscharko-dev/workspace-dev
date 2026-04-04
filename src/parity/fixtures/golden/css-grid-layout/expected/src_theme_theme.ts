import { extendTheme } from "@mui/material/styles";

export const appTheme = extendTheme({
  colorSchemes: {
    light: {
      palette: {
      mode: "light",
      primary: { main: "#1c1f24" },
      secondary: { main: "#545c66" },
      success: { main: "#16A34A" },
      warning: { main: "#D97706" },
      error: { main: "#DC2626" },
      info: { main: "#0288D1" },
      background: { default: "#fcfdfe", paper: "#fcfdfe" },
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
    }
  },
  shape: {
    borderRadius: 16
  },
  spacing: 20,
  typography: {
    fontFamily: "Inter, Roboto, Arial, sans-serif",
    h1: { fontSize: "1.875rem", fontWeight: 700, lineHeight: "2.375rem", fontFamily: "Inter" },
    h2: { fontSize: "1.5rem", fontWeight: 700, lineHeight: "2rem", fontFamily: "Inter" },
    h3: { fontSize: "1.375rem", fontWeight: 600, lineHeight: "1.875rem", fontFamily: "Inter" },
    h4: { fontSize: "1.25rem", fontWeight: 500, lineHeight: "1.75rem", fontFamily: "Inter" },
    h5: { fontSize: "1rem", fontWeight: 400, lineHeight: "1.5rem", fontFamily: "Inter" },
    h6: { fontSize: "1rem", fontWeight: 400, lineHeight: "1.5rem", fontFamily: "Inter" },
    subtitle1: { fontSize: "1rem", fontWeight: 700, lineHeight: "2rem", fontFamily: "Inter" },
    subtitle2: { fontSize: "1rem", fontWeight: 600, lineHeight: "1.875rem", fontFamily: "Inter" },
    body1: { fontSize: "1rem", fontWeight: 500, lineHeight: "1.75rem", fontFamily: "Inter" },
    body2: { fontSize: "1rem", fontWeight: 400, lineHeight: "1.5rem", fontFamily: "Inter" },
    button: { fontSize: "1rem", fontWeight: 700, lineHeight: "2.375rem", fontFamily: "Inter", textTransform: "none" },
    caption: { fontSize: "1rem", fontWeight: 400, lineHeight: "1.5rem", fontFamily: "Inter" },
    overline: { fontSize: "1rem", fontWeight: 400, lineHeight: "1.5rem", fontFamily: "Inter", letterSpacing: "0.08em" }
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
