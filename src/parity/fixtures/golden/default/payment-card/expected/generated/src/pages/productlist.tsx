import ProductCard from "../components/ProductCard";

export default function ProductList() {
  return (
    <main className="min-h-screen w-full flex flex-col gap-[12px] min-h-[1200px] w-full max-w-[390px] p-[16px] bg-[#f5f7fa]">
      <h1 data-ir-id="list-title" data-ir-name="Title" className="w-[200px] h-[32px] text-[24px] text-[#1c1f24] leading-[32px] font-[700] whitespace-pre-wrap">{"Products"}</h1>
      <ProductCard productName={"Wireless Headphones"} description={"Premium sound quality"} price={"$99.00"} irId={"product-card-1"} irName={"Product Card"} imageIrId={"pc1-image"} imageIrName={"Image"} infoIrId={"pc1-info"} infoIrName={"Info"} productNameIrId={"pc1-name"} productNameIrName={"Product Name"} descriptionIrId={"pc1-desc"} descriptionIrName={"Description"} priceIrId={"pc1-price"} priceIrName={"Price"} />
      <ProductCard productName={"Bluetooth Speaker"} description={"Portable and waterproof"} price={"$49.00"} irId={"product-card-2"} irName={"Product Card"} imageIrId={"pc2-image"} imageIrName={"Image"} infoIrId={"pc2-info"} infoIrName={"Info"} productNameIrId={"pc2-name"} productNameIrName={"Product Name"} descriptionIrId={"pc2-desc"} descriptionIrName={"Description"} priceIrId={"pc2-price"} priceIrName={"Price"} />
      <ProductCard productName={"Smart Watch"} description={"Track your fitness goals"} price={"$199.00"} irId={"product-card-3"} irName={"Product Card"} imageIrId={"pc3-image"} imageIrName={"Image"} infoIrId={"pc3-info"} infoIrName={"Info"} productNameIrId={"pc3-name"} productNameIrName={"Product Name"} descriptionIrId={"pc3-desc"} descriptionIrName={"Description"} priceIrId={"pc3-price"} priceIrName={"Price"} />
      <ProductCard productName={"Laptop Stand"} description={"Ergonomic aluminum design"} price={"$39.00"} irId={"product-card-4"} irName={"Product Card"} imageIrId={"pc4-image"} imageIrName={"Image"} infoIrId={"pc4-info"} infoIrName={"Info"} productNameIrId={"pc4-name"} productNameIrName={"Product Name"} descriptionIrId={"pc4-desc"} descriptionIrName={"Description"} priceIrId={"pc4-price"} priceIrName={"Price"} />
      <ProductCard productName={"USB-C Hub"} description={"7-in-1 multiport adapter"} price={"$29.00"} irId={"product-card-5"} irName={"Product Card"} imageIrId={"pc5-image"} imageIrName={"Image"} infoIrId={"pc5-info"} infoIrName={"Info"} productNameIrId={"pc5-name"} productNameIrName={"Product Name"} descriptionIrId={"pc5-desc"} descriptionIrName={"Description"} priceIrId={"pc5-price"} priceIrName={"Price"} />
      <ProductCard productName={"Mechanical Keyboard"} description={"Cherry MX switches"} price={"$129.00"} irId={"product-card-6"} irName={"Product Card"} imageIrId={"pc6-image"} imageIrName={"Image"} infoIrId={"pc6-info"} infoIrName={"Info"} productNameIrId={"pc6-name"} productNameIrName={"Product Name"} descriptionIrId={"pc6-desc"} descriptionIrName={"Description"} priceIrId={"pc6-price"} priceIrName={"Price"} />
    </main>
  );
}
