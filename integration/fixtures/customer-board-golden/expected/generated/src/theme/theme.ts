import { extendTheme } from "@mui/material/styles";

export const appTheme = extendTheme({
  colorSchemes: {
    light: {
      palette: {
      mode: "light",
      primary: { main: "#ff0000", contrastText: "#ffffff" },
      secondary: { main: "#666666", contrastText: "#ffffff" },
      success: { main: "#009864" },
      warning: { main: "#ffc900" },
      error: { main: "#ff0000" },
      info: { main: "#00acd3" },
      background: { default: "#f0f0f0", paper: "#ffffff" },
      text: { primary: "#444444" }
    }
    }
  },
  shape: {
    borderRadius: 4
  },
  spacing: 8,
  typography: {
    fontFamily: "SparkasseRegular, Sans-Serif",
    fontSize: 16,
    h1: { fontFamily: "SparkasseHeadRegular", fontSize: "30px", lineHeight: 1.5 },
    h2: { fontFamily: "SparkasseBold", fontSize: "22px", lineHeight: 1.1 },
    h3: { fontFamily: "SparkasseBold", fontSize: "20px", lineHeight: 1.3 },
    h4: { fontFamily: "SparkasseRegular", fontSize: "18px", lineHeight: 1.1 },
    h5: { fontFamily: "SparkasseRegular", fontSize: "16px", lineHeight: 1.3 },
    h6: { fontFamily: "SparkasseRegular", fontSize: "13px", lineHeight: 1.5 },
    body1: { fontFamily: "SparkasseRegular", fontSize: "14px", lineHeight: 1.2 },
    body2: { fontFamily: "SparkasseRegular", fontSize: "14px", lineHeight: 1.2 },
    caption: { fontFamily: "SparkasseRegular", fontSize: "12px", lineHeight: 1.5 }
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          fontFamily: "SparkasseBold",
          lineHeight: 1.5,
          textTransform: "none"
        }
      }
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          color: "#ffffff"
        }
      }
    },
    MuiDivider: {
      styleOverrides: {
        root: {
          borderColor: "#e3e3e3"
        }
      }
    },
    MuiFab: {
      styleOverrides: {
        root: {
          textTransform: "none"
        }
      }
    },
    MuiFormHelperText: {
      styleOverrides: {
        root: {
          color: "#767676"
        }
      }
    },
    MuiFormLabel: {
      styleOverrides: {
        root: {
          color: "#999999"
        }
      }
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          color: "#444444",
          padding: "12px"
        }
      }
    },
    MuiInputAdornment: {
      styleOverrides: {
        root: {
          marginRight: "5px"
        }
      }
    },
    MuiInputBase: {
      styleOverrides: {
        root: {
          fontSize: "16px",
          lineHeight: 1
        }
      }
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          fontSize: "16px"
        }
      }
    },
    MuiListSubheader: {
      styleOverrides: {
        root: {
          fontFamily: "SparkasseBold, Sans-Serif"
        }
      }
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          fontSize: "16px",
          paddingBottom: "8px",
          paddingTop: "8px"
        }
      }
    },
    MuiSkeleton: {
      styleOverrides: {
        root: {
          backgroundColor: "#0000000a"
        }
      }
    }
  }
});
