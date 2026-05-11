import { extendTheme } from "@mui/material/styles";

export const appTheme = extendTheme({
  colorSchemes: {
    light: {
      palette: {
      mode: "light",
      primary: { main: "#212121" },
      secondary: { main: "#617df5" },
      success: { main: "#16A34A" },
      warning: { main: "#D97706" },
      error: { main: "#f54236" },
      info: { main: "#3d52b5" },
      background: { default: "#f2f4fc", paper: "#f2f4fc" },
      text: { primary: "#212121" },
      divider: "#dbdbdb",
      action: {
        active: "#2121218a",
        hover: "#2121210a",
        selected: "#21212114",
        disabled: "#21212142",
        disabledBackground: "#2121211f",
        focus: "#2121211f"
      }
    }
    }
  },
  shape: {
    borderRadius: 16
  },
  spacing: 8,
  typography: {
    fontFamily: "Roboto, Arial, sans-serif",
    h1: { fontSize: "2.25rem", fontWeight: 700, lineHeight: "2.75rem", fontFamily: "Roboto" },
    h2: { fontSize: "1.5rem", fontWeight: 700, lineHeight: "2rem", fontFamily: "Roboto" },
    h3: { fontSize: "1.25rem", fontWeight: 600, lineHeight: "1.75rem", fontFamily: "Roboto" },
    h4: { fontSize: "1.25rem", fontWeight: 600, lineHeight: "1.75rem", fontFamily: "Roboto" },
    h5: { fontSize: "1.25rem", fontWeight: 600, lineHeight: "1.75rem", fontFamily: "Roboto" },
    h6: { fontSize: "1.25rem", fontWeight: 600, lineHeight: "1.75rem", fontFamily: "Roboto" },
    subtitle1: { fontSize: "1.25rem", fontWeight: 700, lineHeight: "2rem", fontFamily: "Roboto" },
    subtitle2: { fontSize: "1.25rem", fontWeight: 600, lineHeight: "1.75rem", fontFamily: "Roboto" },
    body1: { fontSize: "0.875rem", fontWeight: 500, lineHeight: "1.25rem", fontFamily: "Roboto" },
    body2: { fontSize: "0.8125rem", fontWeight: 500, lineHeight: "1.125rem", fontFamily: "Roboto" },
    button: { fontSize: "0.8125rem", fontWeight: 700, lineHeight: "2.75rem", fontFamily: "Roboto", textTransform: "none" },
    caption: { fontSize: "0.75rem", fontWeight: 600, lineHeight: "1rem", fontFamily: "Roboto" },
    overline: { fontSize: "0.75rem", fontWeight: 600, lineHeight: "1rem", fontFamily: "Roboto", letterSpacing: "0.08em" }
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
          borderRadius: "12px"
        }
      }
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          borderRadius: 0.75
        }
      }
    },
    MuiChip: {
      defaultProps: { size: "medium" },
      styleOverrides: {
        root: {
          borderRadius: "16px",
          backgroundColor: "#e8edfc"
        }
      }
    },
    MuiDivider: {
      styleOverrides: {
        root: {
          borderColor: "#e0e0e0"
        }
      }
    },
    MuiAvatar: {
      styleOverrides: {
        root: {
          width: "64px",
          height: "64px"
        }
      }
    }
  }
});
