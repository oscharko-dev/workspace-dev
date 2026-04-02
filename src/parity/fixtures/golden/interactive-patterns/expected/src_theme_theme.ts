import { extendTheme } from "@mui/material/styles";

export const appTheme = extendTheme({
  colorSchemes: {
    light: {
      palette: {
      mode: "light",
      primary: { main: "#1c1f24" },
      secondary: { main: "#3d78f5" },
      success: { main: "#16A34A" },
      warning: { main: "#D97706" },
      error: { main: "#DC2626" },
      info: { main: "#3d78f5" },
      background: { default: "#fdfdfe", paper: "#fdfdfe" },
      text: { primary: "#666b75" },
      divider: "#666b751f",
      action: {
        active: "#666b758a",
        hover: "#1c1f240a",
        selected: "#1c1f2414",
        disabled: "#666b7542",
        disabledBackground: "#666b751f",
        focus: "#1c1f241f"
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
    h1: { fontSize: "1.75rem", fontWeight: 700, lineHeight: "2.25rem", fontFamily: "Inter" },
    h2: { fontSize: "1.25rem", fontWeight: 700, lineHeight: "1.75rem", fontFamily: "Inter" },
    h3: { fontSize: "1rem", fontWeight: 600, lineHeight: "1.5rem", fontFamily: "Inter" },
    h4: { fontSize: "1rem", fontWeight: 600, lineHeight: "1.5rem", fontFamily: "Inter" },
    h5: { fontSize: "1rem", fontWeight: 600, lineHeight: "1.5rem", fontFamily: "Inter" },
    h6: { fontSize: "1rem", fontWeight: 600, lineHeight: "1.5rem", fontFamily: "Inter" },
    subtitle1: { fontSize: "1rem", fontWeight: 700, lineHeight: "1.75rem", fontFamily: "Inter" },
    subtitle2: { fontSize: "1rem", fontWeight: 600, lineHeight: "1.5rem", fontFamily: "Inter" },
    body1: { fontSize: "0.875rem", fontWeight: 400, lineHeight: "1.375rem", fontFamily: "Inter" },
    body2: { fontSize: "0.875rem", fontWeight: 400, lineHeight: "1.375rem", fontFamily: "Inter" },
    button: { fontSize: "0.875rem", fontWeight: 400, lineHeight: "1.375rem", fontFamily: "Inter", textTransform: "none" },
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
    }
  }
});
