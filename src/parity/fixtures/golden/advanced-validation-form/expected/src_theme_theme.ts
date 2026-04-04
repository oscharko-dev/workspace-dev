import { extendTheme } from "@mui/material/styles";

export const appTheme = extendTheme({
  colorSchemes: {
    light: {
      palette: {
      mode: "light",
      primary: { main: "#1c1f24" },
      secondary: { main: "#666b75" },
      success: { main: "#16A34A" },
      warning: { main: "#D97706" },
      error: { main: "#ed001f" },
      info: { main: "#0288D1" },
      background: { default: "#ffffff", paper: "#ffffff" },
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
    borderRadius: 8
  },
  spacing: 4,
  typography: {
    fontFamily: "Inter, Roboto, Arial, sans-serif",
    h1: { fontSize: "1.75rem", fontWeight: 700, lineHeight: "2.25rem", fontFamily: "Inter" },
    h2: { fontSize: "0.875rem", fontWeight: 400, lineHeight: "1.25rem", fontFamily: "Inter" },
    h3: { fontSize: "0.875rem", fontWeight: 400, lineHeight: "1.25rem", fontFamily: "Inter" },
    h4: { fontSize: "0.875rem", fontWeight: 400, lineHeight: "1.25rem", fontFamily: "Inter" },
    h5: { fontSize: "0.875rem", fontWeight: 400, lineHeight: "1.25rem", fontFamily: "Inter" },
    h6: { fontSize: "0.875rem", fontWeight: 400, lineHeight: "1.25rem", fontFamily: "Inter" },
    subtitle1: { fontSize: "0.875rem", fontWeight: 700, lineHeight: "2.25rem", fontFamily: "Inter" },
    subtitle2: { fontSize: "0.875rem", fontWeight: 700, lineHeight: "2.25rem", fontFamily: "Inter" },
    body1: { fontSize: "0.875rem", fontWeight: 400, lineHeight: "1.5rem", fontFamily: "Inter" },
    body2: { fontSize: "0.875rem", fontWeight: 400, lineHeight: "1.25rem", fontFamily: "Inter" },
    button: { fontSize: "0.875rem", fontWeight: 400, lineHeight: "1.5rem", fontFamily: "Inter", textTransform: "none" },
    caption: { fontSize: "0.75rem", fontWeight: 400, lineHeight: "1rem", fontFamily: "Inter" },
    overline: { fontSize: "0.75rem", fontWeight: 400, lineHeight: "1rem", fontFamily: "Inter", letterSpacing: "0.08em" }
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: "none"
        }
      }
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          borderRadius: 1,
          "\u0026 .MuiOutlinedInput-root": {
            borderRadius: "8px"
          }
        }
      }
    }
  }
});
