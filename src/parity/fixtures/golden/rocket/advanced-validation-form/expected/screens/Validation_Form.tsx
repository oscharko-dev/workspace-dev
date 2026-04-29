import type { ChangeEvent } from "react";
import { Controller } from "react-hook-form";
import { Container, Paper, TextField, Typography } from "@mui/material";
import { ValidationFormFormContextProvider, useValidationFormFormContext } from "../context/ValidationFormFormContext";

function ValidationFormScreenContent() {
  const { control, handleSubmit, onSubmit, resolveFieldErrorMessage, isSubmitted } = useValidationFormFormContext();
  return (
    <Container id="main-content" maxWidth="sm" role="main" component="form" onSubmit={((event) => { void handleSubmit(onSubmit)(event); })} noValidate sx={{ position: "relative", width: "100%", minHeight: "max(100vh, 380px)", bgcolor: "background.default", px: 4, py: 4 }}>
      {/* @ir:start validation-title Heading text */}
      <Typography data-ir-id="validation-title" data-ir-name="Heading" variant="h1" component="h1" sx={{ color: "primary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Request approved budget"}</Typography>
      {/* @ir:end validation-title */}
      {/* @ir:start validation-subtitle Subtitle text */}
      <Typography data-ir-id="validation-subtitle" data-ir-name="Subtitle" variant="h2" component="h2" sx={{ color: "secondary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Use a company email, provide the amount range, and include a six-character code."}</Typography>
      {/* @ir:end validation-subtitle */}
      {/* @ir:start email-field MuiTextFieldRoot input */}
      <Controller data-ir-id="email-field" data-ir-name="MuiTextFieldRoot"
        name={"muitextfieldroot_email_field"}
        control={control}
        render={({ field: controllerField, fieldState }) => {
          const helperText = resolveFieldErrorMessage({
            fieldKey: "muitextfieldroot_email_field",
            isTouched: fieldState.isTouched,
            isSubmitted,
            fieldError: typeof fieldState.error?.message === "string" ? fieldState.error.message : undefined
          });
          return (
            <TextField
              label={"Company email"}
              placeholder={"owner@example.com"}
              type={"email"}
              autoComplete={"email"}
              value={controllerField.value}
              onChange={(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => controllerField.onChange(event.target.value)}
              onBlur={controllerField.onBlur}
              error={Boolean(helperText)}
              helperText={helperText}
              aria-label={"Company email"}
              aria-invalid={Boolean(helperText)}
              aria-describedby={"muitextfieldroot_email_field-helper-text"}
        sx={{
          width: "88.6%", maxWidth: "372px", minHeight: "56px", display: "flex", flexDirection: "column", gap: 1,
          "& .MuiOutlinedInput-notchedOutline": { borderColor: "#bfc4cc" },
          "& .MuiInputLabel-root": { color: "secondary.main" }
        }}

              slotProps={{
                htmlInput: { "aria-invalid": Boolean(helperText), "aria-describedby": "muitextfieldroot_email_field-helper-text" },
          formHelperText: { id: "muitextfieldroot_email_field-helper-text" }
              }}
            />
          );
        }}
      />
      {/* @ir:end email-field */}
      {/* @ir:start amount-field MuiTextFieldRoot input */}
      <Controller data-ir-id="amount-field" data-ir-name="MuiTextFieldRoot"
        name={"muitextfieldroot_amount_field"}
        control={control}
        render={({ field: controllerField, fieldState }) => {
          const helperText = resolveFieldErrorMessage({
            fieldKey: "muitextfieldroot_amount_field",
            isTouched: fieldState.isTouched,
            isSubmitted,
            fieldError: typeof fieldState.error?.message === "string" ? fieldState.error.message : undefined
          });
          return (
            <TextField
              label={"Approved amount"}
              type={"number"}
              value={controllerField.value}
              onChange={(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => controllerField.onChange(event.target.value)}
              onBlur={controllerField.onBlur}
              error={Boolean(helperText)}
              helperText={helperText}
              aria-label={"Approved amount"}
              aria-invalid={Boolean(helperText)}
              aria-describedby={"muitextfieldroot_amount_field-helper-text"}
        sx={{
          width: "88.6%", maxWidth: "372px", minHeight: "56px", display: "flex", flexDirection: "column", gap: 1,
          "& .MuiOutlinedInput-root": { color: "primary.main" },
          "& .MuiOutlinedInput-notchedOutline": { borderColor: "#bfc4cc" },
          "& .MuiInputLabel-root": { color: "secondary.main" }
        }}

              slotProps={{
                htmlInput: { "aria-invalid": Boolean(helperText), "aria-describedby": "muitextfieldroot_amount_field-helper-text" },
          formHelperText: { id: "muitextfieldroot_amount_field-helper-text" }
              }}
            />
          );
        }}
      />
      {/* @ir:end amount-field */}
      {/* @ir:start code-field MuiTextFieldRoot input */}
      <Controller data-ir-id="code-field" data-ir-name="MuiTextFieldRoot"
        name={"muitextfieldroot_code_field"}
        control={control}
        render={({ field: controllerField, fieldState }) => {
          const helperText = resolveFieldErrorMessage({
            fieldKey: "muitextfieldroot_code_field",
            isTouched: fieldState.isTouched,
            isSubmitted,
            fieldError: typeof fieldState.error?.message === "string" ? fieldState.error.message : undefined
          });
          return (
            <TextField
              label={"Approval code"}
              value={controllerField.value}
              onChange={(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => controllerField.onChange(event.target.value)}
              onBlur={controllerField.onBlur}
              error={Boolean(helperText)}
              helperText={helperText}
              aria-label={"Approval code"}
              aria-invalid={Boolean(helperText)}
              aria-describedby={"muitextfieldroot_code_field-helper-text"}
        sx={{
          width: "88.6%", maxWidth: "372px", minHeight: "56px", display: "flex", flexDirection: "column", gap: 1,
          "& .MuiOutlinedInput-root": { color: "primary.main" },
          "& .MuiOutlinedInput-notchedOutline": { borderColor: "#bfc4cc" },
          "& .MuiInputLabel-root": { color: "secondary.main" }
        }}

              slotProps={{
                htmlInput: { "aria-invalid": Boolean(helperText), "aria-describedby": "muitextfieldroot_code_field-helper-text" },
          formHelperText: { id: "muitextfieldroot_code_field-helper-text" }
              }}
            />
          );
        }}
      />
      {/* @ir:end code-field */}
      {/* @ir:start submit-budget-button MuiButtonRoot paper */}
      <Paper data-ir-id="submit-budget-button" data-ir-name="MuiButtonRoot" sx={{ width: "88.6%", maxWidth: "372px", minHeight: "48px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", bgcolor: "error.main", borderRadius: 1 }}>
        {/* @ir:start submit-budget-button-label Label text */}
        <Typography data-ir-id="submit-budget-button-label" data-ir-name="Label" variant="body1" sx={{ fontWeight: 600, color: "background.default", textAlign: "center", whiteSpace: "pre-wrap" }}>{"Submit request"}</Typography>
        {/* @ir:end submit-budget-button-label */}
      </Paper>
      {/* @ir:end submit-budget-button */}
    </Container>
  );
}

export default function ValidationFormScreen() {
  return (
      <ValidationFormFormContextProvider>
      <ValidationFormScreenContent />
      </ValidationFormFormContextProvider>
  );
}
