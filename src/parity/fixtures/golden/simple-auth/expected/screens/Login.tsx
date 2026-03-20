import type { ChangeEvent } from "react";
import { Controller } from "react-hook-form";
import { Container, Paper, TextField, Typography } from "@mui/material";
import { LoginFormContextProvider, useLoginFormContext } from "../context/LoginFormContext";

function LoginScreenContent() {
  const { control, handleSubmit, onSubmit, resolveFieldErrorMessage } = useLoginFormContext();
  return (
    <Container id="main-content" maxWidth="sm" role="main" component="form" onSubmit={handleSubmit(onSubmit)} noValidate sx={{ position: "relative", width: "100%", minHeight: "max(100vh, 320px)", bgcolor: "#fafafc", px: 1.6, py: 1.6 }}>
      <Typography variant="h1" component="h1" sx={{ color: "secondary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Welcome Back"}</Typography>
      <Controller
        name={"muiformcontrolroot_email_field"}
        control={control}
        render={({ field: controllerField, fieldState }) => {
          const helperText = resolveFieldErrorMessage({
            fieldKey: "muiformcontrolroot_email_field",
            isTouched: fieldState.isTouched,
            fieldError: typeof fieldState.error?.message === "string" ? fieldState.error.message : undefined
          });
          return (
            <TextField
              label={"Email"}
              type={"email"}
              autoComplete={"email"}
              value={controllerField.value ?? ""}
              onChange={(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => controllerField.onChange(event.target.value)}
              onBlur={controllerField.onBlur}
              error={Boolean(helperText)}
              helperText={helperText}
              aria-label={"Email"}
              aria-describedby={"muiformcontrolroot_email_field-helper-text"}
        sx={{
          width: "91.8%", maxWidth: "358px", minHeight: "56px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 0.8,
          "& .MuiInputLabel-root": { fontFamily: "Inter, Roboto, Arial, sans-serif", color: "#3d424d" }
        }}

              slotProps={{
                htmlInput: { "aria-describedby": "muiformcontrolroot_email_field-helper-text" },
          formHelperText: { id: "muiformcontrolroot_email_field-helper-text" }
              }}
            />
          );
        }}
      />
      <Paper sx={{ position: "relative", width: "56.4%", maxWidth: "220px", minHeight: "48px", bgcolor: "primary.main" }}>
        <Typography variant="body1" sx={{ position: "absolute", left: "68px", top: "13px", color: "#ffffff", textAlign: "center", whiteSpace: "pre-wrap" }}>{"Sign In"}</Typography>
      </Paper>
    </Container>
  );
}

export default function LoginScreen() {
  return (
      <LoginFormContextProvider>
      <LoginScreenContent />
      </LoginFormContextProvider>
  );
}
