import type { ChangeEvent } from "react";
import { Controller } from "react-hook-form";
import { Checkbox, Container, FormControlLabel, Paper, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from "@mui/material";
import { RegistrationFormContextProvider, useRegistrationFormContext } from "../context/RegistrationFormContext";

function RegistrationScreenContent() {
  const { control, handleSubmit, onSubmit, resolveFieldErrorMessage } = useRegistrationFormContext();
  return (
    <Container id="main-content" maxWidth="sm" role="main" component="form" onSubmit={handleSubmit(onSubmit)} noValidate sx={{ position: "relative", width: "100%", minHeight: "max(100vh, 320px)", bgcolor: "background.default", px: 2.667, py: 2.667 }}>
      <Typography variant="h1" component="h1" sx={{ color: "primary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Create Account"}</Typography>
      <Typography variant="h2" component="h2" sx={{ color: "secondary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Fill in your details to get started"}</Typography>
      <Table size="small" sx={{ width: "88.6%", maxWidth: "372px", minHeight: "56px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "flex-start", gap: 2 }}>
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
      <Controller
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
      <FormControlLabel sx={{ width: "88.6%", maxWidth: "372px", minHeight: "24px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "flex-start", gap: 1.333 }} control={<Checkbox />} label={"I agree to the Terms and Conditions"} />
      <Paper sx={{ width: "88.6%", maxWidth: "372px", minHeight: "48px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", bgcolor: "error.main", borderRadius: 1 }}>
        <Typography variant="body1" sx={{ fontWeight: 600, color: "background.default", textAlign: "center", whiteSpace: "pre-wrap" }}>{"Create Account"}</Typography>
      </Paper>
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
