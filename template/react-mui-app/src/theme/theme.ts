import { createTheme } from "@mui/material/styles";

export const appTheme = createTheme({
  colorSchemes: {
    light: {
      palette: {
        mode: "light",
        primary: { main: "#0A84FF", dark: "#0069D9" },
        secondary: { main: "#5E5CE6" },
        success: { main: "#16A34A" },
        warning: { main: "#D97706" },
        error: { main: "#DC2626" },
        info: { main: "#0288D1" },
        background: { default: "#F5F7FB", paper: "#FFFFFF" },
        text: { primary: "#0F172A", secondary: "#475569" },
        divider: "#0F172A1F",
        action: {
          active: "#0F172A8A",
          hover: "#0A84FF0A",
          selected: "#0A84FF14",
          disabled: "#0F172A42",
          disabledBackground: "#0F172A1F",
          focus: "#0A84FF1F"
        }
      }
    },
    dark: {
      palette: {
        mode: "dark",
        primary: { main: "#6DB2FF" },
        secondary: { main: "#B4B0FF" },
        success: { main: "#4ED98A" },
        warning: { main: "#F4BC63" },
        error: { main: "#FF8E8E" },
        info: { main: "#7CCBFF" },
        background: { default: "#121212", paper: "#1E1E1E" },
        text: { primary: "#F5F7FB", secondary: "#B8C2D3" },
        divider: "#F5F7FB1F",
        action: {
          active: "#F5F7FB8A",
          hover: "#6DB2FF0A",
          selected: "#6DB2FF14",
          disabled: "#F5F7FB42",
          disabledBackground: "#F5F7FB1F",
          focus: "#6DB2FF1F"
        }
      }
    }
  },
  shape: {
    borderRadius: 12
  },
  spacing: 8,
  typography: {
    fontFamily: "SF Pro Text, IBM Plex Sans, Segoe UI, Helvetica Neue, Arial, sans-serif"
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
