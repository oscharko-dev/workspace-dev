import type { ChangeEvent } from "react";
import { Controller } from "react-hook-form";
import { Container, TextField, Typography } from "@mui/material";
import { LoginFormContextProvider, useLoginFormContext } from "../context/LoginFormContext";

function LoginScreenContent() {
  const { control, handleSubmit, onSubmit, resolveFieldErrorMessage, isSubmitted } = useLoginFormContext();
  return (
    <Container id="main-content" maxWidth="sm" role="main" component="form" onSubmit={((event) => { void handleSubmit(onSubmit)(event); })} noValidate sx={{ position: "relative", width: "100%", minHeight: "max(100vh, 320px)", bgcolor: "background.paper", px: 1, py: 1 }}>
      {/* @ir:start login-title Title text */}
      <Typography data-ir-id="login-title" data-ir-name="Title" variant="h2" component="h1" sx={{ color: "primary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Sign In"}</Typography>
      {/* @ir:end login-title */}
      {/* @ir:start login-email MuiFormControlRoot input */}
      <Controller data-ir-id="login-email" data-ir-name="MuiFormControlRoot"
        name={"muiformcontrolroot_login_email"}
        control={control}
        render={({ field: controllerField, fieldState }) => {
          const helperText = resolveFieldErrorMessage({
            fieldKey: "muiformcontrolroot_login_email",
            isTouched: fieldState.isTouched,
            isSubmitted,
            fieldError: typeof fieldState.error?.message === "string" ? fieldState.error.message : undefined
          });
          return (
            <TextField
              label={"Email"}
              type={"email"}
              autoComplete={"email"}
              value={controllerField.value}
              onChange={(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => controllerField.onChange(event.target.value)}
              onBlur={controllerField.onBlur}
              error={Boolean(helperText)}
              helperText={helperText}
              aria-label={"Email"}
              aria-invalid={Boolean(helperText)}
              aria-describedby={"muiformcontrolroot_login_email-helper-text"}
        sx={{
          width: "87.7%", maxWidth: "342px", minHeight: "56px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 0.5,
          "& .MuiInputLabel-root": { color: "text.secondary" }
        }}

              slotProps={{
                htmlInput: { "aria-invalid": Boolean(helperText), "aria-describedby": "muiformcontrolroot_login_email-helper-text" },
          formHelperText: { id: "muiformcontrolroot_login_email-helper-text" }
              }}
            />
          );
        }}
      />
      {/* @ir:end login-email */}
      {/* @ir:start login-password MuiFormControlRoot input */}
      <Controller data-ir-id="login-password" data-ir-name="MuiFormControlRoot"
        name={"muiformcontrolroot_login_password"}
        control={control}
        render={({ field: controllerField, fieldState }) => {
          const helperText = resolveFieldErrorMessage({
            fieldKey: "muiformcontrolroot_login_password",
            isTouched: fieldState.isTouched,
            isSubmitted,
            fieldError: typeof fieldState.error?.message === "string" ? fieldState.error.message : undefined
          });
          return (
            <TextField
              label={"Password"}
              type={"password"}
              autoComplete={"current-password"}
              value={controllerField.value}
              onChange={(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => controllerField.onChange(event.target.value)}
              onBlur={controllerField.onBlur}
              error={Boolean(helperText)}
              helperText={helperText}
              aria-label={"Password"}
              aria-invalid={Boolean(helperText)}
              aria-describedby={"muiformcontrolroot_login_password-helper-text"}
        sx={{
          width: "87.7%", maxWidth: "342px", minHeight: "56px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 0.5,
          "& .MuiInputLabel-root": { color: "text.secondary" }
        }}

              slotProps={{
                htmlInput: { "aria-invalid": Boolean(helperText), "aria-describedby": "muiformcontrolroot_login_password-helper-text" },
          formHelperText: { id: "muiformcontrolroot_login_password-helper-text" }
              }}
            />
          );
        }}
      />
      {/* @ir:end login-password */}
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
