import { extendTheme } from "@mui/material/styles";

export const appTheme = extendTheme({
  colorSchemes: {
    light: {
      palette: {
      mode: "light",
      primary: { main: "#d20a11", contrastText: "#ffffff" },
      secondary: { main: "#1a3d8f" },
      background: { default: "#f5f5f5", paper: "#ffffff" },
      text: { primary: "#212121" },
      divider: "#d9d9d9"
    }
    }

  },
  shape: {
    borderRadius: 12
  },
  spacing: 8,
  typography: {
    fontFamily: "Body Text",
    fontSize: 16,
    fontWeightRegular: 400,
    h1: { fontFamily: "Body Text", fontSize: "28px", fontWeight: 700, lineHeight: 1.25 },
    body1: { fontFamily: "Body Text", fontSize: "16px", fontWeight: 400, lineHeight: 1.5 }
  },
  components: {

  }
});
