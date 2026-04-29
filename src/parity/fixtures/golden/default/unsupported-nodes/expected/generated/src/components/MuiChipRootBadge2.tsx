interface MuiChipRootBadge2Props {
  irId: string;
  irName: string;
  labelIrId: string;
  labelIrName: string;
  label: string;
}

export default function MuiChipRootBadge2(props: Readonly<MuiChipRootBadge2Props>) {
  return (
    <span data-ir-id={props.irId} data-ir-name={props.irName} className="relative min-h-[32px] w-[80px] bg-[#e8edfc] rounded-[16px]">
      <p data-ir-id={props.labelIrId} data-ir-name={props.labelIrName} className="absolute left-[16px] top-[7px] w-[48px] h-[18px] text-[13px] text-[#3d52b5] leading-[18px] font-[500] text-center whitespace-pre-wrap">{props.label}</p>
    </span>
  );
}
