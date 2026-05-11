import { extendTheme } from "@mui/material/styles";

export const appTheme = extendTheme({
  colorSchemes: {
    light: {
      palette: {
      mode: "light",
      primary: { main: "#191c23" },
      secondary: { main: "#afb6c3" },
      success: { main: "#16A34A" },
      warning: { main: "#D97706" },
      error: { main: "#DC2626" },
      info: { main: "#afb6c3" },
      background: { default: "#f8f9fb", paper: "#f8f9fb" },
      text: { primary: "#191c23" },
      divider: "#191c231f",
      action: {
        active: "#191c238a",
        hover: "#191c230a",
        selected: "#191c2314",
        disabled: "#191c2342",
        disabledBackground: "#191c231f",
        focus: "#191c231f"
      }
    }
    },
    dark: {
      palette: {
      mode: "dark",
      primary: { main: "#f8f9fb" },
      secondary: { main: "#afb6c3" },
      success: { main: "#16a34a" },
      warning: { main: "#d97706" },
      error: { main: "#e24949" },
      info: { main: "#afb6c3" },
      background: { default: "#12141c", paper: "#191c23" },
      text: { primary: "#ffffff" },
      divider: "#ffffff1f",
      action: {
        active: "#ffffff8a",
        hover: "#f8f9fb0a",
        selected: "#f8f9fb14",
        disabled: "#ffffff42",
        disabledBackground: "#ffffff1f",
        focus: "#f8f9fb1f"
      }
    }
    }
  },
  shape: {
    borderRadius: 16
  },
  spacing: 14,
  typography: {
    fontFamily: "Inter, Roboto, Arial, sans-serif",
    h1: { fontSize: "1.75rem", fontWeight: 700, lineHeight: "2.25rem", fontFamily: "Inter" },
    h2: { fontSize: "1.5rem", fontWeight: 700, lineHeight: "2rem", fontFamily: "Inter" },
    h3: { fontSize: "1.5rem", fontWeight: 700, lineHeight: "2rem", fontFamily: "Inter" },
    h4: { fontSize: "1.5rem", fontWeight: 700, lineHeight: "2rem", fontFamily: "Inter" },
    h5: { fontSize: "1.5rem", fontWeight: 700, lineHeight: "2rem", fontFamily: "Inter" },
    h6: { fontSize: "1.5rem", fontWeight: 700, lineHeight: "2rem", fontFamily: "Inter" },
    subtitle1: { fontSize: "1.5rem", fontWeight: 700, lineHeight: "2.25rem", fontFamily: "Inter" },
    subtitle2: { fontSize: "1.5rem", fontWeight: 700, lineHeight: "2rem", fontFamily: "Inter" },
    body1: { fontSize: "1rem", fontWeight: 400, lineHeight: "1.5rem", fontFamily: "Inter" },
    body2: { fontSize: "0.875rem", fontWeight: 500, lineHeight: "1.25rem", fontFamily: "Inter" },
    button: { fontSize: "0.875rem", fontWeight: 700, lineHeight: "2.25rem", fontFamily: "Inter", textTransform: "none" },
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
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: "16px"
        }
      }
    }
  }
});
