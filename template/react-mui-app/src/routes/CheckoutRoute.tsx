import { Alert, Button, Divider, Paper, Stack, TextField, Typography } from "@mui/material";

export default function CheckoutRoute() {
  return (
    <Stack component="main" id="main-content" spacing={3}>
      <Stack spacing={1.25}>
        <Typography variant="h4">Checkout flow</Typography>
        <Typography color="text.secondary" maxWidth={720} variant="body1">
          This second lazy route exists to keep navigation performance honest even when the destination contains a denser
          interactive form shell.
        </Typography>
      </Stack>

      <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
        <Paper
          elevation={0}
          sx={{
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 4,
            flex: 1,
            p: { xs: 2.5, md: 3 }
          }}
        >
          <Stack spacing={2}>
            <Typography variant="h6">Express checkout</Typography>
            <TextField autoComplete="name" label="Full name" name="name" />
            <TextField autoComplete="email" label="Email" name="email" type="email" />
            <TextField autoComplete="cc-number" label="Card number" name="cardNumber" />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <TextField autoComplete="cc-exp" label="Expiry" name="expiry" />
              <TextField autoComplete="cc-csc" label="CVC" name="cvc" />
            </Stack>
            <Button variant="contained">Submit order</Button>
          </Stack>
        </Paper>

        <Paper
          elevation={0}
          sx={{
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 4,
            minWidth: { md: 280 },
            p: { xs: 2.5, md: 3 },
            width: { xs: "100%", md: 320 }
          }}
        >
          <Stack spacing={2}>
            <Typography variant="h6">Order summary</Typography>
            <Stack spacing={1}>
              <Typography variant="body2">Starter template license</Typography>
              <Typography color="text.secondary" variant="body2">
                1 × React 19 starter bundle
              </Typography>
            </Stack>
            <Divider />
            <Alert severity="info" variant="outlined">
              Lazy route chunks keep this flow off the critical path until the user asks for it.
            </Alert>
            <Stack direction="row" justifyContent="space-between">
              <Typography fontWeight={600}>Total</Typography>
              <Typography fontWeight={700}>€0.00</Typography>
            </Stack>
          </Stack>
        </Paper>
      </Stack>
    </Stack>
  );
}
