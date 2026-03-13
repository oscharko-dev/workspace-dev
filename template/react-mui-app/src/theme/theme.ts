import { createTheme } from "@mui/material/styles";

export const appTheme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#0A84FF", dark: "#0069D9" },
    secondary: { main: "#5E5CE6" },
    success: { main: "#16A34A" },
    warning: { main: "#D97706" },
    error: { main: "#DC2626" },
    background: { default: "#F5F7FB", paper: "#FFFFFF" },
    text: { primary: "#0F172A", secondary: "#475569" }
  },
  shape: {
    borderRadius: 12
  },
  spacing: 8,
  typography: {
    fontFamily: "SF Pro Text, IBM Plex Sans, Segoe UI, Helvetica Neue, Arial, sans-serif"
  }
});
