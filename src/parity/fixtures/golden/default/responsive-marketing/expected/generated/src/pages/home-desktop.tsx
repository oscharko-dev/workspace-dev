import FeatureCard from "../components/FeatureCard";

export default function HomeDesktop() {
  return (
    <main className="min-h-screen w-full flex flex-col gap-[24px] min-h-[900px] w-full max-w-[1440px] px-[48px] py-[32px] bg-[#ffffff]">
      <header data-ir-id="hero-desktop" data-ir-name="Hero Section" className="flex flex-row items-center gap-[32px] min-h-[400px] w-full max-w-[1344px]">
        <header data-ir-id="hero-text-desktop" data-ir-name="Hero Text" className="flex flex-col gap-[16px] min-h-[400px] w-[650px]">
          <h1 data-ir-id="hero-heading-desktop" data-ir-name="Heading" className="w-full max-w-[650px] h-[56px] text-[48px] text-[#121726] leading-[56px] font-[800] whitespace-pre-wrap">{"Treasury Portal"}</h1>
          <p data-ir-id="hero-body-desktop" data-ir-name="Body" className="w-[500px] h-[56px] text-[18px] text-[#666b75] leading-[28px] font-[400] whitespace-pre-wrap">{"A responsive OSS demo for payment operations teams."}</p>
          <button data-ir-id="hero-cta-desktop" data-ir-name="CTA Button" className="relative min-h-[48px] w-[180px] bg-[#3d78f5] rounded-[8px]" type="button">
            <span data-ir-id="cta-label-desktop" data-ir-name="Label" className="absolute left-[48px] top-[12px] w-[84px] h-[24px] text-[16px] text-[#ffffff] leading-[24px] font-[600] text-center whitespace-pre-wrap">{"Review Demo"}</span>
          </button>
        </header>
        <img data-ir-id="hero-image-desktop" data-ir-name="Hero Image" className="w-[662px] h-[400px] bg-[#edf0f5] rounded-[12px]" alt="Hero Image" src="" />
      </header>
      <table data-ir-id="features-desktop" data-ir-name="Features Section" className="flex flex-row items-center gap-[24px] min-h-[300px] w-full max-w-[1344px]">
        <FeatureCard featureTitle={"Fast Onboarding"} featureDescription={"Start local demos from deterministic fixture JSON."} irId={"feature-1"} irName={"Feature Card"} featureTitleIrId={"f1-title"} featureTitleIrName={"Feature Title"} featureDescriptionIrId={"f1-desc"} featureDescriptionIrName={"Feature Description"} />
        <FeatureCard featureTitle={"Approval Collaboration"} featureDescription={"Coordinate payment reviews across synthetic teams."} irId={"feature-2"} irName={"Feature Card"} featureTitleIrId={"f2-title"} featureTitleIrName={"Feature Title"} featureDescriptionIrId={"f2-desc"} featureDescriptionIrName={"Feature Description"} />
        <FeatureCard featureTitle={"Liquidity Analytics"} featureDescription={"Review cash-position signals without customer data."} irId={"feature-3"} irName={"Feature Card"} featureTitleIrId={"f3-title"} featureTitleIrName={"Feature Title"} featureDescriptionIrId={"f3-desc"} featureDescriptionIrName={"Feature Description"} />
      </table>
    </main>
  );
}
