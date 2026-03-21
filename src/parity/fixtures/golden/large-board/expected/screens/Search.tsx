import type { ChangeEvent } from "react";
import { Controller } from "react-hook-form";
import { Container, TextField, Typography } from "@mui/material";
import { SearchFormContextProvider, useSearchFormContext } from "../context/SearchFormContext";

function SearchScreenContent() {
  const { control, handleSubmit, onSubmit, resolveFieldErrorMessage, isSubmitting } = useSearchFormContext();
  return (
    <Container id="main-content" maxWidth="sm" role="main" component="form" onSubmit={handleSubmit(onSubmit)} noValidate sx={{ position: "relative", width: "100%", minHeight: "max(100vh, 320px)", bgcolor: "#ffffff", px: 1, py: 1 }}>
      {/* @ir:start search-title Title text */}
      <Typography data-ir-id="search-title" data-ir-name="Title" variant="h3" component="h1" sx={{ color: "primary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Search"}</Typography>
      {/* @ir:end search-title */}
      {/* @ir:start search-field MuiFormControlRoot input */}
      <Controller data-ir-id="search-field" data-ir-name="MuiFormControlRoot"
        name={"muiformcontrolroot_search_field"}
        control={control}
        render={({ field: controllerField, fieldState }) => {
          const helperText = resolveFieldErrorMessage({
            fieldKey: "muiformcontrolroot_search_field",
            isTouched: fieldState.isTouched,
            fieldError: typeof fieldState.error?.message === "string" ? fieldState.error.message : undefined
          });
          return (
            <TextField
              label={"Search"}
              type={"search"}
              value={controllerField.value ?? ""}
              onChange={(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => controllerField.onChange(event.target.value)}
              onBlur={controllerField.onBlur}
              error={Boolean(helperText)}
              helperText={helperText}
              aria-label={"Search"}
              aria-describedby={"muiformcontrolroot_search_field-helper-text"}
        sx={{
          width: "91.8%", maxWidth: "358px", minHeight: "48px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 0.5,
          "& .MuiInputLabel-root": { fontFamily: "Inter, Roboto, Arial, sans-serif", color: "#666b75" }
        }}

              slotProps={{
                htmlInput: { "aria-describedby": "muiformcontrolroot_search_field-helper-text" },
          formHelperText: { id: "muiformcontrolroot_search_field-helper-text" }
              }}
            />
          );
        }}
      />
      {/* @ir:end search-field */}
    </Container>
  );
}

export default function SearchScreen() {
  return (
      <SearchFormContextProvider>
      <SearchScreenContent />
      </SearchFormContextProvider>
  );
}
