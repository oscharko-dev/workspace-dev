import type { ChangeEvent } from "react";
import { Controller } from "react-hook-form";
import { Checkbox, Container, FormControlLabel, Paper, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from "@mui/material";
import { RegistrationFormContextProvider, useRegistrationFormContext } from "../context/RegistrationFormContext";

function RegistrationScreenContent() {
  const { control, handleSubmit, onSubmit, resolveFieldErrorMessage, isSubmitting } = useRegistrationFormContext();
  return (
    <Container id="main-content" maxWidth="sm" role="main" component="form" onSubmit={handleSubmit(onSubmit)} noValidate sx={{ position: "relative", width: "100%", minHeight: "max(100vh, 320px)", bgcolor: "background.default", px: 2.667, py: 2.667 }}>
      {/* @ir:start form-title Heading text */}
      <Typography data-ir-id="form-title" data-ir-name="Heading" variant="h1" component="h1" sx={{ color: "primary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Create Account"}</Typography>
      {/* @ir:end form-title */}
      {/* @ir:start form-subtitle Subtitle text */}
      <Typography data-ir-id="form-subtitle" data-ir-name="Subtitle" variant="h2" component="h2" sx={{ color: "secondary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Fill in your details to get started"}</Typography>
      {/* @ir:end form-subtitle */}
      {/* @ir:start name-row Name Row table */}
      <Table data-ir-id="name-row" data-ir-name="Name Row" size="small" sx={{ width: "88.6%", maxWidth: "372px", minHeight: "56px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "flex-start", gap: 2 }}>
        <TableHead>
          <TableRow>
            <TableCell>{"First Name"}</TableCell>
            <TableCell>{"John"}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          <TableRow>
            <TableCell>{"Last Name"}</TableCell>
            <TableCell>{"Doe"}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
      {/* @ir:end name-row */}
      {/* @ir:start email-field MuiTextFieldRoot input */}
      <Controller data-ir-id="email-field" data-ir-name="MuiTextFieldRoot"
        name={"muitextfieldroot_email_field"}
        control={control}
        render={({ field: controllerField, fieldState }) => {
          const helperText = resolveFieldErrorMessage({
            fieldKey: "muitextfieldroot_email_field",
            isTouched: fieldState.isTouched,
            fieldError: typeof fieldState.error?.message === "string" ? fieldState.error.message : undefined
          });
          return (
            <TextField
              label={"Email Address"}
              placeholder={"john@example.com"}
              type={"email"}
              autoComplete={"email"}
              value={controllerField.value ?? ""}
              onChange={(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => controllerField.onChange(event.target.value)}
              onBlur={controllerField.onBlur}
              error={Boolean(helperText)}
              helperText={helperText}
              aria-label={"Email Address"}
              aria-describedby={"muitextfieldroot_email_field-helper-text"}
        sx={{
          width: "88.6%", maxWidth: "372px", minHeight: "56px", display: "flex", flexDirection: "column", gap: 0.667, borderRadius: 1,
          "& .MuiOutlinedInput-notchedOutline": { borderColor: "#bfc4cc" },
          "& .MuiInputLabel-root": { fontFamily: "Inter, Roboto, Arial, sans-serif", color: "secondary.main" }
        }}

              slotProps={{
                htmlInput: { "aria-describedby": "muitextfieldroot_email_field-helper-text" },
          formHelperText: { id: "muitextfieldroot_email_field-helper-text" }
              }}
            />
          );
        }}
      />
      {/* @ir:end email-field */}
      {/* @ir:start checkbox-row Checkbox Row checkbox */}
      <FormControlLabel data-ir-id="checkbox-row" data-ir-name="Checkbox Row" sx={{ width: "88.6%", maxWidth: "372px", minHeight: "24px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "flex-start", gap: 1.333 }} control={<Checkbox />} label={"I agree to the Terms and Conditions"} />
      {/* @ir:end checkbox-row */}
      {/* @ir:start submit-button Primary Button paper */}
      <Paper data-ir-id="submit-button" data-ir-name="Primary Button" sx={{ width: "88.6%", maxWidth: "372px", minHeight: "48px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", bgcolor: "error.main", borderRadius: 1 }}>
        {/* @ir:start submit-label Label text */}
        <Typography data-ir-id="submit-label" data-ir-name="Label" variant="body1" sx={{ fontWeight: 600, color: "background.default", textAlign: "center", whiteSpace: "pre-wrap" }}>{"Create Account"}</Typography>
        {/* @ir:end submit-label */}
      </Paper>
      {/* @ir:end submit-button */}
    </Container>
  );
}

export default function RegistrationScreen() {
  return (
      <RegistrationFormContextProvider>
      <RegistrationScreenContent />
      </RegistrationFormContextProvider>
  );
}
