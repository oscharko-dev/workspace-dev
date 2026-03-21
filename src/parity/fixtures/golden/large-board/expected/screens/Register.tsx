import type { ChangeEvent } from "react";
import { Controller } from "react-hook-form";
import { Container, TextField, Typography } from "@mui/material";
import { RegisterFormContextProvider, useRegisterFormContext } from "../context/RegisterFormContext";

function RegisterScreenContent() {
  const { control, handleSubmit, onSubmit, resolveFieldErrorMessage, isSubmitting } = useRegisterFormContext();
  return (
    <Container id="main-content" maxWidth="sm" role="main" component="form" onSubmit={handleSubmit(onSubmit)} noValidate sx={{ position: "relative", width: "100%", minHeight: "max(100vh, 320px)", bgcolor: "#ffffff", px: 1, py: 1 }}>
      {/* @ir:start reg-title Title text */}
      <Typography data-ir-id="reg-title" data-ir-name="Title" variant="h2" component="h1" sx={{ color: "primary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Create Account"}</Typography>
      {/* @ir:end reg-title */}
      {/* @ir:start reg-name MuiFormControlRoot input */}
      <Controller data-ir-id="reg-name" data-ir-name="MuiFormControlRoot"
        name={"muiformcontrolroot_reg_name"}
        control={control}
        render={({ field: controllerField, fieldState }) => {
          const helperText = resolveFieldErrorMessage({
            fieldKey: "muiformcontrolroot_reg_name",
            isTouched: fieldState.isTouched,
            fieldError: typeof fieldState.error?.message === "string" ? fieldState.error.message : undefined
          });
          return (
            <TextField
              label={"Full Name"}
              value={controllerField.value ?? ""}
              onChange={(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => controllerField.onChange(event.target.value)}
              onBlur={controllerField.onBlur}
              error={Boolean(helperText)}
              helperText={helperText}
              aria-label={"Full Name"}
              aria-describedby={"muiformcontrolroot_reg_name-helper-text"}
        sx={{
          width: "87.7%", maxWidth: "342px", minHeight: "56px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 0.5,
          "& .MuiInputLabel-root": { fontFamily: "Inter, Roboto, Arial, sans-serif", color: "#666b75" }
        }}

              slotProps={{
                htmlInput: { "aria-describedby": "muiformcontrolroot_reg_name-helper-text" },
          formHelperText: { id: "muiformcontrolroot_reg_name-helper-text" }
              }}
            />
          );
        }}
      />
      {/* @ir:end reg-name */}
    </Container>
  );
}

export default function RegisterScreen() {
  return (
      <RegisterFormContextProvider>
      <RegisterScreenContent />
      </RegisterFormContextProvider>
  );
}
