import { Box, Container, List, ListItem, ListItemText, Typography } from "@mui/material";

const sharedSxStyle1 = { width: "91.8%", maxWidth: "358px", minHeight: "100px", display: "flex", flexDirection: "row", alignItems: "center", gap: 1, bgcolor: "#ffffff", borderRadius: 1 };
const sharedSxStyle2 = { width: "76px", height: "76px", objectFit: "cover", display: "block" };
const sharedSxStyle3 = { width: "67%", maxWidth: "240px", minHeight: "76px", display: "flex", flexDirection: "column", gap: 0.333 };

export default function ProductListScreen() {
  return (
    <Container id="main-content" maxWidth="sm" role="main" sx={{ position: "relative", width: "100%", minHeight: "max(100vh, 704px)", bgcolor: "#f5f7fa", px: 1.333, py: 1.333 }}>
      {/* @ir:start list-title Title text */}
      <Typography data-ir-id="list-title" data-ir-name="Title" variant="h1" component="h1" sx={{ color: "primary.main", textAlign: "left", whiteSpace: "pre-wrap" }}>{"Products"}</Typography>
      {/* @ir:end list-title */}
      {/* @ir:start product-card-1 Product Card table */}
      <Box data-ir-id="product-card-1" data-ir-name="Product Card" component="article" sx={sharedSxStyle1}>
        {/* @ir:start pc1-image Image image */}
        <Box data-ir-id="pc1-image" data-ir-name="Image" component="img" src={"data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2076%2076%22%20width%3D%2276%22%20height%3D%2276%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22g%22%20x1%3D%220%22%20x2%3D%221%22%20y1%3D%220%22%20y2%3D%221%22%3E%3Cstop%20offset%3D%220%25%22%20stop-color%3D%22%23f3f4f6%22%2F%3E%3Cstop%20offset%3D%22100%25%22%20stop-color%3D%22%23e5e7eb%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Crect%20width%3D%2276%22%20height%3D%2276%22%20fill%3D%22url(%23g)%22%2F%3E%3Ctext%20x%3D%2250%25%22%20y%3D%2250%25%22%20dominant-baseline%3D%22middle%22%20text-anchor%3D%22middle%22%20font-family%3D%22Roboto%2C%20Arial%2C%20sans-serif%22%20font-size%3D%2214%22%20fill%3D%22%236b7280%22%3EImage%3C%2Ftext%3E%3C%2Fsvg%3E"} alt={"Image"} decoding="async" fetchPriority="high" width={76} height={76} sx={sharedSxStyle2} />
        {/* @ir:end pc1-image */}
        {/* @ir:start pc1-info Info list */}
        <List data-ir-id="pc1-info" data-ir-name="Info" sx={sharedSxStyle3}>
          <ListItem key={"pc1-name"} disablePadding><ListItemText primary={"Wireless Headphones"} /></ListItem>
          <ListItem key={"pc1-desc"} disablePadding><ListItemText primary={"Premium sound quality"} /></ListItem>
          <ListItem key={"pc1-price"} disablePadding><ListItemText primary={"$99.00"} /></ListItem>
        </List>
        {/* @ir:end pc1-info */}
      </Box>
      {/* @ir:end product-card-1 */}
      {/* @ir:start product-card-2 Product Card table */}
      <Box data-ir-id="product-card-2" data-ir-name="Product Card" component="article" sx={sharedSxStyle1}>
        {/* @ir:start pc2-image Image image */}
        <Box data-ir-id="pc2-image" data-ir-name="Image" component="img" src={"data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2076%2076%22%20width%3D%2276%22%20height%3D%2276%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22g%22%20x1%3D%220%22%20x2%3D%221%22%20y1%3D%220%22%20y2%3D%221%22%3E%3Cstop%20offset%3D%220%25%22%20stop-color%3D%22%23f3f4f6%22%2F%3E%3Cstop%20offset%3D%22100%25%22%20stop-color%3D%22%23e5e7eb%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Crect%20width%3D%2276%22%20height%3D%2276%22%20fill%3D%22url(%23g)%22%2F%3E%3Ctext%20x%3D%2250%25%22%20y%3D%2250%25%22%20dominant-baseline%3D%22middle%22%20text-anchor%3D%22middle%22%20font-family%3D%22Roboto%2C%20Arial%2C%20sans-serif%22%20font-size%3D%2214%22%20fill%3D%22%236b7280%22%3EImage%3C%2Ftext%3E%3C%2Fsvg%3E"} alt={"Image"} decoding="async" fetchPriority="high" width={76} height={76} sx={sharedSxStyle2} />
        {/* @ir:end pc2-image */}
        {/* @ir:start pc2-info Info list */}
        <List data-ir-id="pc2-info" data-ir-name="Info" sx={sharedSxStyle3}>
          <ListItem key={"pc2-name"} disablePadding><ListItemText primary={"Bluetooth Speaker"} /></ListItem>
          <ListItem key={"pc2-desc"} disablePadding><ListItemText primary={"Portable and waterproof"} /></ListItem>
          <ListItem key={"pc2-price"} disablePadding><ListItemText primary={"$49.00"} /></ListItem>
        </List>
        {/* @ir:end pc2-info */}
      </Box>
      {/* @ir:end product-card-2 */}
      {/* @ir:start product-card-3 Product Card table */}
      <Box data-ir-id="product-card-3" data-ir-name="Product Card" component="article" sx={sharedSxStyle1}>
        {/* @ir:start pc3-image Image image */}
        <Box data-ir-id="pc3-image" data-ir-name="Image" component="img" src={"data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2076%2076%22%20width%3D%2276%22%20height%3D%2276%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22g%22%20x1%3D%220%22%20x2%3D%221%22%20y1%3D%220%22%20y2%3D%221%22%3E%3Cstop%20offset%3D%220%25%22%20stop-color%3D%22%23f3f4f6%22%2F%3E%3Cstop%20offset%3D%22100%25%22%20stop-color%3D%22%23e5e7eb%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Crect%20width%3D%2276%22%20height%3D%2276%22%20fill%3D%22url(%23g)%22%2F%3E%3Ctext%20x%3D%2250%25%22%20y%3D%2250%25%22%20dominant-baseline%3D%22middle%22%20text-anchor%3D%22middle%22%20font-family%3D%22Roboto%2C%20Arial%2C%20sans-serif%22%20font-size%3D%2214%22%20fill%3D%22%236b7280%22%3EImage%3C%2Ftext%3E%3C%2Fsvg%3E"} alt={"Image"} decoding="async" fetchPriority="high" width={76} height={76} sx={sharedSxStyle2} />
        {/* @ir:end pc3-image */}
        {/* @ir:start pc3-info Info list */}
        <List data-ir-id="pc3-info" data-ir-name="Info" sx={sharedSxStyle3}>
          <ListItem key={"pc3-name"} disablePadding><ListItemText primary={"Smart Watch"} /></ListItem>
          <ListItem key={"pc3-desc"} disablePadding><ListItemText primary={"Track your fitness goals"} /></ListItem>
          <ListItem key={"pc3-price"} disablePadding><ListItemText primary={"$199.00"} /></ListItem>
        </List>
        {/* @ir:end pc3-info */}
      </Box>
      {/* @ir:end product-card-3 */}
      {/* @ir:start product-card-4 Product Card table */}
      <Box data-ir-id="product-card-4" data-ir-name="Product Card" component="article" sx={sharedSxStyle1}>
        {/* @ir:start pc4-image Image image */}
        <Box data-ir-id="pc4-image" data-ir-name="Image" component="img" src={"data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2076%2076%22%20width%3D%2276%22%20height%3D%2276%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22g%22%20x1%3D%220%22%20x2%3D%221%22%20y1%3D%220%22%20y2%3D%221%22%3E%3Cstop%20offset%3D%220%25%22%20stop-color%3D%22%23f3f4f6%22%2F%3E%3Cstop%20offset%3D%22100%25%22%20stop-color%3D%22%23e5e7eb%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Crect%20width%3D%2276%22%20height%3D%2276%22%20fill%3D%22url(%23g)%22%2F%3E%3Ctext%20x%3D%2250%25%22%20y%3D%2250%25%22%20dominant-baseline%3D%22middle%22%20text-anchor%3D%22middle%22%20font-family%3D%22Roboto%2C%20Arial%2C%20sans-serif%22%20font-size%3D%2214%22%20fill%3D%22%236b7280%22%3EImage%3C%2Ftext%3E%3C%2Fsvg%3E"} alt={"Image"} decoding="async" fetchPriority="high" width={76} height={76} sx={sharedSxStyle2} />
        {/* @ir:end pc4-image */}
        {/* @ir:start pc4-info Info list */}
        <List data-ir-id="pc4-info" data-ir-name="Info" sx={sharedSxStyle3}>
          <ListItem key={"pc4-name"} disablePadding><ListItemText primary={"Laptop Stand"} /></ListItem>
          <ListItem key={"pc4-desc"} disablePadding><ListItemText primary={"Ergonomic aluminum design"} /></ListItem>
          <ListItem key={"pc4-price"} disablePadding><ListItemText primary={"$39.00"} /></ListItem>
        </List>
        {/* @ir:end pc4-info */}
      </Box>
      {/* @ir:end product-card-4 */}
      {/* @ir:start product-card-5 Product Card table */}
      <Box data-ir-id="product-card-5" data-ir-name="Product Card" component="article" sx={sharedSxStyle1}>
        {/* @ir:start pc5-image Image image */}
        <Box data-ir-id="pc5-image" data-ir-name="Image" component="img" src={"data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2076%2076%22%20width%3D%2276%22%20height%3D%2276%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22g%22%20x1%3D%220%22%20x2%3D%221%22%20y1%3D%220%22%20y2%3D%221%22%3E%3Cstop%20offset%3D%220%25%22%20stop-color%3D%22%23f3f4f6%22%2F%3E%3Cstop%20offset%3D%22100%25%22%20stop-color%3D%22%23e5e7eb%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Crect%20width%3D%2276%22%20height%3D%2276%22%20fill%3D%22url(%23g)%22%2F%3E%3Ctext%20x%3D%2250%25%22%20y%3D%2250%25%22%20dominant-baseline%3D%22middle%22%20text-anchor%3D%22middle%22%20font-family%3D%22Roboto%2C%20Arial%2C%20sans-serif%22%20font-size%3D%2214%22%20fill%3D%22%236b7280%22%3EImage%3C%2Ftext%3E%3C%2Fsvg%3E"} alt={"Image"} decoding="async" fetchPriority="high" width={76} height={76} sx={sharedSxStyle2} />
        {/* @ir:end pc5-image */}
        {/* @ir:start pc5-info Info list */}
        <List data-ir-id="pc5-info" data-ir-name="Info" sx={sharedSxStyle3}>
          <ListItem key={"pc5-name"} disablePadding><ListItemText primary={"USB-C Hub"} /></ListItem>
          <ListItem key={"pc5-desc"} disablePadding><ListItemText primary={"7-in-1 multiport adapter"} /></ListItem>
          <ListItem key={"pc5-price"} disablePadding><ListItemText primary={"$29.00"} /></ListItem>
        </List>
        {/* @ir:end pc5-info */}
      </Box>
      {/* @ir:end product-card-5 */}
      {/* @ir:start product-card-6 Product Card table */}
      <Box data-ir-id="product-card-6" data-ir-name="Product Card" component="article" sx={sharedSxStyle1}>
        {/* @ir:start pc6-image Image image */}
        <Box data-ir-id="pc6-image" data-ir-name="Image" component="img" src={"data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2076%2076%22%20width%3D%2276%22%20height%3D%2276%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22g%22%20x1%3D%220%22%20x2%3D%221%22%20y1%3D%220%22%20y2%3D%221%22%3E%3Cstop%20offset%3D%220%25%22%20stop-color%3D%22%23f3f4f6%22%2F%3E%3Cstop%20offset%3D%22100%25%22%20stop-color%3D%22%23e5e7eb%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Crect%20width%3D%2276%22%20height%3D%2276%22%20fill%3D%22url(%23g)%22%2F%3E%3Ctext%20x%3D%2250%25%22%20y%3D%2250%25%22%20dominant-baseline%3D%22middle%22%20text-anchor%3D%22middle%22%20font-family%3D%22Roboto%2C%20Arial%2C%20sans-serif%22%20font-size%3D%2214%22%20fill%3D%22%236b7280%22%3EImage%3C%2Ftext%3E%3C%2Fsvg%3E"} alt={"Image"} loading="lazy" decoding="async" width={76} height={76} sx={sharedSxStyle2} />
        {/* @ir:end pc6-image */}
        {/* @ir:start pc6-info Info list */}
        <List data-ir-id="pc6-info" data-ir-name="Info" sx={sharedSxStyle3}>
          <ListItem key={"pc6-name"} disablePadding><ListItemText primary={"Mechanical Keyboard"} /></ListItem>
          <ListItem key={"pc6-desc"} disablePadding><ListItemText primary={"Cherry MX switches"} /></ListItem>
          <ListItem key={"pc6-price"} disablePadding><ListItemText primary={"$129.00"} /></ListItem>
        </List>
        {/* @ir:end pc6-info */}
      </Box>
      {/* @ir:end product-card-6 */}
    </Container>
  );
}
