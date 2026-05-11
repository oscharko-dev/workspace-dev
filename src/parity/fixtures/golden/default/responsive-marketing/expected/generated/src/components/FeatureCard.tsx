interface FeatureCardProps {
  irId: string;
  irName: string;
  featureTitleIrId: string;
  featureTitleIrName: string;
  featureDescriptionIrId: string;
  featureDescriptionIrName: string;
  featureTitle: string;
  featureDescription: string;
}

export default function FeatureCard(props: Readonly<FeatureCardProps>) {
  return (
    <article data-ir-id={props.irId} data-ir-name={props.irName} className="flex flex-col gap-[8px] min-h-[200px] w-[432px] bg-[#f7fafc] rounded-[8px]">
      <h1 data-ir-id={props.featureTitleIrId} data-ir-name={props.featureTitleIrName} className="w-full max-w-[400px] h-[28px] text-[20px] text-[#121726] leading-[28px] font-[600] whitespace-pre-wrap">{props.featureTitle}</h1>
      <p data-ir-id={props.featureDescriptionIrId} data-ir-name={props.featureDescriptionIrName} className="w-full max-w-[400px] h-[44px] text-[14px] text-[#666b75] leading-[22px] font-[400] whitespace-pre-wrap">{props.featureDescription}</p>
    </article>
  );
}
