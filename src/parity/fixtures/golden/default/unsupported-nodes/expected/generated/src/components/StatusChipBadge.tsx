interface StatusChipBadgeProps {
  irId: string;
  irName: string;
  labelIrId: string;
  labelIrName: string;
  label: string;
}

export default function StatusChipBadge(props: Readonly<StatusChipBadgeProps>) {
  return (
    <span data-ir-id={props.irId} data-ir-name={props.irName} className="relative min-h-[32px] w-[100px] bg-[#e8edfc] rounded-[16px]">
      <p data-ir-id={props.labelIrId} data-ir-name={props.labelIrName} className="absolute left-[16px] top-[7px] w-[68px] h-[18px] text-[13px] text-[#3d52b5] leading-[18px] font-[500] text-center whitespace-pre-wrap">{props.label}</p>
    </span>
  );
}
